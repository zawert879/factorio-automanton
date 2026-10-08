// Реестр машин: id, имя, сущность, груз, топливо и запас энергии.
// id, имя и запас энергии переживают подбор — хранятся в теге предмета; груз и топливо при подборе
// переходят игроку, при гибели высыпаются на землю.
import { onEvent } from "../events"
import { LuaEntity, LuaInventory, LuaItemStack, LuaRenderObject, LuaSurface, MapPosition, Tags } from "factorio:runtime"
import { Activity, modelOf, ROBOT_ENTITIES, ROBOT_TAG } from "../names"
import { directionOf, drawBody } from "./appearance"
import { applyUpgrades } from "./models"
import type { Tank } from "./tank"

export interface RobotRecord {
  id: number
  name: string
  entity: LuaEntity
  /** Модель — имя сущности юнита (src/names.ts, MODELS); переживает гибель сущности. */
  model: string
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
  /** Оружейный слот (патроны) — у боевых моделей. */
  weapon?: LuaInventory
  /** Запас энергии, Дж: тратится на путь и действия, пополняется сжиганием топлива. */
  energy: number
  /** Бак для жидкости (src/automaton/fluids.ts). */
  tank: Tank
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
  /** Бак уезжает вместе с машиной. */
  tank?: Tank
}

/** Груз Mk1 без исследований (у моделей — MODELS[].cargoSlots). */
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
  const model = modelOf(entity.name)!
  const record: RobotRecord = {
    id,
    name,
    entity,
    model: entity.name,
    label,
    body,
    activity: "idle",
    direction,
    cargo: game.create_inventory(model.cargoSlots),
    fuel: game.create_inventory(1),
    weapon: model.weapon === undefined ? undefined : game.create_inventory(1),
    energy: tag?.energy ?? model.battery ?? START_ENERGY,
    tank: tag?.tank ?? { amount: 0, temperature: 15 },
  }
  registry.byId[id] = record
  registry.idByUnit[entity.unit_number!] = id
  applyUpgrades(record)
  // Боевые — с оружием на виду (значок пулемёта или ракетомёта у плеча; исчезает вместе с машиной).
  if (model.weapon !== undefined) {
    rendering.draw_sprite({
      sprite: model.weapon.type === "gun" ? "item/submachine-gun" : "item/rocket-launcher",
      target: { entity, offset: [0.22, -0.5] },
      surface: entity.surface,
      x_scale: 0.4,
      y_scale: 0.4,
      render_layer: "higher-object-under",
    })
  }
  script.register_on_object_destroyed(entity)
  for (const listener of registeredListeners) listener(record)
  return record
}

function forgetUnit(unitNumber: number, reason: "mined" | "destroyed"): void {
  const registry = storage.robots
  const id = registry.idByUnit[unitNumber]
  if (id === undefined) return
  delete registry.idByUnit[unitNumber]
  for (const listener of removedListeners) listener(id, reason)
  const record = registry.byId[id]
  if (record !== undefined) {
    if (record.label.valid) record.label.destroy()
    if (record.body?.valid) record.body.destroy()
    if (record.cargo?.valid) record.cargo.destroy()
    if (record.fuel?.valid) record.fuel.destroy()
    if (record.weapon?.valid) record.weapon.destroy()
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
  if (record.weapon !== undefined) moveAll(record.weapon, to, surface, position)
}

export function robotTag(record: RobotRecord): RobotTag {
  return { id: record.id, name: record.name, energy: record.energy, tank: record.tank.amount > 0 ? record.tank : undefined }
}

function readTag(tags: Tags | undefined): RobotTag | undefined {
  const tag = tags?.[ROBOT_TAG] as Partial<RobotTag> | undefined
  if (tag === undefined || typeof tag.id !== "number" || typeof tag.name !== "string") return undefined
  const tank = tag.tank
  const validTank =
    tank !== undefined && typeof tank.amount === "number" && typeof tank.temperature === "number" && (tank.fluid === undefined || typeof tank.fluid === "string")
      ? { fluid: tank.fluid, amount: tank.amount, temperature: tank.temperature }
      : undefined
  return { id: tag.id, name: tag.name, energy: typeof tag.energy === "number" ? tag.energy : undefined, tank: validTank }
}

/** Тег машины из предмета, которым её построили (руками — инвентарь потраченного, роботом — стек). */
export function tagFromStack(stack: LuaItemStack | undefined): RobotTag | undefined {
  if (stack === undefined || !stack.valid_for_read || modelOf(stack.name) === undefined) return undefined
  return readTag(stack.tags)
}

export function tagFromInventory(inventory: LuaInventory | undefined, item: string): RobotTag | undefined {
  if (inventory === undefined) return undefined
  const [stack] = inventory.find_item_stack(item)
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
  const [stack] = buffer.find_item_stack(record.model)
  if (stack !== undefined) {
    stack.set_tag(ROBOT_TAG, robotTag(record))
    stack.label = record.name
  }
  releaseItems(record, buffer)
  forgetUnit(entity.unit_number!, "mined")
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
    record.model ??= record.entity.name
    if (!record.cargo?.valid) record.cargo = game.create_inventory(CARGO_SLOTS)
    if (!record.fuel?.valid) record.fuel = game.create_inventory(1)
    if (modelOf(record.model)?.weapon !== undefined && !record.weapon?.valid) record.weapon = game.create_inventory(1)
    record.energy ??= START_ENERGY
    record.tank ??= { amount: 0, temperature: 15 }
    applyUpgrades(record)
  }
  for (const [, surface] of game.surfaces) {
    for (const entity of surface.find_entities_filtered({ name: ROBOT_ENTITIES as string[] })) {
      if (findRobot(entity) === undefined) registerRobot(entity)
    }
  }
}

export function registerRegistryEvents(): void {
  const isWorker = (entity: LuaEntity) => entity.valid && modelOf(entity.name) !== undefined
  onEvent(defines.events.on_player_mined_entity, (e) => {
    if (isWorker(e.entity)) tagMinedRobot(e.entity, e.buffer)
  })
  onEvent(defines.events.on_robot_mined_entity, (e) => {
    if (isWorker(e.entity)) tagMinedRobot(e.entity, e.buffer)
  })
  onEvent(defines.events.on_entity_died, (e) => {
    if (isWorker(e.entity)) onDied(e.entity)
  })
  // Любое другое исчезновение (смерть, скрипт другого мода) — по регистрации на уничтожение.
  onEvent(defines.events.on_object_destroyed, (e) => {
    if (e.type === defines.target_type.entity) forgetUnit(e.useful_id, "destroyed")
  })
}

// ---------- Подписки других модулей ----------

const registeredListeners: Array<(this: void, record: RobotRecord) => void> = []
const removedListeners: Array<(this: void, id: number, reason: "mined" | "destroyed") => void> = []

/** Машину поставили на учёт (в том числе снова — из подобранного предмета с прежним id). */
export function onRobotRegistered(listener: (this: void, record: RobotRecord) => void): void {
  registeredListeners.push(listener)
}

/** Машину сняли с учёта: подобрали (mined) или уничтожили (destroyed). */
export function onRobotRemoved(listener: (this: void, id: number, reason: "mined" | "destroyed") => void): void {
  removedListeners.push(listener)
}
