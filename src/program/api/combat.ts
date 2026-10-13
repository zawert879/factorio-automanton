// Бой для программ (10.2–10.4): attack, guard, patrol, reload, me.weapon. Стреляет движок игры:
// attack — действие (src/automaton/combat.ts), guard и patrol — команды движку с distraction.by_enemy
// (машина сама отбивается от врагов), программа раз в полсекунды проверяет until() и маршрут.
import { LuaEntity, MapPosition } from "factorio:runtime"
import { combatPose, hasAmmo, stopCombat, weaponOf } from "../../automaton/combat"
import { RobotRecord } from "../../automaton/registry"
import { charge, defineHostObject, host, hostBlocking, hostGetters, hostMethods, program, Val, Y } from "../../lang/runtime/core"
import { truthy } from "../../lang/runtime/values"
import { actionError, currentRobot } from "../context"
import { handleEntity, resolveTarget } from "../handles"
import { onMachineReset } from "../machines"
import { registerPoll, resume, sleepUntil } from "../scheduler"
import { actionCall, finishWaiting, item, optionalItem, startWaiting } from "./common"
import { gearOf } from "../../automaton/variants"
import { modelOf } from "../../names"

const COMBAT_POLL_TICKS = 30
/** Пост считается достигнутым ближе этого (клеток). */
const ARRIVE_DISTANCE = 2.5

function combatRobot(): RobotRecord {
  const robot = currentRobot()
  if (weaponOf(robot) === undefined) actionError("invalid-target", "this model has no weapon")
  return robot
}

