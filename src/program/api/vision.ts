// Зрение (4.6): scan.robots / buildings / ghosts / marked / items / trees / rocks / resources / enemies / water — только в радиусе зрения
// (Mk1 — 10 клеток), от ближнего к дальнему. Каждый взгляд стоит энергии, больше радиус — дороже.
// scan.buildings (19.2) — здания, с фильтром по классу и имени: scan.buildings({ kind: Furnace }).
// scan.trees, scan.rocks (21.2) — деревья и скалы: их рубят и разбивают me.mine.
// scan.ghosts (21.3) — призраки зданий своей команды (по чертежу), кроме призраков машин: их программа не строит.
// scan.marked (21.5) — помеченное к сносу: здания своей команды (разбирает deconstruct), деревья и скалы (me.mine).
import { LuaEntity, MapPosition } from "factorio:runtime"
import { spend } from "../../automaton/energy"
import { defineHostObject, hostMethods, Val } from "../../lang/runtime/core"
import { robotVision } from "../../automaton/models"
import { MARKER_ENTITIES, ROBOT_ENTITIES, ROBOT_PLACERS } from "../../names"
import { actionError, currentRobot } from "../context"
import { entityHandle, isOfClass, kindFilter, robotHandle } from "../handles"
import { buildingKind, nameList } from "./common"
import { programArray, programPosition } from "../values"
import { findCached } from "../cache"
import { RobotRecord } from "../../automaton/registry"
import { isNatural, isRock } from "../../automaton/mining"

/** Энергия взгляда радиусом 10 клеток. */
const SCAN_JOULES = 2_000
const MAX_RESULTS = 200
/** Не здания: машины, персонажи, призраки, предметы на земле, трупы, ресурсы, деревья, камни. */
const SKIPPED_TYPES: Record<string, boolean> = {
  unit: true,
  character: true,
  "entity-ghost": true,
  "tile-ghost": true,
  "item-entity": true,
  corpse: true,
  "character-corpse": true,
  resource: true,
  tree: true,
  "simple-entity": true,
  fish: true,
}
const WATER_TILES = ["water", "deepwater", "water-green", "deepwater-green", "water-shallow", "water-mud"]

/** Радиус взгляда (не больше зрения машины) и его цена. */
function look(radius: Val): number {
  const robot = currentRobot()
  const vision = robotVision(robot)
  const r = type(radius) === "number" && radius > 0 ? math.min(radius as number, vision) : vision
  if (!spend(robot, SCAN_JOULES * (r / 10) ** 2)) actionError("no-fuel")
  return r
}

function byDistance<T>(items: T[], position: (this: void, item: T) => MapPosition): T[] {
  const center = currentRobot().entity.position
  const keyed = items.map((item) => {
    const p = position(item)
    return { item, d: (p.x - center.x) ** 2 + (p.y - center.y) ** 2 }
  })
  table.sort(keyed, (a, b) => a.d < b.d)
  return keyed.slice(0, MAX_RESULTS).map((k) => k.item)
}

const scan = defineHostObject("scan")
void scan

/** Запрос зрения через кэш тика (13.3): ключ — все параметры запроса. */
function seen(robot: RobotRecord, kind: string, radius: number, filter: Record<string, unknown>): LuaEntity[] {
  const position = robot.entity.position
  const parts = [kind, position.x, position.y, radius]
  for (const [k, v] of pairs(filter)) parts.push(`${k}=${type(v) === "table" ? (v as string[]).join(",") : tostring(v)}`)
  table.sort(parts as string[], (a, b) => tostring(a) < tostring(b))
  return findCached(robot.entity.surface, parts.join("|"), { ...filter, position, radius } as never)
}

hostMethods.scan.robots = (_o: Val, _k: Val, radius: Val) => {
  const robot = currentRobot()
  const r = look(radius)
  const found = seen(robot, "robots", r, { name: ROBOT_ENTITIES as string[], force: robot.entity.force_index })
  const others: LuaEntity[] = []
  for (const entity of found) if (entity !== robot.entity && storage.robots.idByUnit[entity.unit_number!] !== undefined) others.push(entity)
  return programArray(byDistance(others, (e) => e.position).map((e) => robotHandle(storage.robots.idByUnit[e.unit_number!]!)))
}

hostMethods.scan.buildings = (_o: Val, _k: Val, filter: Val) => {
  const robot = currentRobot()
  const f = type(filter) === "table" ? filter : {}
  const kind = buildingKind(f.kind) ?? "Building"
  const r = look(f.radius)
  const byKind = kindFilter(kind)
  const filters: Record<string, unknown> = { force: robot.entity.force_index }
  const name = nameList(f.name) ?? byKind.name
  if (name !== undefined) filters.name = name
  if (byKind.type !== undefined) filters.type = byKind.type
  const found = seen(robot, "entities", r, filters)
  const buildings: LuaEntity[] = []
  for (const entity of found) {
    if (SKIPPED_TYPES[entity.type] || MARKER_ENTITIES.includes(entity.name) || ROBOT_PLACERS.includes(entity.name)) continue
    if (kind !== "Building" && !isOfClass(entity, kind)) continue
    buildings.push(entity)
  }
  return programArray(byDistance(buildings, (e) => e.position).map((e) => entityHandle(e)))
}

