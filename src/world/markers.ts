// Метки (4.9): поставленный игроком флажок с именем. Программы находят его marker("имя").
// Имя по умолчанию «M-<номер>»; переименовать — диалог сразу после установки или /am-name под курсором.
import { LuaEntity, LuaRenderObject } from "factorio:runtime"
import { onEvent } from "../events"
import { MARKER } from "../names"
import { askName, registerRenamer } from "./naming"

export interface MarkerRecord {
  id: number
  name: string
  entity: LuaEntity
  label: LuaRenderObject
}

export interface MarkersState {
  byId: Record<number, MarkerRecord | undefined>
  nextNumber: number
}

export function initMarkers(): void {
  storage.markers ??= { byId: {}, nextNumber: 1 }
}

export function findMarker(name: string): MarkerRecord | undefined {
  for (const [, marker] of pairs(storage.markers.byId)) {
    if (marker.name === name && marker.entity.valid) return marker
  }
  return undefined
}

export function markerOf(entity: LuaEntity): MarkerRecord | undefined {
  return entity.valid && entity.unit_number !== undefined ? storage.markers.byId[entity.unit_number] : undefined
}

export function renameMarker(marker: MarkerRecord, name: string): void {
  marker.name = name
  if (marker.label.valid) marker.label.text = name
}

function register(entity: LuaEntity, player?: number): void {
  const state = storage.markers
  const id = entity.unit_number!
  const name = `M-${state.nextNumber++}`
  const label = rendering.draw_text({
    text: name,
    surface: entity.surface,
    target: { entity, offset: [0, -1.1] },
    color: { r: 0.15, g: 0.85, b: 0.9 },
    alignment: "center",
    scale: 0.9,
  })
  state.byId[id] = { id, name, entity, label }
  script.register_on_object_destroyed(entity)
  if (player !== undefined) askName(player, { kind: "marker", id }, name)
}

export function registerMarkers(): void {
  registerRenamer("marker", (target, name) => {
    const marker = target.kind === "marker" ? storage.markers.byId[target.id] : undefined
    if (marker !== undefined) renameMarker(marker, name)
  })
  const isMarker = (entity: LuaEntity) => entity.valid && entity.name === MARKER
  onEvent(defines.events.on_built_entity, (e) => {
    if (isMarker(e.entity)) register(e.entity, e.player_index)
  })
  onEvent(defines.events.on_robot_built_entity, (e) => {
    if (isMarker(e.entity)) register(e.entity)
  })
  onEvent(defines.events.script_raised_built, (e) => {
    if (isMarker(e.entity)) register(e.entity)
  })
  onEvent(defines.events.on_object_destroyed, (e) => {
    if (e.type !== defines.target_type.entity) return
    const marker = storage.markers.byId[e.useful_id]
    if (marker === undefined) return
    if (marker.label.valid) marker.label.destroy()
    storage.markers.byId[e.useful_id] = undefined
  })
}
