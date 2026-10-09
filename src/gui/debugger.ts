// Окно «Отладка» машины (18.8; решения — DESIGN.md, «Отладка»): из окна машины. Слева — код её программы в цвете
// (модули — выбором), клик по номеру строки ставит или снимает точку остановки (только у этой машины), текущая строка
// отмечена «▶», строки, где остановиться нельзя (короткие функции, объявления), — серые. Справа — состояние,
// «Продолжить / Шаг / Пауза», переменные верхнего уровня программы и модулей, me.memory и параметры.
import { DropDownGuiElement, FrameGuiElement, LocalisedString, LuaGuiElement, LuaPlayer, TableGuiElement } from "factorio:runtime"
import { RobotRecord } from "../automaton/registry"
import { onTick } from "../events"
import { highlight, richLine } from "../lang/highlight"
import { LINE_BASE } from "../lang/modules"
import { pausedLine } from "../lang/runtime"
import { Val } from "../lang/runtime/core"
import { formatValue } from "../program/api/output"
import { MachineRecord, machineOf, wake } from "../program/machines"
import { stepMachine } from "../program/scheduler"
import { findProgram, loadedProgram, ProgramRecord, rebuildProgram } from "../program/store"
import { PALETTE } from "./codeView"
import { guiOf, onGuiClick, onGuiSelection, titlebar } from "./common"
import { diagnosticText } from "./diagnostics"

const FRAME = "automaton-debug"
const CODE_WIDTH = 560
const HEIGHT = 520
const REFRESH_TICKS = 15
/** Длина значения переменной в окне. */
const MAX_VALUE = 160

export interface DebugWindow {
  frame: FrameGuiElement
  robotId: number
  /** Показанный модуль (номер в кодировке строк) и сборка, по которой нарисован код. */
  module: number
  version: number
  modules: DropDownGuiElement
  code: TableGuiElement
  status: LuaGuiElement
  vars: LuaGuiElement
  note: LuaGuiElement
  /** Строка остановки, по которой выбран модуль (сменилась — показать её модуль). */
  lastStop?: number
}

function windowOf(player: LuaPlayer): DebugWindow | undefined {
  const window = guiOf(player).debug
  return window !== undefined && window.frame.valid ? window : undefined
}

function programOf(record: MachineRecord): ProgramRecord | undefined {
  return record.programId === undefined ? undefined : storage.programs.byId[record.programId]
}

/** Строка, на которой стоит машина: точка или шаг, иначе — последняя пауза кванта. */
function currentLine(record: MachineRecord, program: ProgramRecord | undefined): number | undefined {
  if (record.stopLine !== undefined) return record.stopLine
  if (program === undefined) return undefined
  const loaded = loadedProgram(program)
  return typeof loaded === "string" ? undefined : pausedLine(loaded, record.machine)
}

export function closeDebugger(player: LuaPlayer): void {
  player.gui.screen[FRAME]?.destroy()
  guiOf(player).debug = undefined
}

export function openDebugger(player: LuaPlayer, robot: RobotRecord): void {
  player.gui.screen[FRAME]?.destroy()
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-debug.title", robot.name], "debug-close")
  const body = frame.add({ type: "flow", direction: "horizontal" })
  body.style.horizontal_spacing = 12
  const left = body.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const modules = left.add({ type: "drop-down", items: [], tags: { action: "debug-module" } })
  modules.style.width = 300
  const pane = left.add({ type: "scroll-pane", horizontal_scroll_policy: "auto", vertical_scroll_policy: "auto" })
  pane.style.width = CODE_WIDTH
  pane.style.height = HEIGHT
  const view = pane.add({ type: "frame", style: "automaton_code_view", direction: "vertical" })
  view.style.minimal_width = CODE_WIDTH - 24
  const code = view.add({ type: "table", column_count: 2 })
  code.style.horizontal_spacing = 0
  code.style.vertical_spacing = 0
  const right = body.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  right.style.width = 380
  const status = right.add({ type: "label", caption: "" })
  status.style.single_line = false
  status.style.maximal_width = 350
  const buttons = right.add({ type: "flow", direction: "horizontal" })
  buttons.add({ type: "button", caption: ["automaton-debug.continue"], style: "green_button", tags: { action: "debug-continue" } })
  buttons.add({ type: "button", caption: ["automaton-debug.step"], tags: { action: "debug-step" }, tooltip: ["automaton-debug.step-tooltip"] })
  buttons.add({ type: "button", caption: ["automaton-debug.pause"], tags: { action: "debug-pause" } })
  const clear = right.add({ type: "button", caption: ["automaton-debug.clear"], tags: { action: "debug-clear" } })
  clear.style.minimal_width = 0
  const note = right.add({ type: "flow", direction: "vertical" })
  const varsPane = right.add({ type: "scroll-pane", horizontal_scroll_policy: "never", vertical_scroll_policy: "auto" })
  varsPane.style.maximal_height = HEIGHT - 120
  const vars = varsPane.add({ type: "flow", direction: "vertical" })
  const window: DebugWindow = { frame, robotId: robot.id, module: 0, version: -1, modules, code, status, vars, note }
  guiOf(player).debug = window
  refreshDebugger(window)
}

