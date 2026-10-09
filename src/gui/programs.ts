// Окно «Программы команды» (5.2, 5.4, 5.5, 5.9): библиотека программ команды и редактор.
// Публикация = компиляция: с ошибками программа не публикуется, ошибки — со строкой и текстом.
// Изменение опубликованной программы перезапускает машины с ней (src/program/machines.ts).
//
// Редактор: поле кода растягивается на весь текст внутри общей прокрутки, слева — номера строк
// (такое же поле, только для чтения, — строки совпадают), справа — невидимые метки строк, к которым
// прокручивает клик по ошибке. Черновик у каждого игрока: закрыл окно — текст не пропал.
//
// Просмотр (подсветка, вариант A): программа открывается в цвете — строки-подписи с rich text
// (src/lang/highlight.ts); в поле ввода цвета нет — теги стали бы частью кода. «Править» или клик по
// строке — поле ввода с курсором на ней; после публикации — снова просмотр, ошибки — красным в строке.
//
// Список — дерево папок (имя программы с «/», этап 17): папки сворачиваются кликом, поиск по имени
// раскрывает всё найденное. Библиотеки помечены; у программы видно, кто её импортирует и не отстала ли
// её сборка от новой версии модуля.
import {
  ButtonGuiElement,
  DropDownGuiElement,
  EmptyWidgetGuiElement,
  FlowGuiElement,
  FrameGuiElement,
  LabelGuiElement,
  ListBoxGuiElement,
  LocalisedString,
  LuaGuiElement,
  LuaPlayer,
  ScrollPaneGuiElement,
  TableGuiElement,
  TextBoxGuiElement,
  TextFieldGuiElement,
} from "factorio:runtime"
import { escapeRichText, highlight, markError, Paint, richLine } from "../lang/highlight"
import { Diagnostic } from "../lang/lexer"
import { ulen } from "../lang/runtime/strings"
import { assignProgram } from "../program/machines"
import {
  checkProgram,
  deleteProgram,
  deletePrograms,
  dependentsOf,
  findProgram,
  notePublish,
  onProgramPublished,
  onProgramRemoved,
  ProgramRecord,
  programsOf,
  publish,
  publishDenied,
  rightsDenied,
} from "../program/store"
import { onRefreshResult, onRefreshTimeout, requestRefresh, writeVsCodeFolder } from "../program/sync"
import { guiOf, onGuiChange, onGuiClick, onGuiSelection, titlebar } from "./common"
import { DTS } from "./dts.generated"
import { folderItem, LIBRARY_COLOR, programTree, TreeEntry } from "./tree"

const FRAME = "automaton-programs"
const CONFIRM_FRAME = "automaton-refresh-confirm"
const TYPES_FRAME = "automaton-types"
const MAX_ERRORS = 8
/** Высота строки шрифта кода (automaton-code, 14) в единицах интерфейса — по снимку экрана. */
const LINE_HEIGHT = 20
/** Отступы поля сверху и снизу (стиль automaton_code). */
const CODE_PADDING = 8
/** Длиннее — без просмотра с подсветкой (строка — две подписи). */
const VIEW_MAX_LINES = 2000
/** Ширина номеров строк в просмотре (стиль automaton_code_number) и отступ справа. */
const VIEW_GUTTER = 52 + 6

