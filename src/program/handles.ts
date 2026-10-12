// Обёртки объектов игры для программ (4.3): здания, машины, инвентари — таблицы {__t = "host", __h = вид, …}.
// userdata Factorio в программы не попадают никогда: быстрое чтение поля o.x в сгенерированном коде
// иначе дало бы доступ к API игры (DESIGN.md, «Безопасность»).
//
// Видимость: неизменное (id, имя, тип, позиция здания, valid) читается всегда; состояние — только
// в поле зрения машины, иначе ActionError("out-of-sight").
//
// Классы (19.2): у обёртки здания __c — класс по типу прототипа (Furnace, Chest, …; враг — Enemy), свойства и
// методы — из таблиц класса (src/lang/runtime/core.ts), они наследуют таблицы Building.
import { LuaEntity, LuaInventory, MapPosition } from "factorio:runtime"
import { currentAction } from "../automaton/actions"
import { distanceToEntity } from "../automaton/actions"
import { entityFluid, entityFuel, entityInput, entityItemCount, entityOutput, entityProgress, entityRecipe, entityStatus } from "../automaton/inspect"
import { fuelLevel } from "../automaton/energy"
import { isRock, isTree, naturalProducts } from "../automaton/mining"
import { entityRequests, moduleSlots, requestedItems } from "../automaton/modules"
import { robotPosition } from "../automaton/flight"
import { modelOfRecord, robotVision } from "../automaton/models"
import { isMoving } from "../automaton/movement"
import { RobotRecord } from "../automaton/registry"
import { defineHostObject, hostGetters, hostKindClass, hostMethods, hostSetters, Val } from "../lang/runtime/core"
import { isHostSubclass } from "../lang/hostClasses"
import { CHARGING_STATION } from "../names"
import { actionError, currentRobot } from "./context"
import { programArray, programPosition, readPosition, robotHandle } from "./values"

export { robotHandle }

/** Характеристики модели Mk1 (docs/API.md, «Модели машин»). */
/** Досягаемость — как у персонажа, у всех моделей одна. Остальное — у модели (src/automaton/models.ts). */
export const ROBOT_REACH = { reach: 10, mineReach: 2.7 }

export interface HandlesState {
  /** Обёртки зданий по unit_number: одна на здание, чтобы === и ключи Map работали. */
  entities: Record<number, Val | undefined>
  robots: Record<number, Val | undefined>
}

export function initHandles(): void {
  storage.handles ??= { entities: {}, robots: {} }
}

/** Обёртка здания заново больше не нужна (здание исчезло) — программы, державшие её, видят valid === false. */
export function forgetEntityHandle(unitNumber: number): void {
  storage.handles.entities[unitNumber] = undefined
}

/** Класс здания по типу прототипа (4C); остальные здания — Building. */
const CLASS_BY_TYPE: Record<string, string> = {
  container: "Chest",
  "logistic-container": "Chest",
  furnace: "Furnace",
  "assembling-machine": "Assembler",
  "rocket-silo": "RocketSilo",
  lab: "Lab",
  beacon: "Beacon",
  boiler: "Boiler",
  generator: "Generator",
  reactor: "Reactor",
  "storage-tank": "StorageTank",
  pipe: "Pipe",
  "pipe-to-ground": "Pipe",
  pump: "Pipe",
  "ammo-turret": "Turret",
  "artillery-turret": "Turret",
  "fluid-turret": "FlameTurret",
  "cargo-wagon": "CargoWagon",
  "fluid-wagon": "FluidWagon",
  locomotive: "Locomotive",
  car: "Vehicle",
  "spider-vehicle": "Vehicle",
}

/** Класс объекта игры для обёртки здания: враги — Enemy, деревья и скалы — Tree и Rock, станция зарядки — по имени, остальное — по типу. */
export function buildingClass(entity: LuaEntity): string {
  if (entity.force.name === "enemy") return "Enemy"
  if (isTree(entity)) return "Tree"
  if (isRock(entity)) return "Rock"
  if (entity.type === "entity-ghost" || entity.type === "tile-ghost") return "Ghost"
  if (entity.name === CHARGING_STATION) return "ChargingStation"
  return CLASS_BY_TYPE[entity.type] ?? "Building"
}

