// Обёртки объектов игры для программ (4.3): здания, машины, инвентари — таблицы {__t = "host", __h = вид, …}.
// userdata Factorio в программы не попадают никогда: быстрое чтение поля o.x в сгенерированном коде
// иначе дало бы доступ к API игры (DESIGN.md, «Безопасность»).
//
// Видимость: неизменное (id, имя, тип, позиция здания, valid) читается всегда; состояние — только
// в поле зрения машины, иначе ActionError("out-of-sight").
import { LuaEntity, LuaInventory, MapPosition } from "factorio:runtime"
import { currentAction } from "../automaton/actions"
import { distanceToEntity } from "../automaton/actions"
import { entityFluid, entityFuel, entityInput, entityItemCount, entityOutput, entityProgress, entityRecipe, entityStatus } from "../automaton/inspect"
import { modelOfRecord, robotVision } from "../automaton/models"
import { isMoving } from "../automaton/movement"
import { RobotRecord } from "../automaton/registry"
import { defineHostObject, hostGetters, hostMethods, Val } from "../lang/runtime/core"
import { actionError, currentRobot } from "./context"
import { programArray, programPosition, readPosition } from "./values"

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

export function entityHandle(entity: LuaEntity): Val {
  const unit = entity.unit_number
  if (unit !== undefined) {
    const existing = storage.handles.entities[unit]
    if (existing !== undefined) return existing
  }
  const position = entity.position
  const handle = { __t: "host", __h: "entity", __e: entity, __id: unit, __name: entity.name, __type: entity.type, __x: position.x, __y: position.y }
  if (unit !== undefined) {
    storage.handles.entities[unit] = handle
    script.register_on_object_destroyed(entity)
  }
  return handle
}

export function robotHandle(id: number): Val {
  const existing = storage.handles.robots[id]
  if (existing !== undefined) return existing
  const handle = { __t: "host", __h: "robot", __id: id }
  storage.handles.robots[id] = handle
  return handle
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

function resolveInventory(handle: Val): LuaInventory {
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

defineHostObject("entity")
const entityGetters = hostGetters.entity
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
entityGetters.recipe = (o: Val) => {
  requireSight(o.__e)
  return entityRecipe(o.__e)
}
entityGetters.progress = (o: Val) => {
  requireSight(o.__e)
  return entityProgress(o.__e)
}
const entityMethods = hostMethods.entity
entityMethods.count = (o: Val, _k: Val, item: Val) => {
  requireSight(o.__e)
  const name = itemName(item)
  return name === undefined ? (o.__e as LuaEntity).get_item_count() : entityItemCount(o.__e, name)
}
for (const which of ["input", "output", "fuel"] as const) {
  entityMethods[which] = (o: Val) => {
    const entity = o.__e as LuaEntity
    requireSight(entity)
    const inventory = which === "input" ? entityInput(entity) : which === "output" ? entityOutput(entity) : entityFuel(entity)
    return inventory === undefined ? undefined : inventoryHandle({ __e: entity, __which: which })
  }
}
entityMethods.fluid = (o: Val, _k: Val, name: Val) => {
  requireSight(o.__e)
  return entityFluid(o.__e, name === undefined ? undefined : tostring(name))
}
rawset(entityMethods, "toString", (o: Val) => `${o.__name}#${tostring(o.__id ?? "?")}`)

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
robotGetters.position = (o: Val) => programPosition(sightedRobot(o).entity.position)
robotGetters.state = (o: Val) => robotState(sightedRobot(o))
robotGetters.program = (o: Val) => robotProgramName(sightedRobot(o))
robotGetters.health = (o: Val) => robotHealth(sightedRobot(o))
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
