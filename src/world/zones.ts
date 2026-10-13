// Зоны (4.9): прямоугольник, выделенный «Программатором», с именем. Программы находят её zone("имя")
// и здания в ней — find(…, zone). Зону видно в режиме Alt: рамка и подпись.
// Выделение — новая зона (имя спрашивается), выделение с Shift (alt) — удалить зоны, которых касается рамка.
// Края зон (21.7): рамка, начатая у края зоны (в пределах GRAB клетки) или угла, двигает их туда, где её отпустили;
// начатая на центральной ручке — переносит зону. Начало рамки — нажатие (своя клавиша ZONE_PRESS, связанная
// с выделением), конец — угол выделенной области напротив начала. Ручки видит только игрок с «Программатором» в руке.
// Имя и удаление (21.8): клик (рамка без протягивания) внутри зоны или по центральной ручке открывает диалог имени
// с кнопкой «Удалить». Занятое другой зоной имя не принимается — диалог открывается снова.
import { BoundingBox, LuaPlayer, LuaRenderObject, LuaSurface, MapPosition, PlayerIndex } from "factorio:runtime"
import { onCustomInput, onEvent } from "../events"
import { PROGRAMMER, ZONE_PRESS } from "../names"
import { askName, registerRemover, registerRenamer } from "./naming"

export interface ZoneRecord {
  name: string
  surface: LuaSurface
  area: BoundingBox
  box: LuaRenderObject
  label: LuaRenderObject
  /** Кэш find по зоне: запрос → обёртки зданий (src/program/cache.ts). */
  found?: Record<string, unknown[] | undefined>
}

/** Что игрок схватил нажатием у зоны: края (угол — два), или всю зону за центр. */
export interface ZoneGrab {
  zone: string
  start: MapPosition
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
  move: boolean
}

export interface ZonesState {
  byName: Record<string, ZoneRecord | undefined>
  nextNumber: number
  /** Нажатие у края зоны: ждёт конца рамки (on_player_selected_area). */
  grabs: Record<number, ZoneGrab | undefined>
  /** Ручки зон для игрока с «Программатором» в руке. */
  handles: Record<number, LuaRenderObject[] | undefined>
}

const COLOR = { r: 0.15, g: 0.85, b: 0.9, a: 0.6 }
const HANDLE_COLOR = { r: 0.9, g: 0.98, b: 1, a: 1 }
/** Насколько близко к краю (клеток) нужно нажать, чтобы схватить его. */
const GRAB = 0.5
/** Половина стороны ручки на карте. */
const HANDLE = 0.18

export function initZones(): void {
  storage.zones ??= { byName: {}, nextNumber: 1, grabs: {}, handles: {} }
  storage.zones.grabs ??= {}
  storage.zones.handles ??= {}
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
  refreshHandles()
  return zone
}

export function removeZone(name: string): void {
  const zone = storage.zones.byName[name]
  if (zone === undefined) return
  if (zone.box.valid) zone.box.destroy()
  if (zone.label.valid) zone.label.destroy()
  storage.zones.byName[name] = undefined
  refreshHandles()
}

/** Новая рамка зоны (21.7): имя то же, find по зоне — заново. */
export function setZoneArea(zone: ZoneRecord, area: BoundingBox): void {
  zone.area = area
  if (zone.box.valid) {
    zone.box.left_top = area.left_top
    zone.box.right_bottom = area.right_bottom
  }
  if (zone.label.valid) zone.label.target = area.left_top
  zone.found = undefined
  refreshHandles()
}

/** Что схвачено нажатием в position: центр (перенос) или край/угол; из нескольких зон — самая маленькая. */
export function grabAt(surface: LuaSurface, position: MapPosition): Omit<ZoneGrab, "start"> | undefined {
  let best: Omit<ZoneGrab, "start"> | undefined
  let bestSize = math.huge
  for (const [name, zone] of pairs(storage.zones.byName)) {
    if (zone.surface !== surface) continue
    const { left_top: a, right_bottom: b } = zone.area
    const { x, y } = position
    if (x < a.x - GRAB || x > b.x + GRAB || y < a.y - GRAB || y > b.y + GRAB) continue
    const [width, height] = [b.x - a.x, b.y - a.y]
    const center = zoneCenter(zone)
    const move = width >= 2 && height >= 2 && math.abs(x - center.x) <= GRAB && math.abs(y - center.y) <= GRAB
    const left = !move && math.abs(x - a.x) <= GRAB
    const right = !move && !left && math.abs(x - b.x) <= GRAB
    const top = !move && math.abs(y - a.y) <= GRAB
    const bottom = !move && !top && math.abs(y - b.y) <= GRAB
    if (!move && !left && !right && !top && !bottom) continue
    if (width * height < bestSize) {
      bestSize = width * height
      best = { zone: name, left, right, top, bottom, move }
    }
  }
  return best
}