/**
 * Отбор зданий класса kind (zone.find(Furnace), scan.buildings({ kind: Chest })): фильтр для поиска движка
 * (типы или имя; у Building — без фильтра) и проверка найденного.
 */
export function kindFilter(kind: string): { type?: string[]; name?: string } {
  if (kind === "Building") return {}
  if (kind === "ChargingStation") return { name: CHARGING_STATION }
  const types: string[] = []
  for (const [prototypeType, cls] of pairs(CLASS_BY_TYPE)) if (isHostSubclass(cls, kind)) types.push(prototypeType)
  table.sort(types)
  return { type: types }
}

export function isOfClass(entity: LuaEntity, kind: string): boolean {
  return isHostSubclass(buildingClass(entity), kind)
}

export function entityHandle(entity: LuaEntity): Val {
  const unit = entity.unit_number
  if (unit !== undefined) {
    const existing = storage.handles.entities[unit]
    if (existing !== undefined) return existing
  }
  const position = entity.position
  const handle = {
    __t: "host",
    __h: "entity",
    __c: buildingClass(entity),
    __e: entity,
    __id: unit,
    // У призрака — имя здания, которое по нему встанет.
    __name: entity.type === "entity-ghost" || entity.type === "tile-ghost" ? entity.ghost_name : entity.name,
    __type: entity.type,
    __x: position.x,
    __y: position.y,
  }
  if (unit !== undefined) {
    storage.handles.entities[unit] = handle
    script.register_on_object_destroyed(entity)
  }
  return handle
}

/** Чем строить призрак здания или плитки (tile) name: первый предмет, который его ставит (у прямых рельсов — рельс). */
export function ghostItem(name: string, tile = false): { name: string; count: number } | undefined {
  const item = (tile ? prototypes.tile[name] : prototypes.entity[name])?.items_to_place_this?.[0]
  return item === undefined ? undefined : { name: item.name, count: item.count }
}

const DIRECTION_NAMES = ["north", "east", "south", "west"]

/** Направление сущности словом API (Direction): из 16 направлений игры — ближайшее из четырёх. */
export function directionName(direction: defines.direction): string {
  return DIRECTION_NAMES[math.floor((direction + 2) / 4) % 4]
}

/** Здание из обёртки (проверка вида и существования). */
export function handleEntity(value: Val): LuaEntity {
  if (type(value) !== "table" || value.__t !== "host" || value.__h !== "entity") actionError("invalid-target", "not a building")
  const entity = value.__e as LuaEntity
  if (!entity.valid) actionError("invalid-target")
  return entity
}

export function handleRobot(value: Val): RobotRecord {
  if (type(value) !== "table" || value.__t !== "host" || value.__h !== "robot") actionError("invalid-target", "not a robot")
  const record = storage.robots.byId[value.__id]
  if (record === undefined || !record.entity.valid) actionError("invalid-target")
  return record
}

// ---------- Видимость ----------

export function inSight(entity: LuaEntity): boolean {
  const robot = currentRobot()
  return entity.valid && distanceToEntity(robot.entity.position, entity) <= robotVision(robot)
}

function requireSight(entity: LuaEntity): void {
  if (!entity.valid) actionError("invalid-target")
  if (!inSight(entity)) actionError("out-of-sight")
}

function robotInSight(record: RobotRecord): boolean {
  return record === currentRobot() || inSight(record.entity)
}

function sightedRobot(handle: Val): RobotRecord {
  const record = handleRobot(handle)
  if (!robotInSight(record)) actionError("out-of-sight")
  return record
}

// ---------- Инвентари ----------

function inventoryHandle(fields: Val): Val {
  fields.__t = "host"
  fields.__h = "inventory"
  return fields
}

export function resolveInventory(handle: Val): LuaInventory {
  if (handle.__robot !== undefined) {
    const record = storage.robots.byId[handle.__robot]
    if (record === undefined || !record.entity.valid) actionError("invalid-target")
    return record.cargo
  }
  const entity = handle.__e as LuaEntity
  requireSight(entity)
  const inventory = handle.__which === "input" ? entityInput(entity) : handle.__which === "output" ? entityOutput(entity) : entityFuel(entity)
  if (inventory === undefined || !inventory.valid) actionError("invalid-target")
  return inventory
}

