// Зоны (4.9): прямоугольник, выделенный «Программатором», с именем. Программы находят её zone("имя")
// и здания в ней — find(…, zone). Зону видно в режиме Alt: рамка и подпись.
// Выделение — новая зона (имя спрашивается), выделение с Shift (alt) — удалить зоны, которых касается рамка.
import { BoundingBox, LuaRenderObject, LuaSurface, MapPosition } from "factorio:runtime"
import { onEvent } from "../events"
import { PROGRAMMER } from "../names"
import { askName, registerRenamer } from "./naming"

export interface ZoneRecord {
  name: string
  surface: LuaSurface
  area: BoundingBox
  box: LuaRenderObject
  label: LuaRenderObject
  /** Кэш find по зоне: запрос → обёртки зданий (src/program/cache.ts). */
  found?: Record<string, unknown[] | undefined>
}

export interface ZonesState {
  byName: Record<string, ZoneRecord | undefined>
  nextNumber: number
}

const COLOR = { r: 0.15, g: 0.85, b: 0.9, a: 0.6 }

export function initZones(): void {
  storage.zones ??= { byName: {}, nextNumber: 1 }
}

export function findZone(name: string): ZoneRecord | undefined {
  return storage.zones.byName[name]
}

export function zoneCenter(zone: ZoneRecord): MapPosition {
  return { x: (zone.area.left_top.x + zone.area.right_bottom.x) / 2, y: (zone.area.left_top.y + zone.area.right_bottom.y) / 2 }
}

export function createZone(name: string, surface: LuaSurface, area: BoundingBox): ZoneRecord {
  removeZone(name)
  const box = rendering.draw_rectangle({
    color: COLOR,
    width: 2,
    filled: false,
    left_top: area.left_top,
    right_bottom: area.right_bottom,
    surface,
    only_in_alt_mode: true,
  })
  const label = rendering.draw_text({
    text: name,
    surface,
    target: area.left_top,
    color: COLOR,
    scale: 1.2,
    only_in_alt_mode: true,
  })
  const zone: ZoneRecord = { name, surface, area, box, label }
  storage.zones.byName[name] = zone
  return zone
}

export function removeZone(name: string): void {
  const zone = storage.zones.byName[name]
  if (zone === undefined) return
  if (zone.box.valid) zone.box.destroy()
  if (zone.label.valid) zone.label.destroy()
  storage.zones.byName[name] = undefined
}

export function renameZone(oldName: string, newName: string): void {
  const zone = storage.zones.byName[oldName]
  if (zone === undefined || oldName === newName) return
  removeZone(newName)
  storage.zones.byName[oldName] = undefined
  zone.name = newName
  if (zone.label.valid) zone.label.text = newName
  storage.zones.byName[newName] = zone
}

function overlaps(a: BoundingBox, b: BoundingBox): boolean {
  return a.left_top.x < b.right_bottom.x && b.left_top.x < a.right_bottom.x && a.left_top.y < b.right_bottom.y && b.left_top.y < a.right_bottom.y
}

export function registerZones(): void {
  registerRenamer("zone", (target, name) => {
    if (target.kind === "zone") renameZone(target.name, name)
  })
  onEvent(defines.events.on_player_selected_area, (e) => {
    if (e.item !== PROGRAMMER) return
    const area: BoundingBox = {
      left_top: { x: math.floor(e.area.left_top.x), y: math.floor(e.area.left_top.y) },
      right_bottom: { x: math.ceil(e.area.right_bottom.x), y: math.ceil(e.area.right_bottom.y) },
    }
    if (area.right_bottom.x - area.left_top.x < 1 || area.right_bottom.y - area.left_top.y < 1) return
    const name = `Z-${storage.zones.nextNumber++}`
    createZone(name, e.surface, area)
    askName(e.player_index, { kind: "zone", name }, name)
  })
  onEvent(defines.events.on_player_alt_selected_area, (e) => {
    if (e.item !== PROGRAMMER) return
    for (const [name, zone] of pairs(storage.zones.byName)) {
      if (zone.surface === e.surface && overlaps(zone.area, e.area)) removeZone(name)
    }
  })
}
