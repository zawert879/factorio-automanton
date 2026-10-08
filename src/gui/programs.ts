// Окно «Программы команды» (5.2, 5.4, 5.5): библиотека программ команды и редактор.
// Публикация = компиляция: с ошибками программа не публикуется, ошибки — со строкой и текстом.
// Изменение опубликованной программы перезапускает машины с ней (src/program/machines.ts).
import {
  ButtonGuiElement,
  DropDownGuiElement,
  FlowGuiElement,
  FrameGuiElement,
  ListBoxGuiElement,
  LocalisedString,
  LuaGuiElement,
  LuaPlayer,
  TextBoxGuiElement,
  TextFieldGuiElement,
} from "factorio:runtime"
import { Diagnostic } from "../lang/lexer"
import { assignProgram } from "../program/machines"
import { deleteProgram, notePublish, programsOf, publish, publishDenied } from "../program/store"
import { guiOf, onGuiClick, onGuiSelection, titlebar } from "./common"
import { DTS } from "./dts.generated"

const FRAME = "automaton-programs"
const TYPES_FRAME = "automaton-types"
const MAX_ERRORS = 8

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
  code: TextBoxGuiElement
  errors: FlowGuiElement
  versions: DropDownGuiElement
  assign: ButtonGuiElement
  /** Редактируемая программа (undefined — новая, ещё не опубликованная). */
  programId?: number
  /** Машина, из окна которой открыли библиотеку (кнопка «Назначить»). */
  robotId?: number
}

function button(parent: LuaGuiElement, caption: LocalisedString, action: string, style = "button"): ButtonGuiElement {
  return parent.add({ type: "button", caption, tags: { action }, style })
}

