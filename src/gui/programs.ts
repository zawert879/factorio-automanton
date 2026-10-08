// Окно «Программы команды» (5.2, 5.4, 5.5, 5.9): библиотека программ команды и редактор.
// Публикация = компиляция: с ошибками программа не публикуется, ошибки — со строкой и текстом.
// Изменение опубликованной программы перезапускает машины с ней (src/program/machines.ts).
//
// Редактор: поле кода растягивается на весь текст внутри общей прокрутки, слева — номера строк
// (такое же поле, только для чтения, — строки совпадают), справа — невидимые метки строк, к которым
// прокручивает клик по ошибке. Черновик у каждого игрока: закрыл окно — текст не пропал.
import {
  ButtonGuiElement,
  DropDownGuiElement,
  EmptyWidgetGuiElement,
  FlowGuiElement,
  FrameGuiElement,
  ListBoxGuiElement,
  LocalisedString,
  LuaGuiElement,
  LuaPlayer,
  ScrollPaneGuiElement,
  TextBoxGuiElement,
  TextFieldGuiElement,
} from "factorio:runtime"
import { Diagnostic } from "../lang/lexer"
import { ulen } from "../lang/runtime/strings"
import { assignProgram } from "../program/machines"
import { deleteProgram, notePublish, programsOf, publish, publishDenied } from "../program/store"
import { guiOf, onGuiChange, onGuiClick, onGuiSelection, titlebar } from "./common"
import { DTS } from "./dts.generated"

const FRAME = "automaton-programs"
const TYPES_FRAME = "automaton-types"
const MAX_ERRORS = 8
/** Высота строки шрифта кода (automaton-code, 14) в единицах интерфейса — по снимку экрана. */
const LINE_HEIGHT = 20
/** Отступы поля сверху и снизу (стиль automaton_code). */
const CODE_PADDING = 8

const TEMPLATE = `// Новая программа. Справка по API — docs/API.md в папке мода, типы — «Типы для VS Code».
while (true) {
  print("Привет от", me.name)
  wait(5)
}
`

export interface ProgramsWindow {
  frame: FrameGuiElement
  list: ListBoxGuiElement
  listIds: number[]
  name: TextFieldGuiElement
  info: LuaGuiElement
  pane: ScrollPaneGuiElement
  numbers: TextBoxGuiElement
  code: TextBoxGuiElement
  marks: FlowGuiElement
  lineCount: number
  errorLines: Record<number, boolean>
  errors: FlowGuiElement
  versions: DropDownGuiElement
  assign: ButtonGuiElement
  /** Редактируемая программа (undefined — новая, ещё не опубликованная). */
  programId?: number
  /** Машина, из окна которой открыли библиотеку (кнопка «Назначить»). */
  robotId?: number
}

/** Черновик игрока: текст в редакторе, ещё не опубликованный. */
export interface Draft {
  programId?: number
  name: string
  source: string
}

function drafts(): Record<number, Draft | undefined> {
  storage.drafts ??= {}
  return storage.drafts
}

function button(parent: LuaGuiElement, caption: LocalisedString, action: string, style = "button"): ButtonGuiElement {
  return parent.add({ type: "button", caption, tags: { action }, style })
}

/** Размер редактора по экрану игрока (в единицах интерфейса). */
function editorSize(player: LuaPlayer): { width: number; height: number } {
  const scale = player.display_scale
  const width = math.floor(player.display_resolution.width / scale)
  const height = math.floor(player.display_resolution.height / scale)
  return { width: math.max(600, math.min(1600, width - 420)), height: math.max(300, height - 330) }
}

