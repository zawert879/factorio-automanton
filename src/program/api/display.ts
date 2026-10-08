// Табло для программ (9.5): display(имя) → холст с pixel, rect, line, circle, text, measureText, icon,
// bar, table, clear, frame. Координаты — пиксели от левого верхнего угла. Внутри frame примитивы
// собираются в кадр и появляются разом (src/world/displays.ts).
import { LuaForce } from "factorio:runtime"
import { charge, defineHostObject, hostGetters, hostMethods, host, program, Val } from "../../lang/runtime/core"
import { ulen } from "../../lang/runtime/strings"
import { Rgb } from "../../names"
import {
  CHAR_WIDTH,
  clearNow,
  commitFrame,
  DisplayRecord,
  drawNow,
  extendLast,
  findDisplay,
  lastDrawn,
  FONT_PIXELS,
  MAX_PRIMITIVES,
  Spec,
} from "../../world/displays"
import { actionError, currentRobot } from "../context"
import { text as asText } from "./common"

const NAMED_COLORS: Record<string, Rgb> = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 1, g: 1, b: 1 },
  gray: { r: 0.5, g: 0.5, b: 0.5 },
  red: { r: 0.9, g: 0.15, b: 0.15 },
  orange: { r: 1, g: 0.55, b: 0.1 },
  yellow: { r: 1, g: 0.85, b: 0.15 },
  green: { r: 0.2, g: 0.85, b: 0.25 },
  blue: { r: 0.25, g: 0.5, b: 1 },
  purple: { r: 0.65, g: 0.3, b: 0.9 },
}
const DEFAULT_TEXT_SIZE = 8
const DEFAULT_ICON_SIZE = 16

/** Цвет из значения программы: имя или {r, g, b} (0..1; если больше 1 — 0..255). */
function colorOf(value: Val, fallback: Rgb): Rgb {
  if (value === undefined) return fallback
  if (type(value) === "string") {
    const named = NAMED_COLORS[value as string]
    if (named === undefined) actionError("invalid-target", `unknown color ${value}`)
    return named
  }
  if (type(value) === "table" && type(value.r) === "number" && type(value.g) === "number" && type(value.b) === "number") {
    const scale = value.r > 1 || value.g > 1 || value.b > 1 ? 255 : 1
    return { r: value.r / scale, g: value.g / scale, b: value.b / scale }
  }
  return actionError("invalid-target", "color must be a name or {r, g, b}")
}

function num(value: Val, what: string): number {
  if (type(value) !== "number" || value !== value) actionError("invalid-target", `${what} must be a number`)
  return value as number
}

function key(spec: Omit<Spec, "key">): string {
  const c = spec.color
  return `${spec.t}|${spec.x1}|${spec.y1}|${spec.x2 ?? ""}|${spec.y2 ?? ""}|${c.r},${c.g},${c.b}|${spec.fill ? 1 : 0}|${spec.width ?? ""}|${spec.scale ?? ""}|${spec.align ?? ""}|${spec.sprite ?? ""}|${spec.text ?? ""}`
}

// ---------- Кадр ----------

/** Собираемый кадр (внутри frame) — у одного табло за раз. */
let collecting: { id: number; specs: Spec[]; background?: Rgb } | undefined

function recordOf(o: Val): DisplayRecord {
  const record = storage.displays.byId[o.__id]
  if (record === undefined || !record.entity.valid) actionError("invalid-target", "the display is gone")
  return record
}

/** Добавить примитив: в собираемый кадр или сразу на табло. Пиксели одного цвета в строке склеиваются. */
function add(record: DisplayRecord, spec: Omit<Spec, "key">): void {
  const list = collecting?.id === record.id ? collecting.specs : undefined
  const last = list !== undefined ? list[list.length - 1] : lastDrawn(record)
  if (spec.t === "r" && spec.fill && spec.y2! - spec.y1 === 1 && last !== undefined && last.t === "r" && last.fill) {
    const sameColor = last.color.r === spec.color.r && last.color.g === spec.color.g && last.color.b === spec.color.b
    if (sameColor && last.y1 === spec.y1 && last.y2 === spec.y2 && last.x2 === spec.x1) {
      if (list !== undefined) {
        last.x2 = spec.x2
        last.key = key(last)
      } else extendLast(record, spec.x2!, key({ ...last, x2: spec.x2 }))
      return
    }
  }
  const full = { ...spec, key: key(spec) } as Spec
  if (list !== undefined) {
    if (list.length >= MAX_PRIMITIVES) actionError("limit-exceeded", `a display holds at most ${MAX_PRIMITIVES} shapes`)
    list.push(full)
    return
  }
  if (record.shown.length >= MAX_PRIMITIVES) actionError("limit-exceeded", `a display holds at most ${MAX_PRIMITIVES} shapes`)
  drawNow(record, full)
}