hostMethods.scan.items = (_o: Val, _k: Val, radius: Val) => {
  const robot = currentRobot()
  const found = seen(robot, "items", look(radius), { type: "item-entity" })
  const items = byDistance(found, (e) => e.position)
  return programArray(items.map((e) => ({ item: e.stack!.name, count: e.stack!.count, position: programPosition(e.position) })))
}

hostMethods.scan.ghosts = (_o: Val, _k: Val, filter: Val) => {
  const robot = currentRobot()
  const f = type(filter) === "table" ? filter : {}
  const filters: Record<string, unknown> = { type: "entity-ghost", force: robot.entity.force_index }
  const name = nameList(f.name)
  if (name !== undefined) filters.ghost_name = name
  const found = seen(robot, "ghosts", look(f.radius), filters).filter((e) => !ROBOT_PLACERS.includes(e.ghost_name))
  return programArray(byDistance(found, (e) => e.position).map((e) => entityHandle(e)))
}

hostMethods.scan.marked = (_o: Val, _k: Val, radius: Val) => {
  const robot = currentRobot()
  const force = robot.entity.force_index
  const found = seen(robot, "marked", look(radius), { to_be_deconstructed: true }).filter((e) => {
    if (isNatural(e)) return true
    return e.force_index === force && !SKIPPED_TYPES[e.type] && !MARKER_ENTITIES.includes(e.name) && !ROBOT_PLACERS.includes(e.name)
  })
  return programArray(byDistance(found, (e) => e.position).map((e) => entityHandle(e)))
}

hostMethods.scan.trees = (_o: Val, _k: Val, radius: Val) => {
  const robot = currentRobot()
  const found = seen(robot, "trees", look(radius), { type: "tree" })
  return programArray(byDistance(found, (e) => e.position).map((e) => entityHandle(e)))
}

hostMethods.scan.rocks = (_o: Val, _k: Val, radius: Val) => {
  const robot = currentRobot()
  const found = seen(robot, "rocks", look(radius), { type: "simple-entity" }).filter((e) => isRock(e))
  return programArray(byDistance(found, (e) => e.position).map((e) => entityHandle(e)))
}

hostMethods.scan.resources = (_o: Val, _k: Val, radius: Val) => {
  const robot = currentRobot()
  const center = robot.entity.position
  const found = seen(robot, "resources", look(radius), { type: "resource" })
  const patches = new LuaMap<string, { amount: number; tiles: number; x: number; y: number; nearest: MapPosition; d: number }>()
  const order: string[] = []
  for (const entity of found) {
    const product = entity.prototype.mineable_properties.products?.[0]?.name ?? entity.name
    const d = (entity.position.x - center.x) ** 2 + (entity.position.y - center.y) ** 2
    let patch = patches.get(product)
    if (patch === undefined) {
      patch = { amount: 0, tiles: 0, x: 0, y: 0, nearest: entity.position, d }
      patches.set(product, patch)
      order.push(product)
    }
    patch.amount += entity.amount
    patch.tiles++
    patch.x += entity.position.x
    patch.y += entity.position.y
    if (d < patch.d) {
      patch.d = d
      patch.nearest = entity.position
    }
  }
  table.sort(order, (a, b) => patches.get(a)!.d < patches.get(b)!.d)
  return programArray(
    order.map((name) => {
      const p = patches.get(name)!
      return {
        item: name,
        amount: p.amount,
        tiles: p.tiles,
        center: programPosition({ x: p.x / p.tiles, y: p.y / p.tiles }),
        nearest: programPosition(p.nearest),
      }
    }),
  )
}

hostMethods.scan.enemies = (_o: Val, _k: Val, radius: Val) => {
  const robot = currentRobot()
  const found = robot.entity.surface.find_entities_filtered({
    position: robot.entity.position,
    radius: look(radius),
    force: "enemy",
    type: ["unit", "unit-spawner", "turret"],
  })
  return programArray(byDistance(found, (e) => e.position).map((e) => entityHandle(e)))
}

hostMethods.scan.water = (_o: Val, _k: Val, radius: Val) => {
  const robot = currentRobot()
  const center = robot.entity.position
  const tiles = robot.entity.surface.find_tiles_filtered({ position: center, radius: look(radius), name: WATER_TILES })
  let best: MapPosition | undefined
  let bestD = math.huge
  for (const tile of tiles) {
    const p = { x: tile.position.x + 0.5, y: tile.position.y + 0.5 }
    const d = (p.x - center.x) ** 2 + (p.y - center.y) ** 2
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best === undefined ? undefined : programPosition(best)
}
