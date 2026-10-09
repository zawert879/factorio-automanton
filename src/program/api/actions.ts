// Движение и предметы (4.2) поверх систем этапа 2: move, canReach, follow, goHome, mine, take, put,
// pickup, drop, give, repair, refuel; жидкости (7.1): pump, fill, drain; зарядка (8.2): charge;
// наладка и строительство (8.5, 8.6): setRecipe, build, deconstruct, rotate. Блокирующие: программа
// ждёт конца действия или поездки.
import { LuaEntity, MapPosition } from "factorio:runtime"
import { isFlyer } from "../../automaton/models"
import { cancelMove, isMoving, moveRobot } from "../../automaton/movement"
import { onEvent } from "../../events"
import { host, hostBlocking, program, Val } from "../../lang/runtime/core"
import { truthy } from "../../lang/runtime/values"
import { actionError, currentMachine, currentRobot } from "../context"
import { entityHandle, handleEntity, handleRobot, inSight, resolveTarget } from "../handles"
import { readPosition } from "../values"
import { registerPoll, resume, sleepUntil } from "../scheduler"
import { actionCall, count, finishWaiting, fluid, fluidAmount, item, optionalItem, startWaiting, ticks } from "./common"

const FOLLOW_CHECK_TICKS = 30

function blocking(name: string, fn: (this: void, k: Val, ...args: Val[]) => LuaMultiReturn<[Val, Val?]>): void {
  host[name] = fn
  hostBlocking[name] = true
}

/** Поехать к цели; ожидание закончит конец поездки (или таймаут). */
function startMove(target: Val, options: Val, name: string): LuaMultiReturn<[Val, Val?]> {
  const robot = currentRobot()
  const resolved = resolveTarget(target)
  const radius = type(options) === "table" && type(options.radius) === "number" ? (options.radius as number) : undefined
  const timeout = type(options) === "table" && options.timeout !== undefined ? ticks(options.timeout, 0) : undefined
  return startWaiting(name, (frame) => {
    frame.__move = true
    moveRobot(robot, resolved.entity !== undefined && resolved.entity.type !== "simple-entity-with-owner" ? { entity: resolved.entity } : { position: resolved.position }, { radius })
    if (timeout !== undefined) {
      frame.__poll = "moveTimeout"
      sleepUntil(robot.id, game.tick + timeout, frame)
    }
  })
}

blocking("move", (k, to, options) => (k !== undefined ? finishWaiting(k) : startMove(to, options, "move")))

registerPoll("moveTimeout", (record, frame) => {
  const robot = storage.robots.byId[record.robotId]!
  frame.timedOut = true
  cancelMove(robot)
})

blocking("goHome", (k) => {
  if (k !== undefined) return finishWaiting(k)
  const home = currentMachine().home
  if (home === undefined) actionError("invalid-target", "no home: set it in the robot window")
  return startMove({ x: home.x, y: home.y }, undefined, "goHome")
})

// ---------- canReach: поиск пути движка ----------

blocking("canReach", (k, to) => {
  if (k !== undefined) return finishWaiting(k)
  const robot = currentRobot()
  const target = resolveTarget(to)
  // Летающим путь не нужен: долетят куда угодно.
  if (isFlyer(robot)) return $multi(true)
  return startWaiting("canReach", (frame) => {
    frame.goal = target.position
    frame.__path = requestPath(robot.id, target.position)
  })
})

function requestPath(robotId: number, goal: MapPosition): number {
  const robot = storage.robots.byId[robotId]!
  const prototype = prototypes.entity[robot.model]
  const id = robot.entity.surface.request_path({
    bounding_box: prototype.collision_box,
    collision_mask: prototype.collision_mask,
    start: robot.entity.position,
    goal,
    force: robot.entity.force,
    radius: 1.5,
    pathfind_flags: { cache: true, low_priority: true },
  })
  storage.scheduler.paths[id] = robotId
  return id
}

function onPathFinished(id: number, found: boolean, tryAgain: boolean): void {
  const robotId = storage.scheduler.paths[id]
  if (robotId === undefined) return
  storage.scheduler.paths[id] = undefined
  const record = storage.machines[robotId]
  if (record === undefined || record.machine.status !== "waiting" || record.machine.waiting?.__path !== id) return
  if (tryAgain) {
    // Поиск пути перегружен — спросить снова.
    const robot = storage.robots.byId[robotId]
    if (robot !== undefined && robot.entity.valid) {
      record.machine.waiting.__path = requestPath(robotId, record.machine.waiting.goal ?? robot.entity.position)
      return
    }
  }
  resume(record, found)
}

// ---------- follow ----------