/** Цвета подсветки на светлом фоне поля. */
const PALETTE: Record<Paint, string | undefined> = {
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
const ERROR_TEXT = "#c0392b"

const TEMPLATE = `// Новая программа. Все функции с описаниями — «Типы для VS Code»; руководство и примеры —
// github.com/zawert879/factorio-automanton
while (true) {
  print("Привет от", me.name)
  wait(5)
}
`


export interface ProgramsWindow {
  frame: FrameGuiElement
  search: TextFieldGuiElement
  list: ListBoxGuiElement
  entries: TreeEntry[]
  /** Свёрнутые папки (полный путь). */
  collapsed: Record<string, boolean | undefined>
  name: TextFieldGuiElement
  info: LuaGuiElement
  pane: ScrollPaneGuiElement
  /** Правка: номера строк, поле кода, метки строк. */
  row: FlowGuiElement
  numbers: TextBoxGuiElement
  code: TextBoxGuiElement
  marks: FlowGuiElement
  /** Просмотр с подсветкой: по строке — номер и код (подписи). */
  view: FrameGuiElement
  viewLines: TableGuiElement
  viewWidth: number
  /** Поле кода — не ниже окна: клик под текстом тоже попадает в поле. */
  minCodeHeight: number
  mode: "view" | "edit"
  viewButton: ButtonGuiElement
  editButton: ButtonGuiElement
  /** Под именем: кто импортирует, отставшая сборка. */
  notes: FlowGuiElement
  lineCount: number
  /** Ошибки публикации по строкам (первая в строке). */
  errorLines: Record<number, Diagnostic | undefined>
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
  const searchRow = left.add({ type: "flow", direction: "horizontal" })
  searchRow.style.vertical_align = "center"
  searchRow.add({ type: "label", caption: ["automaton-gui.search"] })
  const search = searchRow.add({ type: "textfield", text: "", tags: { action: "programs-search" } })
  search.style.width = 170
  const list = left.add({ type: "list-box", items: [], tags: { action: "programs-select" } })
  list.style.width = 240
  list.style.height = size.height - 36
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
  const notes = right.add({ type: "flow", direction: "vertical" })

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
  const view = pane.add({ type: "frame", style: "automaton_code_view", direction: "vertical" })
  view.style.minimal_width = size.width - 24
  view.style.minimal_height = size.height - 12
  const viewLines = view.add({ type: "table", column_count: 2 })
  viewLines.style.horizontal_spacing = 0
  viewLines.style.vertical_spacing = 0

  const errors = right.add({ type: "flow", direction: "vertical" })
  const buttons = right.add({ type: "flow", direction: "horizontal" })
  const viewButton = button(buttons, ["automaton-gui.view-mode"], "programs-view")
  viewButton.tooltip = ["automaton-gui.view-mode-tooltip"]
  const editButton = button(buttons, ["automaton-gui.edit-mode"], "programs-edit")
  editButton.tooltip = ["automaton-gui.edit-mode-tooltip"]
  button(buttons, ["automaton-gui.check"], "programs-check").tooltip = ["automaton-gui.check-tooltip"]
  button(buttons, ["automaton-gui.publish"], "programs-publish", "green_button")
  const assign = button(buttons, "", "programs-assign")
  const versions = buttons.add({ type: "drop-down", items: [], tags: { action: "programs-version" } })
  versions.style.width = 200
  button(buttons, ["automaton-gui.types"], "programs-types")
  button(buttons, ["automaton-gui.vscode-folder"], "programs-vscode")
  const refresh = button(buttons, ["automaton-gui.refresh"], "programs-refresh")
  refresh.tooltip = ["automaton-gui.refresh-tooltip"]

  player.opened = frame
  const window: ProgramsWindow = {
    frame,
    search,
    list,
    entries: [],
    collapsed: {},
    name,
    info,
    pane,
    row,
    numbers,
    code,
    marks,
    view,
    viewLines,
    viewWidth: size.width - 24 - VIEW_GUTTER,
    minCodeHeight: size.height - 12,
    mode: "edit",
    viewButton,
    editButton,
    notes,
    lineCount: -1,
    errorLines: {},
    errors,
    versions,
    assign,
    robotId,
  }
  guiOf(player).programs = window
  load(window, player, programId)
  refreshList(window, player)
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

/** Строка программы в списке: последняя часть имени, версия, пометки. */
function programItem(p: ProgramRecord, indent: string): LocalisedString {
  const short = p.name.split("/").pop()!
  const warn = p.quarantined || p.stale !== undefined ? "⚠ " : ""
  if (!p.library) return `${indent}${warn}${short} v${p.version}`
  return ["", `${indent}${warn}[color=${LIBRARY_COLOR}]${short}[/color] v${p.version} · `, ["automaton-gui.library-badge"]]
}

function refreshList(window: ProgramsWindow, player: LuaPlayer): void {
  const rows = programTree(programsOf(player.force.name), window.search.text, window.collapsed)
  window.entries = rows.map((row) => row.entry)
  window.list.items = rows.map((row) => (row.program === undefined ? folderItem(row) : programItem(row.program, row.indent)))
  const index = window.programId === undefined ? -1 : window.entries.findIndex((e) => "id" in e && e.id === window.programId)
  window.list.selected_index = index >= 0 ? index + 1 : 0
}

/** Строки кода: высота полей по числу строк, номера (с отметками ошибок), метки для прокрутки. */
function layoutLines(window: ProgramsWindow, force = false): void {
  const text = window.code.text
  let count = 1
  for (const [_] of string.gmatch(text, "\n")) count++
  if (count === window.lineCount && !force) return
  window.lineCount = count
  const height = math.max(count * LINE_HEIGHT + CODE_PADDING + LINE_HEIGHT, window.minCodeHeight)
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
  const info: LocalisedString =
    program === undefined
      ? ["automaton-gui.draft"]
      : fromDraft && draft!.source !== program.source
        ? ["automaton-gui.program-info-draft", program.version, program.author ?? "—"]
        : ["automaton-gui.program-info", program.version, program.author ?? "—"]
  window.info.caption = program?.library ? ["", info, " · ", ["automaton-gui.library-badge"]] : info
  window.errorLines = {}
  window.errors.clear()
  window.notes.clear()
  if (program?.quarantined) window.errors.add({ type: "label", caption: ["automaton-gui.quarantined"] }).style.font_color = { r: 1, g: 0.6, b: 0.2 }
  if (program !== undefined) showNotes(window, program)
  window.versions.items =
    program === undefined
      ? []
      : program.history.map((v): LocalisedString => (v.rebuiltFor === undefined ? `v${v.version} — ${v.author ?? "—"}` : ["automaton-gui.version-rebuilt", v.version, v.rebuiltFor]))
  window.versions.selected_index = program === undefined ? 0 : program.history.length
  const robot = window.robotId === undefined ? undefined : storage.robots.byId[window.robotId]
  window.assign.visible = robot !== undefined && program !== undefined && !program.library
  window.assign.caption = ["automaton-gui.assign", robot?.name ?? ""]
  layoutLines(window, true)
  // Опубликованная программа — в просмотре, новая — сразу в поле ввода.
  setMode(window, program === undefined ? "edit" : "view")
  window.pane.scroll_to_top()
}

/** Просмотр с подсветкой или правка в поле ввода (длинная программа — только правка). */
function setMode(window: ProgramsWindow, mode: "view" | "edit"): void {
  const tooLong = window.lineCount > VIEW_MAX_LINES
  if (tooLong) mode = "edit"
  window.mode = mode
  window.row.visible = mode === "edit"
  window.view.visible = mode === "view"
  window.viewButton.toggled = mode === "view"
  window.editButton.toggled = mode === "edit"
  window.viewButton.enabled = !tooLong
  window.viewButton.tooltip = tooLong ? ["automaton-gui.view-too-long", VIEW_MAX_LINES] : ["automaton-gui.view-mode-tooltip"]
  window.pane.horizontal_scroll_policy = mode === "view" ? "auto" : "never"
  if (mode === "view") renderView(window)
}

/** Строки просмотра: номер (у строки с ошибкой — красная точка) и код в цвете; ошибка — красным и текстом в конце. */
function renderView(window: ProgramsWindow): void {
  const lines = highlight(window.code.text)
  const table = window.viewLines
  const cells = table.children
  for (let i = 1; i <= lines.length; i++) {
    let number = cells[(i - 1) * 2] as LabelGuiElement | undefined
    let code = cells[(i - 1) * 2 + 1] as LabelGuiElement | undefined
    if (number === undefined || code === undefined) {
      number = table.add({ type: "label", style: "automaton_code_number", tags: { action: "programs-view-line", line: i } })
      code = table.add({ type: "label", style: "automaton_code_line", tags: { action: "programs-view-line", line: i } })
      code.style.minimal_width = window.viewWidth
    }
    const error = window.errorLines[i]
    if (error === undefined) {
      number.caption = `${i}`
      code.caption = richLine(lines[i - 1], PALETTE)
      code.tooltip = ""
    } else {
      number.caption = `[color=${PALETTE.error}]●[/color] ${i}`
      code.caption = ["", richLine(markError(lines[i - 1], error.column), PALETTE), `[color=${ERROR_TEXT}]    ◀ `, diagnosticMessage(error, true), "[/color]"]
      code.tooltip = diagnosticText(error)
    }
  }
  for (let k = cells.length - 1; k >= lines.length * 2; k--) cells[k].destroy()
}

/** Подпись кода строки в просмотре (на строку — номер и код). */
function viewLine(window: ProgramsWindow, line: number): LuaGuiElement | undefined {
  return window.viewLines.children[(line - 1) * 2 + 1]
}

/** Перейти к правке строки: выделить её (selectLine) или поставить курсор в её конец. */
function editAt(window: ProgramsWindow, line: number, selectLine: boolean): void {
  setMode(window, "edit")
  goToLine(window, line, selectLine)
}

/** Кто импортирует программу; сборка, отставшая от новой версии модуля. */
function showNotes(window: ProgramsWindow, program: ProgramRecord): void {
  const users = dependentsOf(program.name, program.force).map((p) => p.name)
  if (users.length > 0) {
    const label = window.notes.add({ type: "label", caption: ["automaton-gui.used-by", users.join(", ")] })
    label.style.single_line = false
    label.style.maximal_width = 900
  }
  const stale = program.stale
  if (stale !== undefined) {
    const first = stale.diagnostics[0]
    const label = window.notes.add({
      type: "label",
      caption: ["automaton-gui.stale", stale.module, stale.version, first === undefined ? "" : diagnosticText(first)],
      tags: first === undefined ? {} : { action: "programs-goto", line: first.line, module: first.module ?? "" },
    })
    label.style.single_line = false
    label.style.maximal_width = 900
    label.style.font_color = { r: 1, g: 0.75, b: 0.3 }
  }
}

/** Ошибка компиляции понятным текстом: «[модуль:]строка:столбец текст». */
export function diagnosticText(d: Diagnostic): LocalisedString {
  return ["", `${d.module !== undefined ? `${d.module}:` : ""}${d.line}:${d.column}  `, diagnosticMessage(d)]
}

/** Текст ошибки без места; rich — для подписи с rich text (знаки кода в параметрах — как есть, не теги). */
function diagnosticMessage(d: Diagnostic, rich = false): LocalisedString {
  const params: LocalisedString[] = d.params.map((p, i) =>
    d.code === "unsupported" && i === 0 ? [`automaton-feature.${p}`] : rich ? escapeRichText(tostring(p)) : tostring(p),
  )
  return [`automaton-diagnostic.${d.code}`, ...params]
}

function showErrors(window: ProgramsWindow, diagnostics: Diagnostic[]): void {
  window.errors.clear()
  window.errorLines = {}
  for (const d of diagnostics.slice(0, MAX_ERRORS)) {
    // Ошибка в другом модуле: клик откроет его.
    if (d.line > 0 && d.module === undefined) window.errorLines[d.line] ??= d
    const line = window.errors.add({ type: "label", caption: diagnosticText(d), tags: { action: "programs-goto", line: d.line, module: d.module ?? "" } })
    line.style.font_color = { r: 1, g: 0.45, b: 0.4 }
    line.tooltip = ["automaton-gui.goto-line"]
  }
  if (diagnostics.length > MAX_ERRORS) window.errors.add({ type: "label", caption: ["automaton-gui.more-errors", diagnostics.length - MAX_ERRORS] })
  layoutLines(window, true)
  const first = diagnostics[0]
  if (first === undefined || first.line <= 0 || first.module !== undefined) return
  // Ошибки — в просмотре, в своих строках; клик по строке — правка.
  setMode(window, "view")
  const target = window.mode === "view" ? viewLine(window, first.line) : undefined
  if (target !== undefined) window.pane.scroll_to_element(target, "top-third")
  else goToLine(window, first.line, true)
}

/** Прокрутить к строке кода и выделить её (selectLine) или поставить курсор в её конец. */
function goToLine(window: ProgramsWindow, line: number, selectLine: boolean): void {
  const lines = window.code.text.split("\n")
  if (line < 1 || line > lines.length) return
  let start = 1
  for (let i = 0; i < line - 1; i++) start += ulen(lines[i]) + 1
  const length = ulen(lines[line - 1])
  window.code.focus()
  if (selectLine) window.code.select(start, start + length - 1)
  else window.code.select(start + length, start + length - 1)
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

/** Сообщение под редактором (зелёное, оранжевое или красное). */
function note(window: ProgramsWindow, caption: LocalisedString, color: { r: number; g: number; b: number }): void {
  const label = window.errors.add({ type: "label", caption })
  label.style.single_line = false
  label.style.maximal_width = 900
  label.style.font_color = color
}

/** Итог «Обновить из папки»: что опубликовано и что не собралось; программы без файлов — спросить. */
function showRefreshResult(player: LuaPlayer, published: string[], failed: string[], missing: string[]): void {
  const window = windowOf(player)
  const lines: LocalisedString[] = [["automaton-gui.refresh-result", published.length, published.length > 0 ? published.join(", ") : "—"]]
  if (failed.length > 0) lines.push(["automaton-gui.refresh-failed", failed.join(", ")])
  if (window !== undefined) {
    window.errors.clear()
    for (const line of lines) note(window, line, line === lines[0] ? { r: 0.5, g: 1, b: 0.5 } : { r: 1, g: 0.75, b: 0.3 })
    refreshList(window, player)
  }
  for (const line of lines) player.print(line)
  if (missing.length > 0) askDeleteMissing(player, missing)
}

/** Программы игры без файлов в src: удалить их? (по сети это могут быть программы товарищей). */
function askDeleteMissing(player: LuaPlayer, missing: string[]): void {
  player.gui.screen[CONFIRM_FRAME]?.destroy()
  const frame = player.gui.screen.add({ type: "frame", name: CONFIRM_FRAME, direction: "vertical", caption: ["automaton-gui.refresh-missing-title"] })
  frame.auto_center = true
  const text = frame.add({ type: "label", caption: ["automaton-gui.refresh-missing", missing.join(", ")] })
  text.style.single_line = false
  text.style.maximal_width = 520
  const row = frame.add({ type: "flow", direction: "horizontal" })
  button(row, ["automaton-gui.refresh-keep"], "refresh-keep")
  button(row, ["automaton-gui.refresh-delete"], "refresh-delete", "red_button")
  guiOf(player).refreshMissing = missing
}

export function registerProgramsWindow(): void {
  registerAssign()
  onRefreshResult((player, published, failed, missing) => showRefreshResult(player, published, failed, missing))
  onRefreshTimeout((player) => {
    player.print(["automaton-gui.refresh-timeout"])
    const window = windowOf(player)
    if (window === undefined) return
    window.errors.clear()
    note(window, ["automaton-gui.refresh-timeout"], { r: 1, g: 0.75, b: 0.3 })
  })
  // Программы изменились (публикация, удаление — в игре, из VS Code, товарищем) — списки в открытых окнах тоже.
  const refreshOpen = () => {
    for (const player of game.connected_players) {
      const window = windowOf(player)
      if (window !== undefined) refreshList(window, player)
    }
  }
  onProgramPublished((program) => {
    refreshOpen()
    // Программа открыта в просмотре без черновика (из VS Code, товарищем) — показать новую версию.
    for (const player of game.connected_players) {
      const window = windowOf(player)
      if (window === undefined || window.mode !== "view" || window.programId !== program.id) continue
      if (drafts()[player.index]?.programId !== program.id) load(window, player, program.id)
    }
  })
  onProgramRemoved(() => refreshOpen())
  onGuiClick("programs-refresh", (player) => {
    const window = windowOf(player)
    requestRefresh(player)
    if (window === undefined) return
    window.errors.clear()
    note(window, ["automaton-gui.refresh-sent"], { r: 0.8, g: 0.8, b: 0.8 })
  })
  onGuiClick("refresh-keep", (player) => {
    player.gui.screen[CONFIRM_FRAME]?.destroy()
    guiOf(player).refreshMissing = undefined
  })
  onGuiClick("refresh-delete", (player) => {
    const names = guiOf(player).refreshMissing ?? []
    player.gui.screen[CONFIRM_FRAME]?.destroy()
    guiOf(player).refreshMissing = undefined
    const denied = rightsDenied(player)
    if (denied !== undefined) {
      player.print([`automaton-diagnostic.${denied}`])
      return
    }
    const { deleted, kept } = deletePrograms(names, player.force.name)
    const window = windowOf(player)
    const lines: LocalisedString[] = [["automaton-gui.refresh-deleted", deleted.length > 0 ? deleted.join(", ") : "—"]]
    if (kept.length > 0) lines.push(["automaton-gui.refresh-kept", kept.join(", ")])
    for (const line of lines) player.print(line)
    if (window === undefined) return
    window.errors.clear()
    for (const line of lines) note(window, line, line === lines[0] ? { r: 0.5, g: 1, b: 0.5 } : { r: 1, g: 0.75, b: 0.3 })
    // Удалённая могла быть открыта в редакторе.
    if (window.programId !== undefined && storage.programs.byId[window.programId] === undefined) load(window, player, undefined)
    refreshList(window, player)
  })
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
    const { line, module } = element.tags as { line?: number; module?: string }
    if (window === undefined || line === undefined) return
    if (module !== undefined && module !== "") {
      // Строка в модуле — открыть его (если он есть в программах команды).
      const target = findProgram(module, player.force.name)
      if (target === undefined) return
      load(window, player, target.id)
      refreshList(window, player)
    }
    editAt(window, line, true)
  })
  onGuiClick("programs-view-line", (player, element) => {
    const { line } = element.tags as { line?: number }
    if (line !== undefined) editViewLine(player, line)
  })
  onGuiClick("programs-view", (player) => checkFromWindow(player, true))
  onGuiClick("programs-check", (player) => checkFromWindow(player, false))
  onGuiClick("programs-edit", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    setMode(window, "edit")
    window.code.focus()
  })
  onGuiChange("programs-search", (player) => {
    const window = windowOf(player)
    if (window !== undefined) refreshList(window, player)
  })
  onGuiSelection("programs-select", (player, element) => {
    const window = windowOf(player)
    const selected = (element as ListBoxGuiElement).selected_index
    if (window === undefined || selected === 0) return
    const entry = window.entries[selected - 1]
    if (entry === undefined) return
    if ("folder" in entry) {
      // Папка: свернуть или развернуть, выбранной остаётся программа.
      window.collapsed[entry.folder] = window.collapsed[entry.folder] ? undefined : true
      refreshList(window, player)
      return
    }
    load(window, player, entry.id)
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
    setMode(window, "view")
    window.pane.scroll_to_top()
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
    const program = storage.programs.byId[window.programId]
    const deleted = deleteProgram(window.programId)
    if (!deleted.ok) {
      window.errors.clear()
      const label = window.errors.add({ type: "label", caption: ["automaton-gui.library-in-use", program?.name ?? "", deleted.usedBy.join(", ")] })
      label.style.single_line = false
      label.style.maximal_width = 900
      label.style.font_color = { r: 1, g: 0.45, b: 0.4 }
      return
    }
    drafts()[player.index] = undefined
    load(window, player, undefined)
    refreshList(window, player)
  })
  onGuiClick("programs-publish", (player) => publishFromWindow(player))
  onGuiClick("programs-types", (player) => showTypes(player))
  onGuiClick("programs-vscode", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    const dir = writeVsCodeFolder(player)
    window.errors.clear()
    const label = window.errors.add({ type: "label", caption: ["automaton-gui.vscode-folder-written", dir] })
    label.style.single_line = false
    label.style.maximal_width = 900
    label.style.font_color = { r: 0.5, g: 1, b: 0.5 }
  })
}