function measure(text: string, size: number): number {
  return ulen(text) * size * CHAR_WIDTH
}

function textStyle(style: Val): { color: Rgb; size: number; align: "left" | "center" | "right" } {
  const options = type(style) === "table" ? style : {}
  const align = options.align === "center" || options.align === "right" ? options.align : "left"
  return { color: colorOf(options.color, NAMED_COLORS.white), size: options.size === undefined ? DEFAULT_TEXT_SIZE : num(options.size, "size"), align }
}

function drawText(record: DisplayRecord, x: number, y: number, text: string, color: Rgb, size: number, align: "left" | "center" | "right"): void {
  add(record, { t: "t", x1: x, y1: y, color, text, scale: size / FONT_PIXELS, align })
}

// ---------- Объект табло ----------

defineHostObject("display")
const getters = hostGetters.display
const methods = hostMethods.display

getters.width = (o: Val) => recordOf(o).width
getters.height = (o: Val) => recordOf(o).height
getters.name = (o: Val) => recordOf(o).name

methods.clear = (o: Val, _k: Val, color: Val) => {
  const record = recordOf(o)
  const background = colorOf(color, NAMED_COLORS.black)
  if (collecting?.id === record.id) {
    collecting.specs = []
    collecting.background = background
  } else clearNow(record, background)
}

methods.pixel = (o: Val, _k: Val, x: Val, y: Val, color: Val) => {
  const px = math.floor(num(x, "x"))
  const py = math.floor(num(y, "y"))
  add(recordOf(o), { t: "r", x1: px, y1: py, x2: px + 1, y2: py + 1, color: colorOf(color, NAMED_COLORS.white), fill: true })
}

function shapeStyle(style: Val): { color: Rgb; fill: boolean; width: number } {
  const options = type(style) === "table" ? style : {}
  return { color: colorOf(options.color, NAMED_COLORS.white), fill: options.fill === true, width: options.width === undefined ? 1 : num(options.width, "width") }
}

methods.rect = (o: Val, _k: Val, x: Val, y: Val, width: Val, height: Val, style: Val) => {
  const s = shapeStyle(style)
  const [x1, y1] = [num(x, "x"), num(y, "y")]
  add(recordOf(o), { t: "r", x1, y1, x2: x1 + num(width, "width"), y2: y1 + num(height, "height"), ...s })
}

methods.line = (o: Val, _k: Val, x1: Val, y1: Val, x2: Val, y2: Val, style: Val) => {
  const s = shapeStyle(style)
  add(recordOf(o), { t: "l", x1: num(x1, "x1"), y1: num(y1, "y1"), x2: num(x2, "x2"), y2: num(y2, "y2"), color: s.color, width: s.width })
}

methods.circle = (o: Val, _k: Val, x: Val, y: Val, radius: Val, style: Val) => {
  const s = shapeStyle(style)
  add(recordOf(o), { t: "c", x1: num(x, "x"), y1: num(y, "y"), x2: num(radius, "radius"), ...s })
}

methods.text = (o: Val, _k: Val, x: Val, y: Val, value: Val, style: Val) => {
  const s = textStyle(style)
  drawText(recordOf(o), num(x, "x"), num(y, "y"), asText(value), s.color, s.size, s.align)
}

methods.measureText = (_o: Val, _k: Val, value: Val, size: Val) => measure(asText(value), size === undefined ? DEFAULT_TEXT_SIZE : num(size, "size"))

methods.icon = (o: Val, _k: Val, x: Val, y: Val, item: Val, size: Val) => {
  const name = asText(item)
  const kind = prototypes.item[name] !== undefined ? "item" : prototypes.fluid[name] !== undefined ? "fluid" : undefined
  if (kind === undefined) actionError("invalid-target", `unknown item ${name}`)
  const px = size === undefined ? DEFAULT_ICON_SIZE : num(size, "size")
  // Значок рисуется по центру: смещаем на половину размера, чтобы x, y были левым верхним углом.
  add(recordOf(o), { t: "s", x1: num(x, "x") + px / 2, y1: num(y, "y") + px / 2, color: NAMED_COLORS.white, sprite: `${kind}/${name}`, scale: px / 32 })
}