/** Номер строки: точка «●», текущая «▶», где остановиться нельзя — серый. */
function numberCaption(line: number, encoded: number, record: MachineRecord, current: number | undefined): string {
  const marks = `${record.breakpoints?.[encoded] ? "[color=#d0201a]●[/color]" : " "}${current === encoded ? "[color=#e8901a]▶[/color]" : " "}`
  return `${marks}${line}`
}

/** Код показанного модуля: строка — номер (клик — точка) и текст в цвете. */
function renderCode(window: DebugWindow, program: ProgramRecord, record: MachineRecord, current: number | undefined): void {
  const name = program.modules[window.module] ?? program.name
  const source = window.module === 0 ? program.source : findProgram(name, program.force)?.source ?? ""
  const breakable: Record<number, boolean | undefined> = {}
  for (const l of program.breakable ?? []) breakable[l] = true
  window.code.clear()
  highlight(source).forEach((segments, i) => {
    const line = i + 1
    const encoded = window.module * LINE_BASE + line
    const number = window.code.add({ type: "label", caption: numberCaption(line, encoded, record, current), style: "automaton_code_number", tags: { action: "debug-toggle", line: encoded } })
    if (!breakable[encoded]) number.style.font_color = { r: 0.75, g: 0.7, b: 0.6 }
    number.tooltip = breakable[encoded] ? ["automaton-debug.toggle-tooltip"] : ["automaton-debug.not-breakable"]
    window.code.add({ type: "label", caption: richLine(segments, PALETTE), style: "automaton_code_line" })
  })
}

/** Значение для окна: как print, но строка — в кавычках (отличить "6" от 6); длинное — с «…». */
function shown(value: Val): string {
  const text = type(value) === "string" ? `"${value}"` : formatValue(value)
  return text.length > MAX_VALUE ? `${string.sub(text, 1, MAX_VALUE)}…` : text
}

/** Значение переменной из кадра главной функции (ячейка — [1]). */
function variableValue(frame: Val, slot: number, cell?: boolean): string {
  if (type(frame) !== "table") return "—"
  const raw = frame[slot]
  return shown(cell && type(raw) === "table" ? raw[1] : raw)
}

function addVar(parent: LuaGuiElement, name: string, value: string): void {
  const label = parent.add({ type: "label", caption: `[font=default-semibold]${name}[/font] = ${value}` })
  label.style.single_line = false
  label.style.maximal_width = 340
}

function refreshVariables(window: DebugWindow, program: ProgramRecord | undefined, record: MachineRecord): void {
  window.vars.clear()
  if (program?.variables !== undefined) {
    let module = -1
    for (const v of program.variables) {
      if (v.module !== module) {
        module = v.module
        window.vars.add({ type: "label", caption: module === 0 ? ["automaton-debug.program-vars"] : (program.modules[module] ?? "?"), style: "caption_label" })
      }
      addVar(window.vars, v.name, variableValue(record.machine.frame, v.slot, v.cell))
    }
  }
  window.vars.add({ type: "label", caption: "me.memory", style: "caption_label" })
  let any = false
  for (const [key, value] of pairs(record.memory ?? {})) {
    addVar(window.vars, tostring(key), shown(value))
    any = true
  }
  if (!any) window.vars.add({ type: "label", caption: "—" })
  window.vars.add({ type: "label", caption: ["automaton-debug.args"], style: "caption_label" })
  window.vars.add({ type: "label", caption: formatValue(record.args) }).style.single_line = false
}

