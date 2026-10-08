// Карта (4.9): marker, zone, find, map.tag. Время и мир (4.7): wait, waitUntil, exit, restart, time, world.
import { BoundingBox } from "factorio:runtime"
import { controlFlow, defineHostObject, host, hostBlocking, hostGetters, hostMethods, program, Val } from "../../lang/runtime/core"
import { lib } from "../../lang/runtime/library"
import { truthy } from "../../lang/runtime/values"
import { MARKER, WORKER_MK1, WORKER_MK1_PLACER } from "../../names"
import { findMarker } from "../../world/markers"
import { findZone, zoneCenter } from "../../world/zones"
import { actionError, currentMachine, currentRobot } from "../context"
import { entityHandle } from "../handles"
import { registerPoll, resume, sleepUntil } from "../scheduler"
import { programArray, programPosition, readPosition } from "../values"
import { finishWaiting, item, startWaiting, text, ticks } from "./common"

// ---------- Метки и зоны ----------

defineHostObject("marker")
hostGetters.marker.name = (o: Val) => storage.markers.byId[o.__id]?.name ?? o.__name
hostGetters.marker.position = (o: Val) => {
  const marker = storage.markers.byId[o.__id]
  if (marker === undefined || !marker.entity.valid) actionError("invalid-target", "marker removed")
  return programPosition(marker.entity.position)
}
hostGetters.marker.valid = (o: Val) => storage.markers.byId[o.__id]?.entity.valid === true
rawset(hostMethods.marker, "toString", (o: Val) => `marker ${o.__name}`)

host.marker = (name: Val) => {
  const marker = findMarker(text(name))
  if (marker === undefined) actionError("invalid-target", `no marker "${text(name)}"`)
  return { __t: "host", __h: "marker", __id: marker.id, __name: marker.name }
}

function zoneOf(o: Val) {
  const zone = findZone(o.__name)
  if (zone === undefined) actionError("invalid-target", `zone "${o.__name}" removed`)
  return zone
}

defineHostObject("zone")
hostGetters.zone.name = (o: Val) => o.__name
hostGetters.zone.area = (o: Val) => {
  const area = zoneOf(o).area
  return { from: programPosition(area.left_top), to: programPosition(area.right_bottom) }
}
hostGetters.zone.center = (o: Val) => programPosition(zoneCenter(zoneOf(o)))
hostMethods.zone.contains = (o: Val, _k: Val, p: Val) => {
  const area = zoneOf(o).area
  const position = readPosition(p)
  if (position === undefined) actionError("invalid-target", "expected a position")
  return position.x >= area.left_top.x && position.x <= area.right_bottom.x && position.y >= area.left_top.y && position.y <= area.right_bottom.y
}
rawset(hostMethods.zone, "toString", (o: Val) => `zone ${o.__name}`)

host.zone = (name: Val) => {
  const zone = findZone(text(name))
  if (zone === undefined) actionError("invalid-target", `no zone "${text(name)}"`)
  return { __t: "host", __h: "zone", __name: zone.name }
}

/** Здания в зоне на любом расстоянии (без поля зрения доступно только неизменное). */
host.find = (what: Val, where: Val) => {
  const robot = currentRobot()
  if (type(where) !== "table" || where.__h !== "zone") actionError("invalid-target", "find needs a zone")
  const zone = zoneOf(where)
  const filter: { area: BoundingBox; force: unknown; name?: string; type?: string } = { area: zone.area, force: robot.entity.force }
  if (type(what) === "string") filter.name = what as string
  else if (type(what) === "table" && type(what.type) === "string") filter.type = what.type
  else actionError("invalid-target", 'find needs a name or { type: "…" }')
  const found = zone.surface.find_entities_filtered(filter as never)
  const result: Val[] = []
  for (const entity of found) {
    if (entity.type === "unit" || entity.type === "character" || entity.name === MARKER || entity.name === WORKER_MK1_PLACER || entity.name === WORKER_MK1) continue
    result.push(entityHandle(entity))
  }
  return programArray(result)
}

defineHostObject("map")
hostMethods.map.tag = (_o: Val, _k: Val, at: Val, label: Val, icon: Val) => {
  const robot = currentRobot()
  const position = readPosition(at)
  if (position === undefined) actionError("invalid-target", "expected a position")
  robot.entity.force.add_chart_tag(robot.entity.surface, {
    position,
    text: string.sub(text(label ?? ""), 1, 100),
    icon: icon === undefined ? undefined : { type: "item", name: item(icon) },
  })
}
hostMethods.map.untag = (_o: Val, _k: Val, at: Val) => {
  const robot = currentRobot()
  const position = readPosition(at)
  if (position === undefined) actionError("invalid-target", "expected a position")
  const area: BoundingBox = { left_top: { x: position.x - 1, y: position.y - 1 }, right_bottom: { x: position.x + 1, y: position.y + 1 } }
  for (const tag of robot.entity.force.find_chart_tags(robot.entity.surface, area)) tag.destroy()
}