function itemName(value: Val): string | undefined {
  if (value === undefined) return undefined
  if (type(value) !== "string" || prototypes.item[value as string] === undefined) actionError("invalid-target", `unknown item ${tostring(value)}`)
  return value as string
}

defineHostObject("inventory")
hostMethods.inventory.count = (o: Val, _k: Val, item: Val) => {
  const inventory = resolveInventory(o)
  const name = itemName(item)
  return name === undefined ? inventory.get_item_count() : inventory.get_item_count(name)
}
hostMethods.inventory.items = (o: Val) => {
  const inventory = resolveInventory(o)
  const items: Val[] = []
  for (const content of inventory.get_contents()) items.push({ name: content.name, count: content.count })
  return programArray(items)
}
hostMethods.inventory.free = (o: Val, _k: Val, item: Val) => {
  const inventory = resolveInventory(o)
  const name = itemName(item)
  return name === undefined ? inventory.count_empty_stacks() : inventory.get_insertable_count(name)
}
hostMethods.inventory.isEmpty = (o: Val) => resolveInventory(o).is_empty()
hostMethods.inventory.isFull = (o: Val) => resolveInventory(o).is_full()

export function cargoHandle(record: RobotRecord): Val {
  return inventoryHandle({ __robot: record.id })
}

// ---------- Здания ----------
// Свойства и методы всех зданий — в таблицах Building (подклассы их наследуют). Обёртки без __c (сохранения до
// 19.2, которые миграция не застала) — по виду "entity": те же таблицы.

hostKindClass.entity = "Building"
hostGetters.entity = hostGetters.Building
hostMethods.entity = hostMethods.Building
hostSetters.entity = hostSetters.Building
const entityGetters = hostGetters.Building
entityGetters.id = (o: Val) => o.__id
entityGetters.valid = (o: Val) => (o.__e as LuaEntity).valid
entityGetters.name = (o: Val) => o.__name
entityGetters.type = (o: Val) => o.__type
entityGetters.position = (o: Val) => programPosition({ x: o.__x, y: o.__y })
entityGetters.inSight = (o: Val) => inSight(o.__e)
entityGetters.status = (o: Val) => {
  requireSight(o.__e)
  return entityStatus(o.__e)
}
entityGetters.health = (o: Val) => {
  const entity = o.__e as LuaEntity
  requireSight(entity)
  return entity.max_health > 0 ? entity.health! / entity.max_health : 1
}
// Члены классов (docs/API.md, «Классы зданий»): у класса без члена его нет и во время выполнения.
const ITEM_CLASSES = ["Chest", "Furnace", "Assembler", "RocketSilo", "Lab", "Boiler", "Reactor", "Turret", "CargoWagon", "Locomotive", "Vehicle"]
const FLUID_CLASSES = ["Assembler", "Boiler", "Generator", "StorageTank", "Pipe", "FlameTurret", "FluidWagon"]
const CRAFTING_CLASSES = ["Furnace", "Assembler", "RocketSilo"]

function members(registry: Record<string, Record<string, Val>>, classes: string[], name: string, fn: Val): void {
  for (const cls of classes) registry[cls][name] = fn
}

