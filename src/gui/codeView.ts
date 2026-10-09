// Код с подсветкой для окон мода (просмотр программы, справка): цвета и строки-подписи с rich text
// (src/lang/highlight.ts) на фоне поля ввода (стиль automaton_code_view).
import { FrameGuiElement, LuaGuiElement } from "factorio:runtime"
import { highlight, Paint, richLine } from "../lang/highlight"

/** Цвета подсветки на светлом фоне поля. */
export const PALETTE: Record<Paint, string | undefined> = {
  plain: undefined,
  keyword: "#6a35b8",
  control: "#8e2a9c",
  constant: "#0b6e75",
  number: "#0b6e75",
  string: "#a1420b",
  comment: "#6f7a52",
  function: "#1d52a3",
  type: "#1f7a4d",
  error: "#d0201a",
}

/** Блок кода только для чтения: строка — подпись в цвете, ширина — не меньше width. */
export function addCode(parent: LuaGuiElement, source: string, width: number): FrameGuiElement {
  const frame = parent.add({ type: "frame", style: "automaton_code_view", direction: "vertical" })
  frame.style.minimal_width = width
  for (const line of highlight(source)) {
    const label = frame.add({ type: "label", style: "automaton_code_line", caption: richLine(line, PALETTE) })
    label.style.left_padding = 8
  }
  return frame
}