// ---------- Время ----------

host.wait = (k: Val, seconds: Val) => {
  if (k !== undefined) return finishWaiting(k)
  const robot = currentRobot()
  return startWaiting("wait", (frame) => {
    frame.__poll = "wait"
    sleepUntil(robot.id, game.tick + ticks(seconds, 0))
  })
}
registerPoll("wait", (record) => resume(record, undefined))

host.waitUntil = (k: Val, condition: Val, options: Val) => {
  if (k !== undefined) return finishWaiting(k)
  if (truthy(program().calls(condition, undefined))) return $multi(true)
  const robot = currentRobot()
  const every = ticks(type(options) === "table" ? options.every : undefined, 1)
  const timeout = type(options) === "table" && options.timeout !== undefined ? ticks(options.timeout, 0) : undefined
  return startWaiting("waitUntil", (frame) => {
    frame.__poll = "waitUntil"
    frame.condition = condition
    frame.every = every
    frame.deadline = timeout === undefined ? undefined : game.tick + timeout
    sleepUntil(robot.id, game.tick + every)
  })
}
registerPoll("waitUntil", (record, frame, tick) => {
  if (truthy(program().calls(frame.condition, undefined))) return resume(record, true)
  if (frame.deadline !== undefined && tick >= frame.deadline) return resume(record, false)
  sleepUntil(record.robotId, tick + frame.every)
})
for (const name of ["wait", "waitUntil"]) hostBlocking[name] = true

host.exit = () => controlFlow("exit")
host.restart = () => controlFlow("restart")

defineHostObject("time")
hostGetters.time.tick = () => game.tick
hostGetters.time.seconds = () => game.tick / 60
hostGetters.time.daytime = () => currentRobot().entity.surface.daytime
hostMethods.time.isNight = () => currentRobot().entity.surface.darkness >= 0.5

// ---------- Мир ----------

function stacks(list: readonly { name: string; amount?: number }[] | undefined): Val {
  const items: Val[] = []
  for (const entry of list ?? []) items.push({ name: entry.name, count: entry.amount ?? 1 })
  return programArray(items)
}

defineHostObject("world")
hostMethods.world.recipe = (_o: Val, _k: Val, name: Val) => {
  const recipe = prototypes.recipe[text(name)]
  if (recipe === undefined) return undefined
  return { ingredients: stacks(recipe.ingredients), products: stacks(recipe.products as never), seconds: recipe.energy }
}
hostMethods.world.item = (_o: Val, _k: Val, name: Val) => {
  const prototype = prototypes.item[text(name)]
  if (prototype === undefined) return undefined
  return { stackSize: prototype.stack_size, fuelValue: prototype.fuel_value }
}
const research = defineHostObject("research")
hostGetters.research.current = () => currentRobot().entity.force.current_research?.name
hostGetters.research.progress = () => currentRobot().entity.force.research_progress
hostMethods.research.isDone = (_o: Val, _k: Val, tech: Val) => currentRobot().entity.force.technologies[text(tech)]?.researched === true
hostGetters.world.research = () => research

const PERIODS: Record<string, defines.flow_precision_index> = {
  "1m": defines.flow_precision_index.one_minute,
  "10m": defines.flow_precision_index.ten_minutes,
  "1h": defines.flow_precision_index.one_hour,
}
function flow(itemName: Val, period: Val, category: "input" | "output"): number {
  const robot = currentRobot()
  const statistics = robot.entity.force.get_item_production_statistics(robot.entity.surface)
  return statistics.get_flow_count({
    name: item(itemName),
    category,
    precision_index: PERIODS[text(period ?? "1m")] ?? defines.flow_precision_index.one_minute,
    count: true,
  })
}
const stats = defineHostObject("stats")
hostMethods.stats.produced = (_o: Val, _k: Val, name: Val, period: Val) => flow(name, period, "input")
hostMethods.stats.consumed = (_o: Val, _k: Val, name: Val, period: Val) => flow(name, period, "output")
hostGetters.world.stats = () => stats

// Math.random — свой генератор у каждой машины (одинаковый у всех игроков, переживает сохранение).
lib.Math.random = () => currentMachine().rng()
