// Реестр машин: id, имя, сущность. id и имя переживают подбор — хранятся в теге предмета.
import { LuaEntity, LuaInventory, LuaItemStack, LuaRenderObject, Tags } from "factorio:runtime"
import { ROBOT_TAG, WORKER_MK1 } from "../names"

export interface RobotRecord {
  id: number
  name: string
  entity: LuaEntity
  /** Подпись с именем над машиной (видна в режиме Alt). */
  label: LuaRenderObject
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
}

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
  const record: RobotRecord = { id, name, entity, label }
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
    delete registry.byId[id]
  }
}

export function robotTag(record: RobotRecord): RobotTag {
  return { id: record.id, name: record.name }
}

function readTag(tags: Tags | undefined): RobotTag | undefined {
  const tag = tags?.[ROBOT_TAG] as Partial<RobotTag> | undefined
  if (tag === undefined || typeof tag.id !== "number" || typeof tag.name !== "string") return undefined
  return { id: tag.id, name: tag.name }
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
  forgetUnit(entity.unit_number!)
}

/** Машины, которых нет в реестре (поставлены до появления реестра), — поставить на учёт. */
export function adoptUnregisteredRobots(): void {
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
  // Любое другое исчезновение (смерть, скрипт другого мода) — по регистрации на уничтожение.
  script.on_event(defines.events.on_object_destroyed, (e) => {
    if (e.type === defines.target_type.entity) forgetUnit(e.useful_id)
  })
}