function distance(a: MapPosition, b: MapPosition): number {
  return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/** Ближайший враг в радиусе от точки (или undefined). */
function nearestEnemy(robot: RobotRecord, center: MapPosition, radius: number): LuaEntity | undefined {
  const found = robot.entity.surface.find_entities_filtered({
    position: center,
    radius,
    force: "enemy",
    type: ["unit", "unit-spawner", "turret"],
  })
  let best: LuaEntity | undefined
  let bestDistance = math.huge
  for (const enemy of found) {
    const d = distance(robot.entity.position, enemy.position)
    if (d < bestDistance) {
      best = enemy
      bestDistance = d
    }
  }
  return best
}

function goTo(robot: RobotRecord, destination: MapPosition): void {
  robot.entity.commandable!.set_command({
    type: defines.command.go_to_location,
    destination,
    radius: 1.5,
    distraction: defines.distraction.by_enemy,
    pathfind_flags: { cache: true },
  })
}

/** Следить за позой и движением между опросами. */
function pose(robot: RobotRecord, frame: Val, target: MapPosition | undefined): void {
  const position = robot.entity.position
  const last = frame.last as MapPosition | undefined
  combatPose(robot, target, last !== undefined && distance(last, position) > 0.05)
  frame.last = { x: position.x, y: position.y }
}

// ---------- attack ----------

host.attack = (k: Val, target: Val) => {
  if (k !== undefined) {
    const [count] = finishWaiting(k)
    return $multi(count === 1)
  }
  combatRobot()
  // Действие закончилось сразу — true/false; иначе пауза (Y и кадр ожидания).
  const [result, frame] = actionCall(undefined, "attack", { target: handleEntity(target) })
  if (result === Y) return $multi(result, frame)
  return $multi(result === 1)
}
hostBlocking.attack = true

// ---------- guard ----------

host.guard = (k: Val, at: Val, options: Val) => {
  if (k !== undefined) return finishWaiting(k)
  const robot = combatRobot()
  const center = resolveTarget(at).position
  const opts = type(options) === "table" ? options : {}
  const radius = type(opts.radius) === "number" ? (opts.radius as number) : weaponOf(robot)!.range + 5
  return startWaiting("guard", (frame) => {
    frame.__poll = "guard"
    frame.center = { x: center.x, y: center.y }
    frame.radius = radius
    frame.until = opts.until
    goTo(robot, center)
    sleepUntil(robot.id, game.tick + COMBAT_POLL_TICKS, frame)
  })
}
hostBlocking.guard = true

registerPoll("guard", (record, frame, tick) => {
  const robot = storage.robots.byId[record.robotId]!
  if (frame.until !== undefined && truthy(program().calls(frame.until, undefined))) {
    stopCombat(robot)
    return resume(record, undefined)
  }
  const center = frame.center as MapPosition
  const enemy = hasAmmo(robot) ? nearestEnemy(robot, center, frame.radius) : undefined
  const commandable = robot.entity.commandable!
  if (enemy !== undefined) {
    // Враг у поста — в бой (движок сам подъедет на дальность выстрела).
    if (frame.fighting !== enemy.unit_number) {
      commandable.set_command({ type: defines.command.attack, target: enemy, distraction: defines.distraction.by_enemy })
      frame.fighting = enemy.unit_number
    }
  } else {
    frame.fighting = undefined
    if (distance(robot.entity.position, center) > ARRIVE_DISTANCE) {
      if (!commandable.has_command) goTo(robot, center)
    } else {
      commandable.set_command({ type: defines.command.stop, ticks_to_wait: COMBAT_POLL_TICKS * 2, distraction: defines.distraction.by_enemy })
    }
  }
  pose(robot, frame, enemy?.position)
  sleepUntil(record.robotId, tick + COMBAT_POLL_TICKS, frame)
})

// ---------- patrol ----------

host.patrol = (k: Val, points: Val, until: Val) => {
  if (k !== undefined) return finishWaiting(k)
  const robot = combatRobot()
  if (type(points) !== "table" || points.__n === undefined || points.__n === 0) actionError("invalid-target", "patrol needs a list of points")
  const route: MapPosition[] = []
  for (let i = 1; i <= points.__n; i++) {
    const p = resolveTarget(points[i]).position
    route.push({ x: p.x, y: p.y })
  }
  return startWaiting("patrol", (frame) => {
    frame.__poll = "patrol"
    frame.route = route
    frame.index = 0
    frame.until = until
    goTo(robot, route[0])
    sleepUntil(robot.id, game.tick + COMBAT_POLL_TICKS, frame)
  })
}
hostBlocking.patrol = true

registerPoll("patrol", (record, frame, tick) => {
  const robot = storage.robots.byId[record.robotId]!
  if (frame.until !== undefined && truthy(program().calls(frame.until, undefined))) {
    stopCombat(robot)
    return resume(record, undefined)
  }
  const route = frame.route as MapPosition[]
  // Индекс — число явно: с any TSTL не сдвигает индекс массива на 1.
  let index = frame.index as number
  let target = route[index]
  if (distance(robot.entity.position, target) <= ARRIVE_DISTANCE) {
    index = (index + 1) % route.length
    frame.index = index
    target = route[index]
    goTo(robot, target)
  } else if (!robot.entity.commandable!.has_command) {
    // Отвлёкся на врага и победил (или команда сорвалась) — продолжить маршрут.
    goTo(robot, target)
  }
  pose(robot, frame, undefined)
  sleepUntil(record.robotId, tick + COMBAT_POLL_TICKS, frame)
})

// ---------- reload, me.weapon ----------

host.reload = (k: Val, ammo: Val) => {
  if (k !== undefined) return finishWaiting(k)
  combatRobot()
  return actionCall(undefined, "reload", { item: optionalItem(ammo) })
}
hostBlocking.reload = true

// me.weapon (19.4): оружие боевой модели — состояние при обращении и действия боя (те же функции API).
const weaponObject = defineHostObject("weapon")
hostGetters.me.weapon = () => (weaponOf(currentRobot()) === undefined ? undefined : weaponObject)
hostGetters.weapon.type = () => weaponOf(currentRobot())?.type
hostGetters.weapon.range = () => weaponOf(currentRobot())?.range
hostGetters.weapon.ammo = () => {
  const stack = currentRobot().weapon?.[0]
  if (stack === undefined || !stack.valid_for_read) return undefined
  charge(1)
  return { name: stack.name, count: stack.count }
}
for (const name of ["reload", "attack", "guard", "patrol"]) {
  hostMethods.weapon[name] = (_o: Val, k: Val, ...args: Val[]) => host[name](k, ...args)
}
// Сменное оружие (22.2): поставленное оружие игрока (null — встроенное), поставить из груза и снять в груз.
hostGetters.weapon.item = () => gearOf(currentRobot()).weapon
hostMethods.weapon.equip = (_o: Val, k: Val, what: Val) => actionCall(k, "equip", k !== undefined ? {} : { slot: "weapon", item: item(what) })
hostMethods.weapon.unequip = (_o: Val, k: Val) => actionCall(k, "equip", k !== undefined ? {} : { slot: "weapon" })

// me.armor (22.4): броня наземных машин — что надето, надеть из груза, снять в груз; у летающих — null.
const armorObject = defineHostObject("armor")
hostGetters.me.armor = () => (modelOf(currentRobot().model)?.flying ? undefined : armorObject)
hostGetters.armor.item = () => gearOf(currentRobot()).armor
hostMethods.armor.equip = (_o: Val, k: Val, what: Val) => actionCall(k, "equip", k !== undefined ? {} : { slot: "armor", item: item(what) })
hostMethods.armor.unequip = (_o: Val, k: Val) => actionCall(k, "equip", k !== undefined ? {} : { slot: "armor" })

// Программу остановили или перезапустили посреди боя — команда движку снимается.
onMachineReset((robotId) => {
  const robot = storage.robots.byId[robotId]
  if (robot !== undefined && robot.entity.valid && weaponOf(robot) !== undefined) stopCombat(robot)
})
