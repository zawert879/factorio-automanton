// Окна обмена программами строкой (18.3; решения — DESIGN.md, «Обмен программами»). Кнопки — в нижнем ряду окна
// программ. Экспорт: дерево программ с галочками (открытая программа отмечена), модули, без которых отмеченное
// не соберётся, отмечаются сами; строка ниже выделена — Ctrl+C (писать в буфер обмена игра не умеет).
// Импорт: вставленная строка → список (новая / та же / есть с другим текстом — выбор: заменить, рядом «(2)»,
// пропустить) → «Импортировать» с правами публикации.
import { ButtonGuiElement, CheckboxGuiElement, FrameGuiElement, LocalisedString, LuaGuiElement, LuaPlayer, TableGuiElement, TextBoxGuiElement } from "factorio:runtime"
import { applyImport, decodePrograms, exportPrograms, ImportChoice, ImportItem, planImport, withDependencies } from "../program/exchange"
import { notePublish, programsOf, publishDenied } from "../program/store"
import { guiOf, onGuiChange, onGuiChecked, onGuiClick, onGuiSelection, titlebar } from "./common"
import { diagnosticText } from "./diagnostics"
import { FOLDER_COLOR, LIBRARY_COLOR, programTree, TreeEntry } from "./tree"

const EXPORT_FRAME = "automaton-export"
const IMPORT_FRAME = "automaton-import"
const WIDTH = 520
const CHOICES: ImportChoice[] = ["replace", "rename", "skip"]
const GREEN = { r: 0.5, g: 1, b: 0.5 }
const ORANGE = { r: 1, g: 0.75, b: 0.3 }
const RED = { r: 1, g: 0.45, b: 0.4 }

export interface ExportWindow {
  frame: FrameGuiElement
  rows: TreeEntry[]
  boxes: CheckboxGuiElement[]
  /** Отмечено игроком (модули, добавленные сами, — нет). */
  checked: Record<number, boolean | undefined>
  text: TextBoxGuiElement
  count: LuaGuiElement
}

export interface ImportWindow {
  frame: FrameGuiElement
  text: TextBoxGuiElement
  status: LuaGuiElement
  list: TableGuiElement
  items: ImportItem[]
  choices: Record<string, ImportChoice | undefined>
  apply: ButtonGuiElement
  result: LuaGuiElement
}

function wrapLabel(parent: LuaGuiElement, caption: LocalisedString, color?: { r: number; g: number; b: number }): LuaGuiElement {
  const label = parent.add({ type: "label", caption })
  label.style.single_line = false
  label.style.maximal_width = WIDTH
  if (color !== undefined) label.style.font_color = color
  return label
}

function exchangeBox(parent: LuaGuiElement, action?: string): TextBoxGuiElement {
  const text = parent.add({ type: "text-box", text: "", style: "automaton_exchange", tags: action === undefined ? {} : { action } })
  text.word_wrap = true
  return text
}

export function closeExchange(player: LuaPlayer): void {
  player.gui.screen[EXPORT_FRAME]?.destroy()
  player.gui.screen[IMPORT_FRAME]?.destroy()
  const state = guiOf(player)
  state.exportWindow = undefined
  state.importWindow = undefined
}

// --- Экспорт ---

