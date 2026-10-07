// Реестр машин: id, имя, сущность, груз, топливо и запас энергии.
// id, имя и запас энергии переживают подбор — хранятся в теге предмета; груз и топливо при подборе
// переходят игроку, при гибели высыпаются на землю.
import { LuaEntity, LuaInventory, LuaItemStack, LuaRenderObject, LuaSurface, MapPosition, Tags } from "factorio:runtime"
import { Activity, ROBOT_TAG, WORKER_MK1 } from "../names"
import { directionOf, drawBody } from "./appearance"

export interface RobotRecord {
  id: number
  name: string
  entity: LuaEntity
  /** Подпись с именем над машиной (видна в режиме Alt). */
  label: LuaRenderObject
  /** Тело — анимация поверх прозрачного юнита (src/automaton/appearance.ts). */
  body: LuaRenderObject
  activity: Activity
  /** Направление анимации тела: 0 — север, по часовой стрелке через 45°. */
  direction: number
  /** Груз (скриптовый инвентарь) и топливный слот. */
  cargo: LuaInventory
  fuel: LuaInventory
  /** Запас энергии, Дж: тратится на путь и действия, пополняется сжиганием топлива. */
  energy: number
  /** Значок проблемы и облачко с текстом над машиной (src/automaton/status.ts). */
  problem?: LuaRenderObject
  bubble?: LuaRenderObject
}

export interface RobotRegistry {
  nextId: number
  byId: Record<number, RobotRecord | undefined>
  /** unit_number сущности → id машины. */
  idByUnit: Record<number, number | undefined>
}

/** Что машина уносит с собой в предмет при подборе. */
export interface RobotTag {
  id: number
  name: string
  energy?: number
}

export const CARGO_SLOTS = 10
/** Новая машина «заведена на заводе»: хватает примерно на 160 клеток пути без топлива. */
export const START_ENERGY = 2_000_000

const LABEL_COLOR = { r: 1, g: 0.8, b: 0.4 }

export function initRegistry(): void {
  storage.robots ??= { nextId: 1, byId: {}, idByUnit: {} }
}

export function findRobot(entity: LuaEntity): RobotRecord | undefined {
  const id = entity.unit_number === undefined ? undefined : storage.robots.idByUnit[entity.unit_number]
  return id === undefined ? undefined : storage.robots.byId[id]
}

/**
 * Поставить машину на учёт. С тегом из предмета она сохраняет прежние id и имя — если этот id
 * сейчас не занят (предмет могли размножить), иначе получает новый.
 */
export function registerRobot(entity: LuaEntity, tag?: RobotTag): RobotRecord {
  const registry = storage.robots
  const id = tag !== undefined && registry.byId[tag.id] === undefined ? tag.id : registry.nextId++
  const name = tag?.name ?? `AM-${id}`
  const label = rendering.draw_text({
    text: name,
    surface: entity.surface,
    target: { entity, offset: [0, -1.5] },
    color: LABEL_COLOR,
    alignment: "center",
    only_in_alt_mode: true,
  })
  const direction = directionOf(entity.orientation)
  const body = drawBody(entity, "idle", direction)
  const record: RobotRecord = {
    id,
    name,
    entity,
    label,
    body,
    activity: "idle",
    direction,
    cargo: game.create_inventory(CARGO_SLOTS),
    fuel: game.create_inventory(1),
    energy: tag?.energy ?? START_ENERGY,
  }
  registry.byId[id] = record
  registry.idByUnit[entity.unit_number!] = id
  script.register_on_object_destroyed(entity)
  return record
}

function forgetUnit(unitNumber: number): void {
  const registry = storage.robots
  const id = registry.idByUnit[unitNumber]
  if (id === undefined) return
  delete registry.idByUnit[unitNumber]
  const record = registry.byId[id]
  if (record !== undefined) {
    if (record.label.valid) record.label.destroy()
    if (record.body?.valid) record.body.destroy()
    if (record.cargo?.valid) record.cargo.destroy()
    if (record.fuel?.valid) record.fuel.destroy()
    delete registry.byId[id]
  }
}