export function openPrograms(player: LuaPlayer, programId?: number, robotId?: number): void {
  closePrograms(player)
  const size = editorSize(player)
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-gui.programs-title"], "programs-close")
  const body = frame.add({ type: "flow", direction: "horizontal" })
  body.style.horizontal_spacing = 12

  const left = body.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const list = left.add({ type: "list-box", items: [], tags: { action: "programs-select" } })
  list.style.width = 220
  list.style.height = size.height
  const leftButtons = left.add({ type: "flow", direction: "horizontal" })
  button(leftButtons, ["automaton-gui.new-program"], "programs-new")
  button(leftButtons, ["automaton-gui.copy-program"], "programs-copy")
  button(leftButtons, ["automaton-gui.delete-program"], "programs-delete", "red_button")

  const right = body.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const header = right.add({ type: "flow", direction: "horizontal" })
  header.style.vertical_align = "center"
  header.add({ type: "label", caption: ["automaton-gui.program-name"], style: "bold_label" })
  const name = header.add({ type: "textfield", text: "", tags: { action: "programs-name" } })
  name.style.width = 300
  const info = header.add({ type: "label", caption: "" })

  const pane = right.add({ type: "scroll-pane", vertical_scroll_policy: "auto-and-reserve-space", horizontal_scroll_policy: "never" })
  pane.style.width = size.width
  pane.style.height = size.height
  const row = pane.add({ type: "flow", direction: "horizontal" })
  row.style.horizontal_spacing = 0
  const numbers = row.add({ type: "text-box", text: "", style: "automaton_line_numbers" })
  numbers.read_only = true
  numbers.word_wrap = false
  const code = row.add({ type: "text-box", text: "", style: "automaton_code", tags: { action: "programs-code" } })
  code.word_wrap = false
  code.style.width = size.width - 64 - 24
  const marks = row.add({ type: "flow", direction: "vertical" })
  marks.style.vertical_spacing = 0
  marks.style.top_padding = CODE_PADDING / 2

  const errors = right.add({ type: "flow", direction: "vertical" })
  const buttons = right.add({ type: "flow", direction: "horizontal" })
  button(buttons, ["automaton-gui.publish"], "programs-publish", "green_button")
  const assign = button(buttons, "", "programs-assign")
  const versions = buttons.add({ type: "drop-down", items: [], tags: { action: "programs-version" } })
  versions.style.width = 200
  button(buttons, ["automaton-gui.types"], "programs-types")

  player.opened = frame
  const window: ProgramsWindow = {
    frame,
    list,
    listIds: [],
    name,
    info,
    pane,
    numbers,
    code,
    marks,
    lineCount: -1,
    errorLines: {},
    errors,
    versions,
    assign,
    robotId,
  }
  guiOf(player).programs = window
  refreshList(window, player)
  load(window, player, programId)
}

export function closePrograms(player: LuaPlayer): void {
  const state = guiOf(player)
  if (state.programs?.frame.valid) state.programs.frame.destroy()
  state.programs = undefined
  player.gui.screen[TYPES_FRAME]?.destroy()
}

function windowOf(player: LuaPlayer): ProgramsWindow | undefined {
  const window = guiOf(player).programs
  return window !== undefined && window.frame.valid ? window : undefined
}

function refreshList(window: ProgramsWindow, player: LuaPlayer): void {
  const programs = programsOf(player.force.name)
  window.listIds = programs.map((p) => p.id)
  window.list.items = programs.map((p) => (p.quarantined ? `⚠ ${p.name} v${p.version}` : `${p.name} v${p.version}`))
  const index = window.programId === undefined ? -1 : window.listIds.indexOf(window.programId)
  window.list.selected_index = index >= 0 ? index + 1 : 0
}

/** Строки кода: высота полей по числу строк, номера (с отметками ошибок), метки для прокрутки. */
function layoutLines(window: ProgramsWindow, force = false): void {
  const text = window.code.text
  let count = 1
  for (const [_] of string.gmatch(text, "\n")) count++
  if (count === window.lineCount && !force) return
  window.lineCount = count
  const height = count * LINE_HEIGHT + CODE_PADDING + LINE_HEIGHT
  window.code.style.height = height
  window.numbers.style.height = height
  const numbers: string[] = []
  for (let i = 1; i <= count; i++) numbers.push(`${window.errorLines[i] ? "●" : " "}${string.format("%4d", i)}`)
  window.numbers.text = numbers.join("\n")
  const marks = window.marks.children
  for (let i = marks.length; i < count; i++) {
    const mark = window.marks.add({ type: "empty-widget" }) as EmptyWidgetGuiElement
    mark.style.height = LINE_HEIGHT
    mark.style.width = 1
  }
  for (let i = marks.length - 1; i >= count; i--) marks[i].destroy()
}

