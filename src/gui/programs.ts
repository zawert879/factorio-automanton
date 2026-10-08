// Окно «Программы команды» (5.2, 5.4, 5.5, 5.9): библиотека программ команды и редактор.
// Публикация = компиляция: с ошибками программа не публикуется, ошибки — со строкой и текстом.
// Изменение опубликованной программы перезапускает машины с ней (src/program/machines.ts).
//
// Редактор: поле кода растягивается на весь текст внутри общей прокрутки, слева — номера строк
// (такое же поле, только для чтения, — строки совпадают), справа — невидимые метки строк, к которым
// прокручивает клик по ошибке. Черновик у каждого игрока: закрыл окно — текст не пропал.
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
import { deleteProgram, dependentsOf, findProgram, notePublish, ProgramRecord, programsOf, publish, publishDenied } from "../program/store"
import { writeVsCodeFolder } from "../program/sync"
import { guiOf, onGuiChange, onGuiClick, onGuiSelection, titlebar } from "./common"
import { DTS } from "./dts.generated"
import { folderItem, LIBRARY_COLOR, programTree, TreeEntry } from "./tree"

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
  search: TextFieldGuiElement
  list: ListBoxGuiElement
  entries: TreeEntry[]
  /** Свёрнутые папки (полный путь). */
  collapsed: Record<string, boolean | undefined>
  name: TextFieldGuiElement
  info: LuaGuiElement
  pane: ScrollPaneGuiElement
  numbers: TextBoxGuiElement
  code: TextBoxGuiElement
  marks: FlowGuiElement
  /** Под именем: кто импортирует, отставшая сборка. */
  notes: FlowGuiElement
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

  const errors = right.add({ type: "flow", direction: "vertical" })
  const buttons = right.add({ type: "flow", direction: "horizontal" })
  button(buttons, ["automaton-gui.publish"], "programs-publish", "green_button")
  const assign = button(buttons, "", "programs-assign")
  const versions = buttons.add({ type: "drop-down", items: [], tags: { action: "programs-version" } })
  versions.style.width = 200
  button(buttons, ["automaton-gui.types"], "programs-types")
  button(buttons, ["automaton-gui.vscode-folder"], "programs-vscode")

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
    numbers,
    code,
    marks,
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
  window.pane.scroll_to_top()
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
  const params: LocalisedString[] = d.params.map((p, i) => (d.code === "unsupported" && i === 0 ? [`automaton-feature.${p}`] : tostring(p)))
  return ["", `${d.module !== undefined ? `${d.module}:` : ""}${d.line}:${d.column}  `, [`automaton-diagnostic.${d.code}`, ...params]]
}

function showErrors(window: ProgramsWindow, diagnostics: Diagnostic[]): void {
  window.errors.clear()
  window.errorLines = {}
  for (const d of diagnostics.slice(0, MAX_ERRORS)) {
    // Ошибка в другом модуле: клик откроет его.
    if (d.line > 0 && d.module === undefined) window.errorLines[d.line] = true
    const line = window.errors.add({ type: "label", caption: diagnosticText(d), tags: { action: "programs-goto", line: d.line, module: d.module ?? "" } })
    line.style.font_color = { r: 1, g: 0.45, b: 0.4 }
    line.tooltip = ["automaton-gui.goto-line"]
  }
  if (diagnostics.length > MAX_ERRORS) window.errors.add({ type: "label", caption: ["automaton-gui.more-errors", diagnostics.length - MAX_ERRORS] })
  layoutLines(window, true)
  if (diagnostics[0] !== undefined && diagnostics[0].line > 0 && diagnostics[0].module === undefined) goToLine(window, diagnostics[0].line)
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
    const { line, module } = element.tags as { line?: number; module?: string }
    if (window === undefined || line === undefined) return
    if (module !== undefined && module !== "") {
      // Строка в модуле — открыть его (если он есть в программах команды).
      const target = findProgram(module, player.force.name)
      if (target === undefined) return
      load(window, player, target.id)
      refreshList(window, player)
    }
    goToLine(window, line)
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