/** Конец рамки, начатой в start, — угол выделенной области напротив начала. */
function selectionEnd(start: MapPosition, area: BoundingBox): [number, number] {
  const endX = math.abs(area.left_top.x - start.x) <= math.abs(area.right_bottom.x - start.x) ? area.right_bottom.x : area.left_top.x
  const endY = math.abs(area.left_top.y - start.y) <= math.abs(area.right_bottom.y - start.y) ? area.right_bottom.y : area.left_top.y
  return [endX, endY]
}

/**
 * Клик по зоне (21.8): рамка, начатая на центральной ручке и отпущенная на ней же, или рамка меньше клетки внутри
 * зоны — имя зоны (из нескольких — самая маленькая); рамка от края — не клик, край встаёт по клеткам.
 */
export function clickedZone(surface: LuaSurface, area: BoundingBox, grab: ZoneGrab | undefined): string | undefined {
  if (grab !== undefined) {
    if (!grab.move) return undefined
    const [endX, endY] = selectionEnd(grab.start, area)
    return math.abs(endX - grab.start.x) <= GRAB && math.abs(endY - grab.start.y) <= GRAB ? grab.zone : undefined
  }
  if (area.right_bottom.x - area.left_top.x >= 1 || area.right_bottom.y - area.left_top.y >= 1) return undefined
  const x = (area.left_top.x + area.right_bottom.x) / 2
  const y = (area.left_top.y + area.right_bottom.y) / 2
  let best: string | undefined
  let bestSize = math.huge
  for (const [name, zone] of pairs(storage.zones.byName)) {
    const { left_top: a, right_bottom: b } = zone.area
    if (zone.surface !== surface || x < a.x || x > b.x || y < a.y || y > b.y) continue
    const size = (b.x - a.x) * (b.y - a.y)
    if (size < bestSize) [best, bestSize] = [name, size]
  }
  return best
}

/** Диалог имени существующей зоны: новое имя и «Удалить»; программы находят зону по имени. */
export function askZoneName(playerIndex: number, name: string): void {
  askName(playerIndex, { kind: "zone", name }, name, ["automaton.zone-rename-note", name])
}

/** Рамку, начатую нажатием grab, отпустили: area — выделенная область. Край — туда, где отпустили (по клеткам). */
export function dragZone(grab: ZoneGrab, area: BoundingBox): void {
  const zone = storage.zones.byName[grab.zone]
  if (zone === undefined) return
  const { start } = grab
  const [endX, endY] = selectionEnd(start, area)
  const snap = (v: number) => math.floor(v + 0.5)
  let [left, top] = [zone.area.left_top.x, zone.area.left_top.y]
  let [right, bottom] = [zone.area.right_bottom.x, zone.area.right_bottom.y]
  if (grab.move) {
    const [dx, dy] = [snap(endX - start.x), snap(endY - start.y)]
    left += dx
    right += dx
    top += dy
    bottom += dy
  } else {
    // Зона не уже клетки: край не уходит за противоположный.
    if (grab.left) left = math.min(snap(endX), right - 1)
    if (grab.right) right = math.max(snap(endX), left + 1)
    if (grab.top) top = math.min(snap(endY), bottom - 1)
    if (grab.bottom) bottom = math.max(snap(endY), top + 1)
  }
  setZoneArea(zone, { left_top: { x: left, y: top }, right_bottom: { x: right, y: bottom } })
}

function holdsProgrammer(player: LuaPlayer): boolean {
  const stack = player.cursor_stack
  return stack !== undefined && stack.valid_for_read && stack.name === PROGRAMMER
}