function saveDraft(window: ProgramsWindow, player: LuaPlayer): void {
  drafts()[player.index] = { programId: window.programId, name: window.name.text, source: window.code.text }
}

/** Показать программу в редакторе: черновик игрока, если он есть, иначе опубликованный текст (или шаблон). */
function load(window: ProgramsWindow, player: LuaPlayer, programId: number | undefined, source?: string, name?: string): void {
  const program = programId === undefined ? undefined : storage.programs.byId[programId]
  const draft = drafts()[player.index]
  const fromDraft = source === undefined && draft !== undefined && draft.programId === program?.id
  window.programId = program?.id
  window.name.text = name ?? (fromDraft ? draft!.name : (program?.name ?? ""))
  window.code.text = source ?? (fromDraft ? draft!.source : (program?.source ?? TEMPLATE))
  window.info.caption =
    program === undefined
      ? ["automaton-gui.draft"]
      : fromDraft && draft!.source !== program.source
        ? ["automaton-gui.program-info-draft", program.version, program.author ?? "—"]
        : ["automaton-gui.program-info", program.version, program.author ?? "—"]
  window.errorLines = {}
  window.errors.clear()
  if (program?.quarantined) window.errors.add({ type: "label", caption: ["automaton-gui.quarantined"] }).style.font_color = { r: 1, g: 0.6, b: 0.2 }
  window.versions.items = program === undefined ? [] : program.history.map((v) => `v${v.version} — ${v.author ?? "—"}`)
  window.versions.selected_index = program === undefined ? 0 : program.history.length
  const robot = window.robotId === undefined ? undefined : storage.robots.byId[window.robotId]
  window.assign.visible = robot !== undefined && program !== undefined
  window.assign.caption = ["automaton-gui.assign", robot?.name ?? ""]
  layoutLines(window, true)
  window.pane.scroll_to_top()
}

/** Ошибка компиляции понятным текстом: «строка:столбец текст». */
export function diagnosticText(d: Diagnostic): LocalisedString {
  const params: LocalisedString[] = d.params.map((p, i) => (d.code === "unsupported" && i === 0 ? [`automaton-feature.${p}`] : tostring(p)))
  return ["", `${d.line}:${d.column}  `, [`automaton-diagnostic.${d.code}`, ...params]]
}

function showErrors(window: ProgramsWindow, diagnostics: Diagnostic[]): void {
  window.errors.clear()
  window.errorLines = {}
  for (const d of diagnostics.slice(0, MAX_ERRORS)) {
    if (d.line > 0) window.errorLines[d.line] = true
    const line = window.errors.add({ type: "label", caption: diagnosticText(d), tags: { action: "programs-goto", line: d.line } })
    line.style.font_color = { r: 1, g: 0.45, b: 0.4 }
    line.tooltip = ["automaton-gui.goto-line"]
  }
  if (diagnostics.length > MAX_ERRORS) window.errors.add({ type: "label", caption: ["automaton-gui.more-errors", diagnostics.length - MAX_ERRORS] })
  layoutLines(window, true)
  if (diagnostics[0] !== undefined && diagnostics[0].line > 0) goToLine(window, diagnostics[0].line)
}

/** Выделить строку кода и прокрутить к ней. */
function goToLine(window: ProgramsWindow, line: number): void {
  const lines = window.code.text.split("\n")
  if (line < 1 || line > lines.length) return
  let start = 1
  for (let i = 0; i < line - 1; i++) start += ulen(lines[i]) + 1
  const length = ulen(lines[line - 1])
  window.code.focus()
  window.code.select(start, start + length - 1)
  const mark = window.marks.children[line - 1]
  if (mark !== undefined) window.pane.scroll_to_element(mark, "top-third")
}