blocking("follow", (k, target, until) => {
  if (k !== undefined) return finishWaiting(k)
  const robot = currentRobot()
  // Цель — здание или машина в поле зрения.
  if (type(target) !== "table" || target.__t !== "host" || (target.__h !== "entity" && target.__h !== "robot")) {
    actionError("invalid-target", "follow needs a building or a robot")
  }
  return startWaiting("follow", (frame) => {
    frame.__poll = "follow"
    frame.__move = false
    frame.target = target
    frame.until = until
    sleepUntil(robot.id, game.tick + 1)
  })
})

registerPoll("follow", (record, frame, tick) => {
  const robot = storage.robots.byId[record.robotId]!
  const target = frame.target
  const entity = target.__h === "robot" ? storage.robots.byId[target.__id]?.entity : target.__e
  if (entity === undefined || !entity.valid || !inSight(entity)) {
    cancelMove(robot)
    return resume(record, false)
  }
  if (frame.until !== undefined && truthy(program().calls(frame.until, undefined))) {
    cancelMove(robot)
    return resume(record, true)
  }
  if (!isMoving(robot)) moveRobot(robot, { entity }, { radius: 3 })
  sleepUntil(record.robotId, tick + FOLLOW_CHECK_TICKS)
})

// ---------- Предметы ----------

blocking("mine", (k, what, amount) => actionCall(k, "mine", k !== undefined ? {} : { item: item(what), count: count(amount) }))
blocking("take", (k, from, what, amount) =>
  actionCall(k, "take", k !== undefined ? {} : { target: handleEntity(from), item: item(what), count: count(amount) }),
)
blocking("put", (k, into, what, amount) =>
  actionCall(k, "put", k !== undefined ? {} : { target: handleEntity(into), item: item(what), count: count(amount) }),
)
blocking("pickup", (k, what, amount) => actionCall(k, "pickup", k !== undefined ? {} : { item: optionalItem(what), count: count(amount) }))
blocking("drop", (k, what, amount) => actionCall(k, "drop", k !== undefined ? {} : { item: item(what), count: count(amount) }))
blocking("give", (k, to, what, amount) =>
  actionCall(k, "give", k !== undefined ? {} : { target: handleRobot(to).entity, item: item(what), count: count(amount) }),
)
blocking("repair", (k, target) =>
  actionCall(k, "repair", k !== undefined ? {} : { target: type(target) === "table" && target.__h === "robot" ? handleRobot(target).entity : handleEntity(target) }),
)
blocking("refuel", (k, what, to) =>
  actionCall(k, "refuel", k !== undefined ? {} : { item: optionalItem(what), target: to === undefined ? undefined : handleRobot(to).entity }),
)

// ---------- Зарядка, наладка, строительство ----------

blocking("charge", (k, station) =>
  actionCall(k, "charge", k !== undefined ? {} : { target: station === undefined ? undefined : handleEntity(station) }),
)

blocking("setRecipe", (k, machine, recipe) => {
  if (k !== undefined) return finishWaiting(k)
  if (type(recipe) !== "string" || prototypes.recipe[recipe as string] === undefined) actionError("invalid-target", `unknown recipe ${tostring(recipe)}`)
  return actionCall(k, "set-recipe", { target: handleEntity(machine), item: recipe as string })
})

const DIRECTIONS: Record<string, defines.direction> = {
  north: defines.direction.north,
  east: defines.direction.east,
  south: defines.direction.south,
  west: defines.direction.west,
}

blocking("build", (k, what, at, direction) => {
  if (k !== undefined) {
    const [built] = finishWaiting(k)
    return $multi(built === undefined || !(built as LuaEntity).valid ? undefined : entityHandle(built as LuaEntity))
  }
  const position = readPosition(at)
  if (position === undefined) actionError("invalid-target", "build needs a position {x, y}")
  const dir = direction === undefined ? undefined : DIRECTIONS[direction as string]
  if (direction !== undefined && dir === undefined) actionError("invalid-target", `bad direction ${tostring(direction)}`)
  return actionCall(k, "build", { item: item(what), position, direction: dir })
})

blocking("deconstruct", (k, target) => actionCall(k, "deconstruct", k !== undefined ? {} : { target: handleEntity(target) }))
blocking("rotate", (k, target, reverse) =>
  actionCall(k, "rotate", k !== undefined ? {} : { target: handleEntity(target), reverse: reverse === true }),
)

// ---------- Жидкости ----------

blocking("pump", (k, what, amount) => actionCall(k, "pump", k !== undefined ? {} : { item: fluid(what), count: fluidAmount(amount) }))
blocking("fill", (k, into, amount) => actionCall(k, "fill", k !== undefined ? {} : { target: handleEntity(into), count: fluidAmount(amount) }))
blocking("drain", (k, from, what, amount) =>
  actionCall(k, "drain", k !== undefined ? {} : { target: handleEntity(from), item: fluid(what), count: fluidAmount(amount) }),
)

export function registerActionApi(): void {
  onEvent(defines.events.on_script_path_request_finished, (e) => onPathFinished(e.id, e.path !== undefined, e.try_again_later))
}