/** Переложить всё из инвентаря в другой; что не влезло — высыпать на землю. */
function moveAll(from: LuaInventory, to: LuaInventory | undefined, surface: LuaSurface, position: MapPosition): void {
  for (let i = 0; i < from.length; i++) {
    const stack = from[i]
    if (!stack.valid_for_read) continue
    const moved = to === undefined ? 0 : to.insert(stack)
    if (moved < stack.count) {
      stack.count -= moved
      surface.spill_item_stack({ position, stack, enable_looted: true })
    }
    stack.clear()
  }
}

/** Груз и топливо машины — в инвентарь (или на землю, если он не указан или переполнен). */
function releaseItems(record: RobotRecord, to: LuaInventory | undefined): void {
  const { surface, position } = record.entity
  moveAll(record.cargo, to, surface, position)
  moveAll(record.fuel, to, surface, position)
}

export function robotTag(record: RobotRecord): RobotTag {
  return { id: record.id, name: record.name, energy: record.energy }
}

function readTag(tags: Tags | undefined): RobotTag | undefined {
  const tag = tags?.[ROBOT_TAG] as Partial<RobotTag> | undefined
  if (tag === undefined || typeof tag.id !== "number" || typeof tag.name !== "string") return undefined
  return { id: tag.id, name: tag.name, energy: typeof tag.energy === "number" ? tag.energy : undefined }
}

/** Тег машины из предмета, которым её построили (руками — инвентарь потраченного, роботом — стек). */
export function tagFromStack(stack: LuaItemStack | undefined): RobotTag | undefined {
  if (stack === undefined || !stack.valid_for_read || stack.name !== WORKER_MK1) return undefined
  return readTag(stack.tags)
}

export function tagFromInventory(inventory: LuaInventory | undefined): RobotTag | undefined {
  if (inventory === undefined) return undefined
  const [stack] = inventory.find_item_stack(WORKER_MK1)
  return tagFromStack(stack)
}

/**
 * Подобрали машину: записать id и имя в получившийся предмет и снять с учёта.
 * Вызывается из событий подбора игроком и строительным роботом. Персонаж без игрока
 * (mine_entity из скрипта) событий не вызывает — там предмет уходит без тега.
 */
export function tagMinedRobot(entity: LuaEntity, buffer: LuaInventory): void {
  const record = findRobot(entity)
  if (record === undefined) return
  const [stack] = buffer.find_item_stack(WORKER_MK1)
  if (stack !== undefined) {
    stack.set_tag(ROBOT_TAG, robotTag(record))
    stack.label = record.name
  }
  releaseItems(record, buffer)
  forgetUnit(entity.unit_number!)
}

/** Машина погибла: груз и топливо — на землю. */
function onDied(entity: LuaEntity): void {
  const record = findRobot(entity)
  if (record !== undefined) releaseItems(record, undefined)
}

/** Машины, которых нет в реестре (поставлены до появления реестра), — поставить на учёт. */
export function adoptUnregisteredRobots(): void {
  // Записи из прежних версий мода — дополнить недостающим.
  for (const record of Object.values(storage.robots.byId)) {
    if (record === undefined || !record.entity.valid) continue
    if (!record.body?.valid) {
      record.activity = "idle"
      record.direction = directionOf(record.entity.orientation)
      record.body = drawBody(record.entity, "idle", record.direction)
    }
    if (!record.cargo?.valid) record.cargo = game.create_inventory(CARGO_SLOTS)
    if (!record.fuel?.valid) record.fuel = game.create_inventory(1)
    record.energy ??= START_ENERGY
  }
  for (const [, surface] of game.surfaces) {
    for (const entity of surface.find_entities_filtered({ name: WORKER_MK1 })) {
      if (findRobot(entity) === undefined) registerRobot(entity)
    }
  }
}

export function registerRegistryEvents(): void {
  const filter = [{ filter: "name" as const, name: WORKER_MK1 }]
  script.on_event(defines.events.on_player_mined_entity, (e) => tagMinedRobot(e.entity, e.buffer), filter)
  script.on_event(defines.events.on_robot_mined_entity, (e) => tagMinedRobot(e.entity, e.buffer), filter)
  script.on_event(defines.events.on_entity_died, (e) => onDied(e.entity), filter)
  // Любое другое исчезновение (смерть, скрипт другого мода) — по регистрации на уничтожение.
  script.on_event(defines.events.on_object_destroyed, (e) => {
    if (e.type === defines.target_type.entity) forgetUnit(e.useful_id)
  })
}