/**
 * Проверка без публикации (18.1): «Проверить» и переход в «Просмотр». Ошибки — как после публикации, в своих
 * строках просмотра; нет ошибок — по кнопке сообщение «Ошибок нет», при переходе в просмотр — молча.
 */
export function checkFromWindow(player: LuaPlayer, toView: boolean): void {
  const window = windowOf(player)
  if (window === undefined) return
  const diagnostics = checkProgram(window.name.text, window.code.text, player.force.name)
  if (diagnostics.length > 0) {
    showErrors(window, diagnostics)
    if (toView && window.mode !== "view") setMode(window, "view")
    return
  }
  window.errorLines = {}
  window.errors.clear()
  layoutLines(window, true)
  if (toView || window.mode === "view") setMode(window, "view")
  if (!toView) note(window, ["automaton-gui.check-ok"], { r: 0.5, g: 1, b: 0.5 })
}

/** Клик по строке просмотра: правка с курсором в конце строки (строка с ошибкой — выделена). */
export function editViewLine(player: LuaPlayer, line: number): void {
  const window = windowOf(player)
  if (window !== undefined) editAt(window, line, window.errorLines[line] !== undefined)
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
  if ((result.rebuilt ?? []).length > 0) {
    const label = window.errors.add({ type: "label", caption: ["automaton-gui.rebuilt", result.rebuilt!.join(", ")] })
    label.style.font_color = { r: 0.5, g: 1, b: 0.5 }
    label.style.single_line = false
    label.style.maximal_width = 900
  }
  if ((result.stale ?? []).length > 0) {
    const label = window.errors.add({ type: "label", caption: ["automaton-gui.stale-list", result.stale!.join(", ")] })
    label.style.font_color = { r: 1, g: 0.75, b: 0.3 }
    label.style.single_line = false
    label.style.maximal_width = 900
  }
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
