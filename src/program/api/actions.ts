// Действия поверх систем этапа 2 (блокирующие: программа ждёт конца действия или поездки).
// Своей машины — реализации в реестре host (move, canReach, follow, goHome, mine, pickup, drop, build, refuel,
// charge, pump): их вызывают методы me, me.energy, me.tank (src/program/api/me.ts), у программы этих имён нет.
// Методы зданий и машин (19.3): furnace.insert(…), chest.extract(…), assembler.setRecipe(…), boiler.fill(…),
// helper.refuel(…) — цель действия — сам объект.
import { LuaEntity, MapPosition } from "factorio:runtime"
import { isFlyer } from "../../automaton/models"
import { cancelMove, isMoving, moveRobot } from "../../automaton/movement"
import { onEvent } from "../../events"
import { Fn, host, hostBlocking, hostMethods, program, Val } from "../../lang/runtime/core"
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
blocking("pickup", (k, what, amount) => actionCall(k, "pickup", k !== undefined ? {} : { item: optionalItem(what), count: count(amount) }))
blocking("drop", (k, what, amount) => actionCall(k, "drop", k !== undefined ? {} : { item: item(what), count: count(amount) }))
blocking("refuel", (k, what, to) =>
  actionCall(k, "refuel", k !== undefined ? {} : { item: optionalItem(what), target: to === undefined ? undefined : handleRobot(to).entity }),
)

// ---------- Зарядка, строительство ----------

blocking("charge", (k, station) =>
  actionCall(k, "charge", k !== undefined ? {} : { target: station === undefined ? undefined : handleEntity(station) }),
)

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

// ---------- Жидкости ----------

blocking("pump", (k, what, amount) => actionCall(k, "pump", k !== undefined ? {} : { item: fluid(what), count: fluidAmount(amount) }))

// ---------- Методы зданий и машин (19.3) ----------
// Действие делает эта машина (досягаемость me.reach, её энергия и время), цель — объект метода. Классы и что у них
// есть — docs/API.md, «Классы зданий»; у классов без метода его нет и во время выполнения.

function methods(classes: string[], name: string, fn: Fn): void {
  for (const cls of classes) hostMethods[cls][name] = fn
}

/** Классы с предметами (положить — insert) и с тем, что можно взять (extract). */
const INSERT_CLASSES = ["Chest", "Furnace", "Assembler", "RocketSilo", "Lab", "Boiler", "Reactor", "Turret", "CargoWagon", "Locomotive", "Vehicle"]
const EXTRACT_CLASSES = ["Chest", "Furnace", "Assembler", "RocketSilo", "Lab", "Reactor", "Turret", "CargoWagon", "Vehicle"]
/** Классы с жидкостью: залить из бака (fill) и слить в бак (drain). */
const FILL_CLASSES = ["Assembler", "Boiler", "Generator", "StorageTank", "Pipe", "FlameTurret", "FluidWagon"]
const DRAIN_CLASSES = ["Assembler", "Boiler", "Generator", "StorageTank", "Pipe", "FluidWagon"]

methods(INSERT_CLASSES, "insert", (o: Val, k: Val, what: Val, amount: Val) =>
  actionCall(k, "put", k !== undefined ? {} : { target: handleEntity(o), item: item(what), count: count(amount) }),
)
methods(EXTRACT_CLASSES, "extract", (o: Val, k: Val, what: Val, amount: Val) =>
  actionCall(k, "take", k !== undefined ? {} : { target: handleEntity(o), item: item(what), count: count(amount) }),
)
methods(FILL_CLASSES, "fill", (o: Val, k: Val, amount: Val) =>
  actionCall(k, "fill", k !== undefined ? {} : { target: handleEntity(o), count: fluidAmount(amount) }),
)
methods(DRAIN_CLASSES, "drain", (o: Val, k: Val, what: Val, amount: Val) =>
  actionCall(k, "drain", k !== undefined ? {} : { target: handleEntity(o), item: fluid(what), count: fluidAmount(amount) }),
)
hostMethods.Building.repair = (o: Val, k: Val) => actionCall(k, "repair", k !== undefined ? {} : { target: handleEntity(o) })
hostMethods.Building.rotate = (o: Val, k: Val, reverse: Val) =>
  actionCall(k, "rotate", k !== undefined ? {} : { target: handleEntity(o), reverse: reverse === true })
hostMethods.Building.deconstruct = (o: Val, k: Val) => actionCall(k, "deconstruct", k !== undefined ? {} : { target: handleEntity(o) })
hostMethods.Assembler.setRecipe = (o: Val, k: Val, recipe: Val) => {
  if (k !== undefined) return finishWaiting(k)
  if (type(recipe) !== "string" || prototypes.recipe[recipe as string] === undefined) actionError("invalid-target", `unknown recipe ${tostring(recipe)}`)
  return actionCall(k, "set-recipe", { target: handleEntity(o), item: recipe as string })
}

// Другая машина: груз — «из рук в руки», топливный слот, ремонт.
hostMethods.robot.insert = (o: Val, k: Val, what: Val, amount: Val) =>
  actionCall(k, "give", k !== undefined ? {} : { target: handleRobot(o).entity, item: item(what), count: count(amount) })
hostMethods.robot.refuel = (o: Val, k: Val, what: Val) =>
  actionCall(k, "refuel", k !== undefined ? {} : { item: optionalItem(what), target: handleRobot(o).entity })
hostMethods.robot.repair = (o: Val, k: Val) => actionCall(k, "repair", k !== undefined ? {} : { target: handleRobot(o).entity })

export function registerActionApi(): void {
  onEvent(defines.events.on_script_path_request_finished, (e) => onPathFinished(e.id, e.path !== undefined, e.try_again_later))
}