members(hostGetters, CRAFTING_CLASSES, "recipe", (o: Val) => {
  requireSight(o.__e)
  return entityRecipe(o.__e)
})
members(hostGetters, CRAFTING_CLASSES, "progress", (o: Val) => {
  requireSight(o.__e)
  return entityProgress(o.__e)
})
members(hostMethods, ITEM_CLASSES, "count", (o: Val, _k: Val, item: Val) => {
  requireSight(o.__e)
  const name = itemName(item)
  return name === undefined ? (o.__e as LuaEntity).get_item_count() : entityItemCount(o.__e, name)
})
function inventoryMethod(which: "input" | "output" | "fuel"): Val {
  return (o: Val) => {
    const entity = o.__e as LuaEntity
    requireSight(entity)
    const inventory = which === "input" ? entityInput(entity) : which === "output" ? entityOutput(entity) : entityFuel(entity)
    return inventory === undefined ? undefined : inventoryHandle({ __e: entity, __which: which })
  }
}
members(hostMethods, ["Furnace", "Assembler", "RocketSilo", "Lab"], "input", inventoryMethod("input"))
members(hostMethods, CRAFTING_CLASSES, "output", inventoryMethod("output"))
members(hostMethods, ["Furnace", "Boiler", "Reactor", "Locomotive", "Vehicle"], "fuel", inventoryMethod("fuel"))
// Содержимое сундука, вагона, багажника и патроны турели — это «вход» здания (src/automaton/inspect.ts).
members(hostMethods, ["Chest", "CargoWagon", "Vehicle"], "inventory", inventoryMethod("input"))
hostMethods.Turret.ammo = inventoryMethod("input")
members(hostMethods, FLUID_CLASSES, "fluid", (o: Val, _k: Val, name: Val) => {
  requireSight(o.__e)
  return entityFluid(o.__e, name === undefined ? undefined : tostring(name))
})
// Модули (21.4): какие стоят и что просит чертёж; поставить и снять — действия (src/program/api/actions.ts).
export const MODULE_CLASSES = ["Furnace", "Assembler", "RocketSilo", "Lab", "Beacon"]
members(hostMethods, MODULE_CLASSES, "modules", (o: Val) => {
  requireSight(o.__e)
  const slots = moduleSlots(o.__e)
  const items: Val[] = []
  for (const content of slots?.get_contents() ?? []) items.push({ name: content.name, count: content.count })
  return programArray(items)
})
members(hostMethods, MODULE_CLASSES, "requests", (o: Val) => {
  requireSight(o.__e)
  return programArray(entityRequests(o.__e))
})
const entityMethods = hostMethods.Building
rawset(entityMethods, "toString", (o: Val) => `${o.__name}#${tostring(o.__id ?? "?")}`)

// Враги — обёртки зданий с классом Enemy: только то, что объявлено у Enemy.
for (const key of ["id", "valid", "inSight", "name", "position", "health"]) hostGetters.Enemy[key] = entityGetters[key]
rawset(hostMethods.Enemy, "toString", entityMethods.toString)

// Деревья и скалы (21.2) — тоже обёртки сущностей, с классами Tree и Rock: место, имя и что дают. Номера у них
// нет, поэтому обёртка не одна на дерево: сравнивать деревья — по месту.
for (const cls of ["Tree", "Rock"]) {
  for (const key of ["valid", "inSight", "name", "position"]) hostGetters[cls][key] = entityGetters[key]
  hostGetters[cls].products = (o: Val) => programArray(naturalProducts(o.__name))
  rawset(hostMethods[cls], "toString", (o: Val) => `${o.__name}(${o.__x}, ${o.__y})`)
}

// Призраки (21.3) — здания по чертежу, ещё не построенные: что встанет, каким предметом, где, куда повёрнуто.
// Призрак плитки (21.6: бетон, засыпка) — тоже Ghost: name — плитка, item — чем её класть.
for (const key of ["id", "valid", "inSight", "name", "position"]) hostGetters.Ghost[key] = entityGetters[key]
hostGetters.Ghost.item = (o: Val) => ghostItem(o.__name, o.__type === "tile-ghost")?.name
hostGetters.Ghost.direction = (o: Val) => {
  const entity = o.__e as LuaEntity
  if (!entity.valid) actionError("invalid-target")
  return directionName(entity.direction)
}
// Что чертёж просит доставить в здание этого призрака (модули): неизменно, пока призрак не построен.
hostMethods.Ghost.requests = (o: Val) => {
  const entity = o.__e as LuaEntity
  if (!entity.valid) actionError("invalid-target")
  return programArray(entity.type === "tile-ghost" ? [] : requestedItems(entity.insert_plan))
}
rawset(hostMethods.Ghost, "toString", (o: Val) => `ghost:${o.__name}#${tostring(o.__id ?? "?")}`)

// ---------- Машины ----------