export function showTypes(player: LuaPlayer): void {
  player.gui.screen[TYPES_FRAME]?.destroy()
  const frame = player.gui.screen.add({ type: "frame", name: TYPES_FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-gui.types-title"], "types-close")
  const help = frame.add({ type: "label", caption: ["automaton-gui.types-help"] })
  help.style.single_line = false
  help.style.maximal_width = 760
  const text = frame.add({ type: "text-box", text: DTS, style: "automaton_types" })
  text.read_only = true
  text.word_wrap = false
  text.focus()
  text.select_all()
}

export function registerProgramsWindow(): void {
  registerAssign()
  onGuiClick("programs-close", (player) => closePrograms(player))
  onGuiClick("types-close", (player) => player.gui.screen[TYPES_FRAME]?.destroy())

  onGuiChange("programs-code", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    layoutLines(window)
    saveDraft(window, player)
  })
  onGuiChange("programs-name", (player) => {
    const window = windowOf(player)
    if (window !== undefined) saveDraft(window, player)
  })
  onGuiClick("programs-goto", (player, element) => {
    const window = windowOf(player)
    const line = (element.tags as { line?: number }).line
    if (window !== undefined && line !== undefined) goToLine(window, line)
  })
  onGuiSelection("programs-select", (player, element) => {
    const window = windowOf(player)
    const selected = (element as ListBoxGuiElement).selected_index
    if (window === undefined || selected === 0) return
    load(window, player, window.listIds[selected - 1])
  })
  onGuiSelection("programs-version", (player, element) => {
    const window = windowOf(player)
    const program = window?.programId === undefined ? undefined : storage.programs.byId[window.programId]
    const selected = (element as DropDownGuiElement).selected_index
    if (window === undefined || program === undefined || selected === 0) return
    const version = program.history[selected - 1]
    if (version === undefined) return
    window.code.text = version.source
    layoutLines(window)
    saveDraft(window, player)
  })
  onGuiClick("programs-new", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    load(window, player, undefined, TEMPLATE, "")
    window.list.selected_index = 0
    saveDraft(window, player)
    window.name.focus()
  })
  onGuiClick("programs-copy", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    const name = window.name.text
    const source = window.code.text
    load(window, player, undefined, source, name === "" ? "" : `${name} (копия)`)
    window.list.selected_index = 0
    saveDraft(window, player)
  })
  onGuiClick("programs-delete", (player) => {
    const window = windowOf(player)
    if (window === undefined || window.programId === undefined) return
    deleteProgram(window.programId)
    drafts()[player.index] = undefined
    load(window, player, undefined)
    refreshList(window, player)
  })
  onGuiClick("programs-publish", (player) => publishFromWindow(player))
  onGuiClick("programs-types", (player) => showTypes(player))
}

/** Кнопка «Опубликовать»: права, компиляция, ошибки или новая версия. */
export function publishFromWindow(player: LuaPlayer): void {
  const window = windowOf(player)
  if (window === undefined) return
  const denied = publishDenied(player)
  if (denied !== undefined) {
    showErrors(window, [{ code: denied, params: [], line: 0, column: 0 }])
    return
  }
  notePublish(player)
  const result = publish({ id: window.programId, name: window.name.text, source: window.code.text, author: player.name, force: player.force.name })
  if (!result.ok) {
    showErrors(window, result.diagnostics)
    return
  }
  drafts()[player.index] = undefined
  load(window, player, result.program.id)
  refreshList(window, player)
  window.errors.add({ type: "label", caption: ["automaton-gui.published", result.program.version] }).style.font_color = { r: 0.5, g: 1, b: 0.5 }
}

function registerAssign(): void {
  onGuiClick("programs-assign", (player) => {
    const window = windowOf(player)
    if (window === undefined || window.programId === undefined || window.robotId === undefined) return
    const robot = storage.robots.byId[window.robotId]
    const program = storage.programs.byId[window.programId]
    if (robot === undefined || program === undefined) return
    assignProgram(robot, program)
    window.errors.clear()
    window.errors.add({ type: "label", caption: ["automaton-gui.assigned", robot.name, program.name] })
  })
}
