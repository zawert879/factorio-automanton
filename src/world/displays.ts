// Табло (9.5): сущность с именем (как метка) и пиксельный холст поверх неё — объекты rendering.
// Пиксель экрана = 1/32 клетки. Каждый примитив описан «спецификацией» с ключом (вид и параметры);
// frame() собирает кадр целиком и применяет разницу с прошлым: одинаковые примитивы остаются,
// исчезнувшие удаляются, новые создаются; порядок (кто поверх) сохраняется через bring_to_front.
// Кадры чаще 10 раз в секунду откладываются: применяется последний, когда подойдёт время.
import { LuaEntity, LuaRenderObject } from "factorio:runtime"
import { onEvent, onTick } from "../events"
import { DISPLAY_PIXELS_PER_TILE, DISPLAY_SCREEN_SPRITE, DISPLAYS, Rgb } from "../names"
import { askName, registerNameable, registerRenamer } from "./naming"

export interface Spec {
  /** r — прямоугольник, l — линия, c — круг, t — текст, s — значок. */
  t: "r" | "l" | "c" | "t" | "s"
  x1: number
  y1: number
  x2?: number
  y2?: number
  color: Rgb
  fill?: boolean
  width?: number
  text?: string
  scale?: number
  align?: "left" | "center" | "right"
  sprite?: string
  key: string
}

export interface DisplayRecord {
  id: number
  name: string
  force: string
  entity: LuaEntity
  /** Размер экрана в пикселях. */
  width: number
  height: number
  label: LuaRenderObject
  screen: LuaRenderObject
  /** Показанное по порядку; spec — у последнего (для склейки пикселей вне кадра). */
  shown: { key: string; object: LuaRenderObject; spec?: Spec }[]
  /** Кадр, который ждёт своего времени (frame чаще 10 раз в секунду). */
  pending?: { specs: Spec[]; background?: Rgb }
  lastFrame?: number
}

export interface DisplaysState {
  byId: Record<number, DisplayRecord | undefined>
  nextNumber: number
  /** Табло с отложенным кадром. */
  waiting: Record<number, boolean | undefined>
}

/** Не больше примитивов на табло. */
export const MAX_PRIMITIVES = 2000
/** Кадр — не чаще раза в столько тиков (10 в секунду). */
export const FRAME_TICKS = 6
/** Высота шрифта табло (automaton-console) в пикселях экрана при масштабе 1; ширина символа — 0.6 высоты. */
export const FONT_PIXELS = 13
export const CHAR_WIDTH = 0.6
const SCREEN_INSET = 0.12
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

export function initDisplays(): void {
  storage.displays ??= { byId: {}, nextNumber: 1, waiting: {} }
}

export function isDisplay(entity: LuaEntity): boolean {
  return entity.valid && DISPLAYS.some((d) => d.name === entity.name)
}

export function findDisplay(name: string, force: string): DisplayRecord | undefined {
  for (const [, record] of pairs(storage.displays.byId)) {
    if (record.name === name && record.force === force && record.entity.valid) return record
  }
  return undefined
}

export function renameDisplay(record: DisplayRecord, name: string): void {
  record.name = name
  if (record.label.valid) record.label.text = name
}

function register(entity: LuaEntity, player?: number): void {
  const state = storage.displays
  const spec = DISPLAYS.find((d) => d.name === entity.name)!
  const id = entity.unit_number!
  const name = `D-${state.nextNumber++}`
  const [w, h] = [spec.tilesWide, spec.tilesHigh]
  // Спрайт 10×10 пикселей = 10/32 клетки: растянуть на экран.
  const screen = rendering.draw_sprite({
    sprite: DISPLAY_SCREEN_SPRITE as never,
    tint: BLACK,
    x_scale: ((w - 2 * SCREEN_INSET) * 32) / 10,
    y_scale: ((h - 2 * SCREEN_INSET) * 32) / 10,
    target: { entity },
    surface: entity.surface,
    render_layer: "higher-object-under",
  })
  const label = rendering.draw_text({
    text: name,
    surface: entity.surface,
    target: { entity, offset: [0, -h / 2 - 0.6] },
    color: { r: 0.15, g: 0.85, b: 0.9 },
    alignment: "center",
    only_in_alt_mode: true,
  })
  state.byId[id] = {
    id,
    name,
    force: entity.force.name,
    entity,
    width: w * DISPLAY_PIXELS_PER_TILE,
    height: h * DISPLAY_PIXELS_PER_TILE,
    label,
    screen,
    shown: [],
  }
  script.register_on_object_destroyed(entity)
  if (player !== undefined) askName(player, { kind: "display", id }, name)
}

// ---------- Рисование ----------

/** Смещение точки экрана (пиксели от левого верхнего угла) от центра табло, в клетках. */
function offset(record: DisplayRecord, x: number, y: number): [number, number] {
  return [(x - record.width / 2) / DISPLAY_PIXELS_PER_TILE, (y - record.height / 2) / DISPLAY_PIXELS_PER_TILE]
}