/** Состояние машины одним словом (Robot.state). */
export function robotState(record: RobotRecord): string {
  const machine = storage.machines[record.id]
  if (machine?.machine.status === "error") return "error"
  const action = currentAction(record)
  if (action !== undefined) {
    if (action.kind === "mine") return "mining"
    if (action.kind === "repair") return "building"
    if (action.kind === "wait") return "waiting"
    if (action.kind === "pump") return "pumping"
    return "transferring"
  }
  if (isMoving(record)) return "moving"
  if (record.energy <= 0 && record.fuel.is_empty()) return "no-fuel"
  if (machine?.machine.status === "waiting") return "waiting"
  if (machine?.machine.status === "ready") return "thinking"
  return "idle"
}

export function robotProgramName(record: RobotRecord): string | undefined {
  const programId = storage.machines[record.id]?.programId
  return programId === undefined ? undefined : storage.programs.byId[programId]?.name
}

export function robotHealth(record: RobotRecord): number {
  const entity = record.entity
  return entity.max_health > 0 ? entity.health! / entity.max_health : 1
}

defineHostObject("robot")
hostKindClass.robot = "Robot"
const robotGetters = hostGetters.robot
robotGetters.id = (o: Val) => o.__id
robotGetters.name = (o: Val) => storage.robots.byId[o.__id]?.name
robotGetters.model = (o: Val) => {
  const record = storage.robots.byId[o.__id]
  return record === undefined ? undefined : modelOfRecord(record).id
}
robotGetters.valid = (o: Val) => storage.robots.byId[o.__id]?.entity.valid === true
robotGetters.inSight = (o: Val) => {
  const record = storage.robots.byId[o.__id]
  return record !== undefined && record.entity.valid && robotInSight(record)
}
robotGetters.position = (o: Val) => programPosition(robotPosition(sightedRobot(o)))
robotGetters.state = (o: Val) => robotState(sightedRobot(o))
robotGetters.program = (o: Val) => robotProgramName(sightedRobot(o))
robotGetters.health = (o: Val) => robotHealth(sightedRobot(o))
robotGetters.energy = (o: Val) => ({ level: fuelLevel(sightedRobot(o)) })
hostMethods.robot.distance = (o: Val, _k: Val, to: Val) => distanceBetween(sightedRobot(o).entity.position, to)
rawset(hostMethods.robot, "toString", (o: Val) => `${storage.robots.byId[o.__id]?.name ?? "robot"}#${o.__id}`)

// ---------- Цели ----------

export interface ResolvedTarget {
  position: MapPosition
  entity?: LuaEntity
}

/** Позиция или здание цели: Position, Entity, Robot (в поле зрения), Marker, Zone. */
export function resolveTarget(value: Val): ResolvedTarget {
  // Частая ошибка: scan.entities(...)[0] или find(...)[0] ничего не нашли.
  if (value === undefined) actionError("invalid-target", "the target is undefined (scan or find found nothing?)")
  const position = readPosition(value)
  if (position !== undefined) return { position }
  if (type(value) === "table" && value.__t === "host") {
    switch (value.__h) {
      case "entity": {
        const entity = handleEntity(value)
        return { position: entity.position, entity }
      }
      case "robot": {
        const record = sightedRobot(value)
        return { position: record.entity.position, entity: record.entity }
      }
      case "marker": {
        const marker = storage.markers.byId[value.__id]
        if (marker === undefined || !marker.entity.valid) actionError("invalid-target", "marker removed")
        return { position: marker.entity.position, entity: marker.entity }
      }
      case "zone": {
        const zone = storage.zones.byName[value.__name]
        if (zone === undefined) actionError("invalid-target", "zone removed")
        return { position: { x: (zone.area.left_top.x + zone.area.right_bottom.x) / 2, y: (zone.area.left_top.y + zone.area.right_bottom.y) / 2 } }
      }
    }
  }
  actionError("invalid-target", "expected a position, building, robot, marker or zone")
}

export function distanceBetween(from: MapPosition, to: Val): number {
  const target = resolveTarget(to)
  if (target.entity !== undefined && target.entity.type !== "unit") return distanceToEntity(from, target.entity)
  return math.sqrt((target.position.x - from.x) ** 2 + (target.position.y - from.y) ** 2)
}