/** Ручки зон для игрока: углы, середины краёв и центр — пока «Программатор» в руке. */
function drawHandles(player: LuaPlayer): void {
  for (const render of storage.zones.handles[player.index] ?? []) if (render.valid) render.destroy()
  storage.zones.handles[player.index] = undefined
  if (!player.connected || !holdsProgrammer(player)) return
  const list: LuaRenderObject[] = []
  const surface = player.surface
  const dot = (x: number, y: number, size: number) =>
    list.push(
      rendering.draw_rectangle({
        color: HANDLE_COLOR,
        filled: true,
        left_top: { x: x - size, y: y - size },
        right_bottom: { x: x + size, y: y + size },
        surface,
        players: [player],
      }),
    )
  for (const [, zone] of pairs(storage.zones.byName)) {
    if (zone.surface !== surface) continue
    const { left_top: a, right_bottom: b } = zone.area
    list.push(rendering.draw_rectangle({ color: COLOR, width: 2, filled: false, left_top: a, right_bottom: b, surface, players: [player] }))
    const center = zoneCenter(zone)
    for (const x of [a.x, center.x, b.x]) for (const y of [a.y, center.y, b.y]) if (x !== center.x || y !== center.y) dot(x, y, HANDLE)
    if (b.x - a.x >= 2 && b.y - a.y >= 2) dot(center.x, center.y, HANDLE * 1.4)
  }
  storage.zones.handles[player.index] = list
}

/** Перерисовать ручки всем игрокам (зоны поменялись). */
function refreshHandles(): void {
  for (const [, player] of game.players) drawHandles(player)
}

/** Нажатие выделения (21.7): у края зоны с «Программатором» в руке — запомнить, что схвачено. */
export function onZonePress(playerIndex: PlayerIndex, position: MapPosition): void {
  const player = game.get_player(playerIndex)
  const grab = player !== undefined && holdsProgrammer(player) ? grabAt(player.surface, position) : undefined
  storage.zones.grabs[playerIndex] = grab === undefined ? undefined : { ...grab, start: position }
}

/** Сменить имя; занятое другой зоной имя не принимается (false) — зона остаётся со старым. */
export function renameZone(oldName: string, newName: string): boolean {
  const zone = storage.zones.byName[oldName]
  if (zone === undefined || oldName === newName) return true
  if (storage.zones.byName[newName] !== undefined) return false
  storage.zones.byName[oldName] = undefined
  zone.name = newName
  if (zone.label.valid) zone.label.text = newName
  storage.zones.byName[newName] = zone
  return true
}

function overlaps(a: BoundingBox, b: BoundingBox): boolean {
  return a.left_top.x < b.right_bottom.x && b.left_top.x < a.right_bottom.x && a.left_top.y < b.right_bottom.y && b.left_top.y < a.right_bottom.y
}

export function registerZones(): void {
  registerRenamer("zone", (target, name, player) => {
    if (target.kind !== "zone" || renameZone(target.name, name)) return
    player.print(["automaton.zone-name-taken", name])
    askName(player.index, target, name, ["automaton.zone-rename-note", target.name])
  })
  registerRemover("zone", (target) => {
    if (target.kind === "zone") removeZone(target.name)
  })
  onEvent(defines.events.on_player_selected_area, (e) => {
    if (e.item !== PROGRAMMER) return
    // Рамка начата у края или центра зоны — это правка зоны, а не новая; клик по зоне — её имя.
    let grab = storage.zones.grabs[e.player_index]
    storage.zones.grabs[e.player_index] = undefined
    if (grab !== undefined && storage.zones.byName[grab.zone]?.surface !== e.surface) grab = undefined
    const clicked = clickedZone(e.surface, e.area, grab)
    if (clicked !== undefined) return askZoneName(e.player_index, clicked)
    if (grab !== undefined) return dragZone(grab, e.area)
    const area: BoundingBox = {
      left_top: { x: math.floor(e.area.left_top.x), y: math.floor(e.area.left_top.y) },
      right_bottom: { x: math.ceil(e.area.right_bottom.x), y: math.ceil(e.area.right_bottom.y) },
    }
    if (area.right_bottom.x - area.left_top.x < 1 || area.right_bottom.y - area.left_top.y < 1) return
    const name = `Z-${storage.zones.nextNumber++}`
    createZone(name, e.surface, area)
    askName(e.player_index, { kind: "zone", name }, name)
  })
  onCustomInput(ZONE_PRESS, (e) => onZonePress(e.player_index, e.cursor_position))
  onEvent(defines.events.on_player_cursor_stack_changed, (e) => drawHandles(game.get_player(e.player_index)!))
  onEvent(defines.events.on_player_changed_surface, (e) => drawHandles(game.get_player(e.player_index)!))
  onEvent(defines.events.on_player_alt_selected_area, (e) => {
    storage.zones.grabs[e.player_index] = undefined
    if (e.item !== PROGRAMMER) return
    for (const [name, zone] of pairs(storage.zones.byName)) {
      if (zone.surface === e.surface && overlaps(zone.area, e.area)) removeZone(name)
    }
  })
}