function create(record: DisplayRecord, spec: Spec): LuaRenderObject {
  const entity = record.entity
  const surface = entity.surface
  const color = spec.color
  switch (spec.t) {
    case "r":
      return rendering.draw_rectangle({
        color,
        filled: spec.fill === true,
        width: spec.width ?? 1,
        left_top: { entity, offset: offset(record, spec.x1, spec.y1) },
        right_bottom: { entity, offset: offset(record, spec.x2!, spec.y2!) },
        surface,
      })
    case "l":
      return rendering.draw_line({
        color,
        width: spec.width ?? 1,
        from: { entity, offset: offset(record, spec.x1, spec.y1) },
        to: { entity, offset: offset(record, spec.x2!, spec.y2!) },
        surface,
      })
    case "c":
      return rendering.draw_circle({
        color,
        filled: spec.fill === true,
        width: spec.width ?? 1,
        radius: spec.x2! / DISPLAY_PIXELS_PER_TILE,
        target: { entity, offset: offset(record, spec.x1, spec.y1) },
        surface,
      })
    case "t":
      return rendering.draw_text({
        text: spec.text!,
        color,
        font: "automaton-console",
        scale: spec.scale ?? 1,
        alignment: spec.align ?? "left",
        vertical_alignment: "top",
        target: { entity, offset: offset(record, spec.x1, spec.y1) },
        surface,
      })
    case "s":
      return rendering.draw_sprite({
        sprite: spec.sprite! as never,
        x_scale: spec.scale ?? 1,
        y_scale: spec.scale ?? 1,
        target: { entity, offset: offset(record, spec.x1, spec.y1) },
        surface,
        render_layer: "higher-object-above",
      })
  }
}

/** Нарисовать сразу (вне frame). */
export function drawNow(record: DisplayRecord, spec: Spec): void {
  const last = record.shown[record.shown.length - 1]
  if (last !== undefined) last.spec = undefined
  record.shown.push({ key: spec.key, object: create(record, spec), spec })
}

/** Последний нарисованный вне кадра примитив (для склейки пикселей). */
export function lastDrawn(record: DisplayRecord): Spec | undefined {
  return record.shown[record.shown.length - 1]?.spec
}

/** Растянуть последний прямоугольник вправо до x2 (склейка пикселей вне кадра). */
export function extendLast(record: DisplayRecord, x2: number, key: string): void {
  const last = record.shown[record.shown.length - 1]
  const spec = last.spec!
  spec.x2 = x2
  spec.key = key
  last.key = key
  if (last.object.valid) last.object.right_bottom = { entity: record.entity, offset: offset(record, x2, spec.y2!) }
}

export function setBackground(record: DisplayRecord, color: Rgb): void {
  if (record.screen.valid) record.screen.color = color
}

/** Стереть всё (вне frame). */
export function clearNow(record: DisplayRecord, color?: Rgb): void {
  for (const { object } of record.shown) if (object.valid) object.destroy()
  record.shown = []
  record.pending = undefined
  setBackground(record, color ?? BLACK)
}

/** Применить кадр: разница с показанным, порядок сохраняется. */
function apply(record: DisplayRecord, specs: Spec[], background: Rgb | undefined): void {
  const old = new LuaMap<string, LuaRenderObject[]>()
  for (const { key, object } of record.shown) {
    if (!object.valid) continue
    const list = old.get(key)
    if (list === undefined) old.set(key, [object])
    else list.push(object)
  }
  const shown: { key: string; object: LuaRenderObject }[] = []
  let reorder = false
  for (const spec of specs) {
    const reused = old.get(spec.key)?.shift()
    if (reused !== undefined) {
      if (reorder) reused.bring_to_front()
      shown.push({ key: spec.key, object: reused })
    } else {
      shown.push({ key: spec.key, object: create(record, spec) })
      reorder = true
    }
  }
  for (const [, list] of old) for (const object of list) object.destroy()
  record.shown = shown
  if (background !== undefined) setBackground(record, background)
  record.lastFrame = game.tick
  record.pending = undefined
}

/** Кадр собран: применить сейчас или, если прошлый был недавно, — когда подойдёт время. */
export function commitFrame(record: DisplayRecord, specs: Spec[], background: Rgb | undefined): void {
  if (record.lastFrame !== undefined && game.tick - record.lastFrame < FRAME_TICKS) {
    record.pending = { specs, background: background ?? record.pending?.background }
    storage.displays.waiting[record.id] = true
    return
  }
  apply(record, specs, background)
}

export function registerDisplays(): void {
  registerRenamer("display", (target, name) => {
    const record = target.kind === "display" ? storage.displays.byId[target.id] : undefined
    if (record !== undefined) renameDisplay(record, name)
  })
  registerNameable((entity) => {
    const record = isDisplay(entity) && entity.unit_number !== undefined ? storage.displays.byId[entity.unit_number] : undefined
    return record === undefined ? undefined : { target: { kind: "display", id: record.id }, name: record.name }
  })
  onEvent(defines.events.on_built_entity, (e) => {
    if (isDisplay(e.entity)) register(e.entity, e.player_index)
  })
  onEvent(defines.events.on_robot_built_entity, (e) => {
    if (isDisplay(e.entity)) register(e.entity)
  })
  onEvent(defines.events.script_raised_built, (e) => {
    if (isDisplay(e.entity)) register(e.entity)
  })
  onEvent(defines.events.on_object_destroyed, (e) => {
    if (e.type !== defines.target_type.entity) return
    // Объекты rendering, привязанные к сущности, удаляет сама игра.
    if (storage.displays.byId[e.useful_id] !== undefined) storage.displays.byId[e.useful_id] = undefined
  })
  onTick((tick) => {
    const waiting = storage.displays.waiting
    for (const [id] of pairs(waiting)) {
      const record = storage.displays.byId[id]
      if (record === undefined || !record.entity.valid || record.pending === undefined) {
        waiting[id] = undefined
      } else if (tick - (record.lastFrame ?? 0) >= FRAME_TICKS) {
        waiting[id] = undefined
        apply(record, record.pending.specs, record.pending.background)
      }
    }
  })
}