function statusOf(record: MachineRecord, program: ProgramRecord | undefined, current: number | undefined): LocalisedString {
  if (program === undefined) return ["automaton-gui.status-no-program"]
  const where = current === undefined ? "—" : current >= LINE_BASE ? `${program.modules[math.floor(current / LINE_BASE)] ?? "?"}:${current % LINE_BASE}` : `${current}`
  const status = record.machine.status
  if (status === "error") return ["automaton-debug.status-error", record.machine.error?.message ?? ""]
  if (status === "done") return ["automaton-gui.status-done"]
  if (record.paused) return [record.stopLine !== undefined ? "automaton-debug.status-stopped" : "automaton-debug.status-paused", where]
  return status === "waiting" ? ["automaton-debug.status-waiting", where] : ["automaton-debug.status-running"]
}

export function refreshDebugger(window: DebugWindow): void {
  const robot = storage.robots.byId[window.robotId]
  if (robot === undefined || !robot.entity.valid) return
  const record = machineOf(robot.id)
  const program = programOf(record)
  const current = currentLine(record, program)
  // Остановилась в другом модуле — показать его.
  if (record.stopLine !== undefined && record.stopLine !== window.lastStop) {
    window.lastStop = record.stopLine
    window.module = math.floor(record.stopLine / LINE_BASE)
    window.version = -1
  }
  window.note.clear()
  if (program === undefined) {
    window.code.clear()
    window.modules.items = []
  } else {
    if (program.breakable === undefined) {
      const label = window.note.add({ type: "label", caption: ["automaton-debug.old-build"] })
      label.style.single_line = false
      label.style.maximal_width = 350
      label.style.font_color = { r: 1, g: 0.75, b: 0.3 }
      window.note.add({ type: "button", caption: ["automaton-debug.rebuild"], tags: { action: "debug-rebuild" } })
    }
    window.modules.items = program.modules.map((m, i) => (i === 0 ? ["automaton-debug.module-main", m] : m) as LocalisedString)
    window.modules.selected_index = window.module + 1
    window.modules.visible = program.modules.length > 1
    if (window.version !== program.version) {
      window.version = program.version
      renderCode(window, program, record, current)
    } else {
      // Только номера строк (точки и текущая строка): код не перерисовывается.
      const cells = window.code.children
      for (let i = 0; i < cells.length; i += 2) {
        const encoded = (cells[i].tags as { line: number }).line
        cells[i].caption = numberCaption(encoded % LINE_BASE, encoded, record, current)
      }
    }
  }
  window.status.caption = statusOf(record, program, current)
  refreshVariables(window, program, record)
}

export function registerDebugger(): void {
  const withWindow = (player: LuaPlayer, fn: (window: DebugWindow, record: MachineRecord) => void) => {
    const window = windowOf(player)
    const robot = window === undefined ? undefined : storage.robots.byId[window.robotId]
    if (window === undefined || robot === undefined || !robot.entity.valid) return
    fn(window, machineOf(robot.id))
    refreshDebugger(window)
  }
  onGuiClick("debug-close", (player) => closeDebugger(player))
  onGuiClick("debug-toggle", (player, element) => {
    withWindow(player, (_, record) => {
      const line = (element.tags as { line: number }).line
      const program = programOf(record)
      if (program?.breakable !== undefined && !program.breakable.includes(line)) return
      record.breakpoints ??= {}
      record.breakpoints[line] = record.breakpoints[line] ? undefined : true
      if (next(record.breakpoints)[0] === undefined) record.breakpoints = undefined
    })
  })
  onGuiClick("debug-continue", (player) => {
    withWindow(player, (_, record) => {
      record.paused = undefined
      record.stopLine = undefined
      wake(record.robotId)
    })
  })
  onGuiClick("debug-step", (player) => {
    withWindow(player, (_, record) => {
      record.paused = true
      stepMachine(record)
    })
  })
  onGuiClick("debug-pause", (player) => withWindow(player, (_, record) => (record.paused = true)))
  onGuiClick("debug-clear", (player) => withWindow(player, (_, record) => (record.breakpoints = undefined)))
  onGuiClick("debug-rebuild", (player) => {
    withWindow(player, (window, record) => {
      const program = programOf(record)
      if (program === undefined) return
      const errors = rebuildProgram(program, player.name)
      for (const d of errors.slice(0, 3)) player.print(["", ["automaton-debug.rebuild-failed", program.name], " ", diagnosticText(d)])
      window.version = -1
    })
  })
  onGuiSelection("debug-module", (player, element) => {
    const window = windowOf(player)
    if (window === undefined) return
    window.module = (element as DropDownGuiElement).selected_index - 1
    window.version = -1
    refreshDebugger(window)
  })
  onTick((tick) => {
    if (tick % REFRESH_TICKS !== 0) return
    for (const player of game.connected_players) {
      const window = windowOf(player)
      if (window !== undefined) refreshDebugger(window)
    }
  })
}