methods.bar = (o: Val, _k: Val, x: Val, y: Val, width: Val, height: Val, value: Val, color: Val) => {
  const record = recordOf(o)
  const [x1, y1, w, h] = [num(x, "x"), num(y, "y"), num(width, "width"), num(height, "height")]
  const part = math.max(0, math.min(1, num(value, "value")))
  add(record, { t: "r", x1, y1, x2: x1 + w, y2: y1 + h, color: NAMED_COLORS.gray, fill: false, width: 1 })
  if (part > 0) add(record, { t: "r", x1, y1, x2: x1 + w * part, y2: y1 + h, color: colorOf(color, NAMED_COLORS.green), fill: true })
}

/** Ячейка таблицы: строка, число или { text, color, icon }. */
function cellOf(value: Val): { text: string; color?: Rgb; icon?: string } {
  if (type(value) === "table" && value.__n === undefined && value.__t === undefined) {
    return { text: value.text === undefined ? "" : asText(value.text), color: value.color === undefined ? undefined : colorOf(value.color, NAMED_COLORS.white), icon: value.icon === undefined ? undefined : asText(value.icon) }
  }
  return { text: asText(value) }
}

methods.table = (o: Val, _k: Val, x: Val, y: Val, rows: Val, options: Val) => {
  const record = recordOf(o)
  const opts = type(options) === "table" ? options : {}
  const size = opts.size === undefined ? DEFAULT_TEXT_SIZE : num(opts.size, "size")
  const lineHeight = size + 2
  const [x0, y0] = [num(x, "x"), num(y, "y")]
  if (type(rows) !== "table" || rows.__n === undefined) actionError("invalid-target", "rows must be an array of arrays")
  // Ширина столбцов: заданная или по самой широкой ячейке.
  const widths: number[] = []
  const cells: { text: string; color?: Rgb; icon?: string }[][] = []
  for (let r = 1; r <= rows.__n; r++) {
    const row = rows[r]
    const line: { text: string; color?: Rgb; icon?: string }[] = []
    for (let c = 1; c <= (row?.__n ?? 0); c++) {
      const cell = cellOf(row[c])
      line.push(cell)
      const w = measure(cell.text, size) + (cell.icon !== undefined ? size + 2 : 0)
      widths[c - 1] = math.max(widths[c - 1] ?? 0, w)
    }
    cells.push(line)
  }
  if (type(opts.columnWidths) === "table") for (let c = 1; c <= (opts.columnWidths.__n ?? 0); c++) widths[c - 1] = num(opts.columnWidths[c], "column width")
  let cy = y0
  let totalWidth = 0
  for (let r = 0; r < cells.length; r++) {
    const header = opts.header === true && r === 0
    let cx = x0
    for (let c = 0; c < cells[r].length; c++) {
      const cell = cells[r][c]
      let tx = cx
      if (cell.icon !== undefined) {
        add(record, { t: "s", x1: cx + size / 2, y1: cy + size / 2, color: NAMED_COLORS.white, sprite: `item/${cell.icon}`, scale: size / 32 })
        tx += size + 2
      }
      drawText(record, tx, cy, cell.text, cell.color ?? (header ? NAMED_COLORS.yellow : NAMED_COLORS.white), size, "left")
      cx += widths[c] + 6
    }
    totalWidth = math.max(totalWidth, cx - 6 - x0)
    cy += lineHeight
    if (header) {
      add(record, { t: "l", x1: x0, y1: cy - 1, x2: x0 + totalWidth, y2: cy - 1, color: NAMED_COLORS.gray, width: 1 })
      cy += 1
    }
  }
  charge(1)
  return { width: totalWidth, height: cy - y0 }
}

methods.frame = (o: Val, _k: Val, draw: Val) => {
  const record = recordOf(o)
  if (collecting !== undefined) actionError("invalid-target", "frame inside frame")
  collecting = { id: record.id, specs: [] }
  try {
    program().calls(draw, undefined)
  } catch (e) {
    collecting = undefined
    throw e
  }
  const frame = collecting
  collecting = undefined
  commitFrame(record, frame.specs, frame.background)
}

host.display = (name: Val) => {
  const record = findDisplay(asText(name), (currentRobot().entity.force as LuaForce).name)
  if (record === undefined) actionError("invalid-target", `no display named ${asText(name)}`)
  charge(1)
  return { __t: "host", __h: "display", __id: record.id }
}
