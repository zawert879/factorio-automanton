// Кэши запросов к движку (13.3).
// - find по зоне: результат хранится в записи зоны (в storage — у зашедшего игрока тот же кэш, что
//   у всех) и сбрасывается постройкой или сносом в зоне; при попадании проверяется, что здания живы.
// - scan: одинаковый запрос в одном тике — один вызов движка. Кэш живёт тик (сохранение — между
//   тиками, поэтому в storage он не нужен) и сбрасывается любой постройкой или сносом.
import { LuaEntity, LuaSurface } from "factorio:runtime"
import { onEvent } from "../events"

let tickCache: { tick: number; results: LuaMap<string, LuaEntity[]> } | undefined

/** find_entities_filtered с кэшем на тик; key — все параметры запроса строкой. */
export function findCached(surface: LuaSurface, key: string, filter: Parameters<LuaSurface["find_entities_filtered"]>[0]): LuaEntity[] {
  if (tickCache === undefined || tickCache.tick !== game.tick) tickCache = { tick: game.tick, results: new LuaMap() }
  const fullKey = `${surface.index}|${key}`
  const cached = tickCache.results.get(fullKey)
  if (cached !== undefined) return cached
  const found = surface.find_entities_filtered(filter)
  tickCache.results.set(fullKey, found)
  return found
}

/** Постройка или снос: кэши scan — сбросить, кэши find зон, которых коснулось, — тоже. */
function changed(entity: LuaEntity | undefined): void {
  tickCache = undefined
  if (entity === undefined || !entity.valid) {
    for (const [, zone] of pairs(storage.zones.byName)) zone.found = undefined
    return
  }
  const { x, y } = entity.position
  const surface = entity.surface_index
  for (const [, zone] of pairs(storage.zones.byName)) {
    if (zone.found === undefined || zone.surface.index !== surface) continue
    const a = zone.area
    // С запасом: большое здание задевает зону краем.
    if (x >= a.left_top.x - 5 && x <= a.right_bottom.x + 5 && y >= a.left_top.y - 5 && y <= a.right_bottom.y + 5) zone.found = undefined
  }
}

export function registerCache(): void {
  const events = [
    defines.events.on_built_entity,
    defines.events.on_robot_built_entity,
    defines.events.script_raised_built,
    defines.events.script_raised_revive,
    defines.events.on_player_mined_entity,
    defines.events.on_robot_mined_entity,
    defines.events.on_entity_died,
    defines.events.script_raised_destroy,
  ]
  for (const event of events) onEvent(event, (e: { entity?: LuaEntity }) => changed(e.entity))
}