export function openPrograms(player: LuaPlayer, programId?: number, robotId?: number): void {
  closePrograms(player)
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-gui.programs-title"], "programs-close")
  const body = frame.add({ type: "flow", direction: "horizontal" })
  body.style.horizontal_spacing = 12

  const left = body.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const list = left.add({ type: "list-box", items: [], tags: { action: "programs-select" } })
  list.style.width = 220
  list.style.height = 520
  const leftButtons = left.add({ type: "flow", direction: "horizontal" })
  button(leftButtons, ["automaton-gui.new-program"], "programs-new")
  button(leftButtons, ["automaton-gui.copy-program"], "programs-copy")
  button(leftButtons, ["automaton-gui.delete-program"], "programs-delete", "red_button")

  const right = body.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const header = right.add({ type: "flow", direction: "horizontal" })
  header.style.vertical_align = "center"
  header.add({ type: "label", caption: ["automaton-gui.program-name"], style: "bold_label" })
  const name = header.add({ type: "textfield", text: "" })
  name.style.width = 300
  const info = header.add({ type: "label", caption: "" })
  const code = right.add({ type: "text-box", text: "", style: "automaton_code" })
  code.word_wrap = false
  const errors = right.add({ type: "flow", direction: "vertical" })
  const buttons = right.add({ type: "flow", direction: "horizontal" })
  button(buttons, ["automaton-gui.publish"], "programs-publish", "green_button")
  const assign = button(buttons, "", "programs-assign")
  const versions = buttons.add({ type: "drop-down", items: [], tags: { action: "programs-version" } })
  versions.style.width = 200
  button(buttons, ["automaton-gui.types"], "programs-types")

  player.opened = frame
  const window: ProgramsWindow = { frame, list, listIds: [], name, info, code, errors, versions, assign, robotId }
  guiOf(player).programs = window
  refreshList(window, player)
  load(window, programId)
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

/** Показать программу в редакторе (или новую по шаблону). */
function load(window: ProgramsWindow, programId: number | undefined, source?: string, name?: string): void {
  const program = programId === undefined ? undefined : storage.programs.byId[programId]
  window.programId = program?.id
  window.name.text = name ?? program?.name ?? ""
  window.code.text = source ?? program?.source ?? TEMPLATE
  window.info.caption = program === undefined ? ["automaton-gui.draft"] : ["automaton-gui.program-info", program.version, program.author ?? "—"]
  window.errors.clear()
  if (program?.quarantined) window.errors.add({ type: "label", caption: ["automaton-gui.quarantined"] }).style.font_color = { r: 1, g: 0.6, b: 0.2 }
  window.versions.items = program === undefined ? [] : program.history.map((v) => `v${v.version} — ${v.author ?? "—"}`)
  window.versions.selected_index = program === undefined ? 0 : program.history.length
  const robot = window.robotId === undefined ? undefined : storage.robots.byId[window.robotId]
  window.assign.visible = robot !== undefined && program !== undefined
  window.assign.caption = ["automaton-gui.assign", robot?.name ?? ""]
}

/** Ошибка компиляции понятным текстом: «строка:столбец текст». */
export function diagnosticText(d: Diagnostic): LocalisedString {
  const params: LocalisedString[] = d.params.map((p, i) =>
    d.code === "unsupported" && i === 0 ? [`automaton-feature.${p}`] : tostring(p),
  )
  return ["", `${d.line}:${d.column}  `, [`automaton-diagnostic.${d.code}`, ...params]]
}

function showErrors(window: ProgramsWindow, diagnostics: Diagnostic[]): void {
  window.errors.clear()
  for (const d of diagnostics.slice(0, MAX_ERRORS)) {
    const line = window.errors.add({ type: "label", caption: diagnosticText(d) })
    line.style.font_color = { r: 1, g: 0.45, b: 0.4 }
  }
  if (diagnostics.length > MAX_ERRORS) window.errors.add({ type: "label", caption: ["automaton-gui.more-errors", diagnostics.length - MAX_ERRORS] })
}

export function showTypes(player: LuaPlayer): void {
  player.gui.screen[TYPES_FRAME]?.destroy()
  const frame = player.gui.screen.add({ type: "frame", name: TYPES_FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-gui.types-title"], "types-close")
  const help = frame.add({ type: "label", caption: ["automaton-gui.types-help"] })
  help.style.single_line = false
  help.style.maximal_width = 760
  const text = frame.add({ type: "text-box", text: DTS, style: "automaton_code" })
  text.read_only = true
  text.word_wrap = false
  text.focus()
  text.select_all()
}

export function registerProgramsWindow(): void {
  registerAssign()
  onGuiClick("programs-close", (player) => closePrograms(player))
  onGuiClick("types-close", (player) => player.gui.screen[TYPES_FRAME]?.destroy())

  onGuiSelection("programs-select", (player, element) => {
    const window = windowOf(player)
    const selected = (element as ListBoxGuiElement).selected_index
    if (window === undefined || selected === 0) return
    load(window, window.listIds[selected - 1])
  })
  onGuiSelection("programs-version", (player, element) => {
    const window = windowOf(player)
    const program = window?.programId === undefined ? undefined : storage.programs.byId[window.programId]
    const selected = (element as DropDownGuiElement).selected_index
    if (window === undefined || program === undefined || selected === 0) return
    const version = program.history[selected - 1]
    if (version !== undefined) window.code.text = version.source
  })
  onGuiClick("programs-new", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    load(window, undefined, TEMPLATE, "")
    window.list.selected_index = 0
    window.name.focus()
  })
  onGuiClick("programs-copy", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    const name = window.name.text
    const source = window.code.text
    load(window, undefined, source, name === "" ? "" : `${name} (копия)`)
    window.list.selected_index = 0
  })
  onGuiClick("programs-delete", (player) => {
    const window = windowOf(player)
    if (window === undefined || window.programId === undefined) return
    deleteProgram(window.programId)
    load(window, undefined)
    refreshList(window, player)
  })
  onGuiClick("programs-publish", (player) => publishFromWindow(player))
  onGuiClick("programs-types", (player) => showTypes(player))
}

/** Кнопка «Опубликовать»: права, компиляция, ошибки или новая версия. */
export function publishFromWindow(player: LuaPlayer): void {
  {
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
    load(window, result.program.id)
    refreshList(window, player)
    window.errors.add({ type: "label", caption: ["automaton-gui.published", result.program.version] }).style.font_color = { r: 0.5, g: 1, b: 0.5 }
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