export function openExport(player: LuaPlayer, programId?: number): void {
  player.gui.screen[EXPORT_FRAME]?.destroy()
  const frame = player.gui.screen.add({ type: "frame", name: EXPORT_FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-gui.export-title"], "export-close")
  const body = frame.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  wrapLabel(body, ["automaton-gui.export-help"])
  const pane = body.add({ type: "scroll-pane", horizontal_scroll_policy: "never", vertical_scroll_policy: "auto" })
  pane.style.width = WIDTH
  pane.style.maximal_height = 360
  const rows = programTree(programsOf(player.force.name), "")
  const boxes: CheckboxGuiElement[] = []
  rows.forEach((row, i) => {
    const line = pane.add({ type: "flow", direction: "horizontal" })
    line.style.left_padding = (row.indent.length / 4) * 20
    const caption: LocalisedString =
      row.program === undefined
        ? `[color=${FOLDER_COLOR}]${row.short}/[/color]`
        : row.program.library
          ? ["", `[color=${LIBRARY_COLOR}]${row.short}[/color] · `, ["automaton-gui.library-badge"]]
          : row.short
    boxes.push(line.add({ type: "checkbox", state: false, caption, tags: { action: "export-toggle", index: i } }))
  })
  const text = exchangeBox(body)
  text.read_only = true
  const count = body.add({ type: "label", caption: "" })
  const window: ExportWindow = { frame, rows: rows.map((r) => r.entry), boxes, checked: {}, text, count }
  if (programId !== undefined) window.checked[programId] = true
  guiOf(player).exportWindow = window
  refreshExport(window, player)
}

function refreshExport(window: ExportWindow, player: LuaPlayer): void {
  const force = player.force.name
  const programs = programsOf(force)
  const chosen = programs.filter((p) => window.checked[p.id] === true)
  const all = withDependencies(chosen, force)
  window.rows.forEach((row, i) => {
    const box = window.boxes[i]
    if ("folder" in row) {
      const inside = programs.filter((p) => p.name.startsWith(`${row.folder}/`))
      box.state = inside.length > 0 && inside.every((p) => all.includes(p))
      return
    }
    const program = storage.programs.byId[row.id]
    if (program === undefined) {
      box.enabled = false
      return
    }
    const needed = window.checked[row.id] !== true && all.includes(program)
    box.state = all.includes(program)
    box.enabled = !needed
    const users = chosen.filter((p) => p.dependencies.includes(program.name)).map((p) => p.name)
    box.tooltip = needed ? ["automaton-gui.export-needed", users.join(", ")] : ""
  })
  window.text.text = all.length > 0 ? exportPrograms(all) : ""
  window.count.caption = ["automaton-gui.export-count", all.length]
  if (all.length > 0) {
    window.text.focus()
    window.text.select_all()
  }
}

// --- Импорт ---

export function openImport(player: LuaPlayer): void {
  player.gui.screen[IMPORT_FRAME]?.destroy()
  const frame = player.gui.screen.add({ type: "frame", name: IMPORT_FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-gui.import-title"], "import-close")
  const body = frame.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  wrapLabel(body, ["automaton-gui.import-help"])
  const text = exchangeBox(body, "import-text")
  const status = wrapLabel(body, ["automaton-gui.import-empty"])
  const pane = body.add({ type: "scroll-pane", horizontal_scroll_policy: "never", vertical_scroll_policy: "auto" })
  pane.style.width = WIDTH
  pane.style.maximal_height = 300
  const list = pane.add({ type: "table", column_count: 2 })
  list.style.horizontal_spacing = 12
  const apply = body.add({ type: "button", caption: ["automaton-gui.import-apply"], style: "green_button", tags: { action: "import-apply" } })
  apply.enabled = false
  const result = body.add({ type: "flow", direction: "vertical" })
  const window: ImportWindow = { frame, text, status, list, items: [], choices: {}, apply, result }
  guiOf(player).importWindow = window
  text.focus()
}

/** Прочитать строку и показать, что будет сделано. */
function planWindow(window: ImportWindow, player: LuaPlayer): void {
  const decoded = decodePrograms(window.text.text)
  window.list.clear()
  window.items = []
  window.apply.enabled = false
  if (!decoded.ok) {
    window.status.caption = [`automaton-gui.${decoded.error}`, ...(decoded.params ?? [])]
    window.status.style.font_color = decoded.error === "import-empty" ? { r: 1, g: 1, b: 1 } : RED
    return
  }
  window.items = planImport(decoded.programs, player.force.name)
  const count = (status: string) => window.items.filter((i) => i.status === status).length
  window.status.caption = ["automaton-gui.import-found", window.items.length, count("new"), count("conflict"), count("same")]
  window.status.style.font_color = { r: 1, g: 1, b: 1 }
  for (const item of window.items) {
    const name = window.list.add({ type: "label", caption: ["", `${item.name} — `, [`automaton-gui.import-${item.status}`]] })
    name.style.font_color = item.status === "conflict" ? ORANGE : item.status === "new" ? GREEN : { r: 0.7, g: 0.7, b: 0.7 }
    if (item.status === "conflict") {
      const choice = window.choices[item.name] ?? "replace"
      window.list.add({
        type: "drop-down",
        items: CHOICES.map((c) => [`automaton-gui.import-choice-${c}`] as LocalisedString),
        selected_index: CHOICES.indexOf(choice) + 1,
        tags: { action: "import-choice", name: item.name },
      })
    } else window.list.add({ type: "empty-widget" })
  }
  window.apply.enabled = window.items.some((i) => i.status !== "same")
}

/** Вставить строку в окно импорта (как игрок; для снимков и тестов). */
export function pasteImport(player: LuaPlayer, text: string): void {
  const window = guiOf(player).importWindow
  if (window === undefined || !window.frame.valid) return
  window.text.text = text
  planWindow(window, player)
}

function applyWindow(window: ImportWindow, player: LuaPlayer): void {
  window.result.clear()
  const denied = publishDenied(player)
  if (denied !== undefined) {
    wrapLabel(window.result, [`automaton-diagnostic.${denied}`], RED)
    return
  }
  notePublish(player)
  const result = applyImport(window.items, window.choices, player.force.name, player.name)
  if (result.published.length > 0) wrapLabel(window.result, ["automaton-gui.import-published", result.published.join(", ")], GREEN)
  if (result.skipped.length > 0) wrapLabel(window.result, ["automaton-gui.import-skipped", result.skipped.join(", ")])
  for (const failed of result.failed) {
    wrapLabel(window.result, ["automaton-gui.import-failed", failed.name], RED)
    for (const d of failed.diagnostics.slice(0, 3)) wrapLabel(window.result, ["", "    ", diagnosticText(d)], RED)
  }
  // Список — заново: опубликованные теперь «те же».
  window.choices = {}
  planWindow(window, player)
}

export function registerExchangeWindows(): void {
  onGuiClick("programs-export", (player) => openExport(player, guiOf(player).programs?.programId))
  onGuiClick("programs-import", (player) => openImport(player))
  onGuiClick("export-close", (player) => {
    player.gui.screen[EXPORT_FRAME]?.destroy()
    guiOf(player).exportWindow = undefined
  })
  onGuiClick("import-close", (player) => {
    player.gui.screen[IMPORT_FRAME]?.destroy()
    guiOf(player).importWindow = undefined
  })
  onGuiChecked("export-toggle", (player, element) => {
    const window = guiOf(player).exportWindow
    const index = (element.tags as { index?: number }).index
    if (window === undefined || !window.frame.valid || index === undefined) return
    const row = window.rows[index]
    const state = (element as CheckboxGuiElement).state
    if ("folder" in row) {
      for (const p of programsOf(player.force.name)) if (p.name.startsWith(`${row.folder}/`)) window.checked[p.id] = state || undefined
    } else window.checked[row.id] = state || undefined
    refreshExport(window, player)
  })
  onGuiChange("import-text", (player) => {
    const window = guiOf(player).importWindow
    if (window === undefined || !window.frame.valid) return
    window.result.clear()
    planWindow(window, player)
  })
  onGuiSelection("import-choice", (player, element) => {
    const window = guiOf(player).importWindow
    const name = (element.tags as { name?: string }).name
    if (window === undefined || !window.frame.valid || name === undefined) return
    window.choices[name] = CHOICES[(element as unknown as { selected_index: number }).selected_index - 1]
  })
  onGuiClick("import-apply", (player) => {
    const window = guiOf(player).importWindow
    if (window !== undefined && window.frame.valid) applyWindow(window, player)
  })
}
