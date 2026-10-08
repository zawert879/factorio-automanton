// Окно машины (5.1–5.3, 5.7): открывается кликом по машине. Программа и управление (запуск, стоп, пауза,
// шаг), состояние и текущая строка, ошибка, консоль, груз и топливо, настройки: имя, дом, параметры (args).
// Программа выбирается в окне выбора (src/gui/picker.ts): кнопка с её именем.
import { trim } from "../lang/runtime/strings"
import { formatLine } from "../lang/modules"
import {
  ButtonGuiElement,
  FlowGuiElement,
  FrameGuiElement,
  LabelGuiElement,
  LuaGuiElement,
  LuaPlayer,
  PlayerIndex,
  ProgressBarGuiElement,
  ScrollPaneGuiElement,
  TableGuiElement,
  TextBoxGuiElement,
  TextFieldGuiElement,
} from "factorio:runtime"
import { fuelValue } from "../automaton/energy"
import { tankCapacity, tankOf } from "../automaton/tank"
import { RobotRecord } from "../automaton/registry"
import { onEvent, onTick } from "../events"
import { pausedLine } from "../lang/runtime"
import { lib } from "../lang/runtime/library"
import { modelOf } from "../names"
import { robotState } from "../program/handles"
import { machineOf, restartMachine, stopMachine, wake } from "../program/machines"
import { stepMachine } from "../program/scheduler"
import { loadedProgram } from "../program/store"
import { formatValue } from "../program/api/output"
import { guiOf, titlebar, onGuiClick, onGuiConfirm } from "./common"
import { closePicker, onProgramPicked, openPicker } from "./picker"
import { closePrograms, openPrograms } from "./programs"

const FRAME = "automaton-machine"
const CONSOLE_SHOWN = 40
const REFRESH_TICKS = 30
/** Полный бак — для полоски топлива (как me.fuel). */
const FULL_TANK_JOULES = 50 * 4_000_000

export interface MachineWindow {
  robotId: number
  frame: FrameGuiElement
  title: LuaGuiElement
  program: ButtonGuiElement
  pause: ButtonGuiElement
  state: LabelGuiElement
  line: LabelGuiElement
  version: LabelGuiElement
  error: LabelGuiElement
  console: FlowGuiElement
  scroll: ScrollPaneGuiElement
  consoleSize: number
  cargo: TableGuiElement
  fuel: ProgressBarGuiElement
  tank: ProgressBarGuiElement
  name: TextFieldGuiElement
  home: LabelGuiElement
  args: TextBoxGuiElement
  argsError: LabelGuiElement
}


function button(parent: LuaGuiElement, caption: string, action: string, style = "button"): ButtonGuiElement {
  return parent.add({ type: "button", caption: [`automaton-gui.${caption}`], tags: { action }, style })
}

function label(parent: LuaGuiElement, caption: string): void {
  parent.add({ type: "label", caption: [`automaton-gui.${caption}`], style: "bold_label" })
}

export function openMachine(player: LuaPlayer, robot: RobotRecord): void {
  closeMachine(player)
  const record = machineOf(robot.id)
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical" })
  frame.auto_center = true
  const title = titlebar(frame, robot.name, "machine-close")
  const body = frame.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })

  // Программа и управление.
  const programRow = body.add({ type: "flow", direction: "horizontal" })
  programRow.style.vertical_align = "center"
  label(programRow, "program")
  const program = programRow.add({ type: "button", caption: "", tags: { action: "machine-pick" }, tooltip: ["automaton-gui.pick-tooltip"] })
  program.style.minimal_width = 240
  program.style.horizontal_align = "left"
  button(programRow, "library", "machine-library")
  const controls = body.add({ type: "flow", direction: "horizontal" })
  button(controls, "run", "machine-run", "green_button")
  button(controls, "stop", "machine-stop", "red_button")
  const pause = button(controls, record.paused ? "resume" : "pause", "machine-pause")
  button(controls, "step", "machine-step")

  const status = body.add({ type: "table", column_count: 2 })
  status.style.horizontal_spacing = 12
  label(status, "state")
  const state = status.add({ type: "label", caption: "" })
  label(status, "line")
  const line = status.add({ type: "label", caption: "" })
  label(status, "version")
  const version = status.add({ type: "label", caption: "" })
  const errorLabel = body.add({ type: "label", caption: "" })
  errorLabel.style.font_color = { r: 1, g: 0.45, b: 0.4 }
  errorLabel.style.single_line = false
  errorLabel.style.maximal_width = 560

  label(body, "console")
  const scroll = body.add({ type: "scroll-pane", vertical_scroll_policy: "always" })
  scroll.style.width = 580
  scroll.style.height = 220
  const consoleLines = scroll.add({ type: "flow", direction: "vertical" })

  // Груз и топливо.
  const cargoRow = body.add({ type: "flow", direction: "horizontal" })
  cargoRow.style.vertical_align = "center"
  label(cargoRow, "cargo")
  const cargo = cargoRow.add({ type: "table", column_count: 10 })
  label(cargoRow, "fuel")
  const fuel = cargoRow.add({ type: "progressbar", value: 0 })
  fuel.style.width = 100
  label(cargoRow, "tank")
  const tank = cargoRow.add({ type: "progressbar", value: 0 })
  tank.style.width = 100

  // Настройки машины.
  const settings = body.add({ type: "table", column_count: 2 })
  settings.style.vertical_spacing = 6
  label(settings, "name")
  const name = settings.add({ type: "textfield", text: robot.name, tags: { action: "machine-name" } })
  label(settings, "home")
  const homeRow = settings.add({ type: "flow", direction: "horizontal" })
  homeRow.style.vertical_align = "center"
  const home = homeRow.add({ type: "label", caption: "" })
  button(homeRow, "home-here", "machine-home")
  button(homeRow, "home-clear", "machine-home-clear")
  label(settings, "args")
  const argsFlow = settings.add({ type: "flow", direction: "vertical" })
  const args = argsFlow.add({ type: "text-box", text: argsText(record.args), style: "automaton_json" })
  const argsRow = argsFlow.add({ type: "flow", direction: "horizontal" })
  button(argsRow, "args-apply", "machine-args")
  const argsError = argsRow.add({ type: "label", caption: "" })
  argsError.style.font_color = { r: 1, g: 0.45, b: 0.4 }

  player.opened = frame
  const window: MachineWindow = {
    robotId: robot.id,
    frame,
    title,
    program,
    pause,
    state,
    line,
    version,
    error: errorLabel,
    console: consoleLines,
    scroll,
    consoleSize: -1,
    cargo,
    fuel,
    tank,
    name,
    home,
    args,
    argsError,
  }
  guiOf(player).machine = window
  fillPrograms(window, robot)
  refreshMachine(window)
}

function argsText(args: unknown): string {
  const [ok, json] = pcall(lib.JSON.stringify, args, undefined, 2)
  return ok && json !== undefined ? (json as string) : "{}"
}

/** Кнопка программы: её имя (клик открывает окно выбора). */
function fillPrograms(window: MachineWindow, robot: RobotRecord): void {
  const current = machineOf(robot.id).programId
  const program = current === undefined ? undefined : storage.programs.byId[current]
  window.program.caption = program === undefined ? ["", ["automaton-gui.no-program"], "  ▾"] : `${program.name}  ▾`
}

export function closeMachine(player: LuaPlayer): void {
  const state = guiOf(player)
  if (state.machine?.frame.valid) state.machine.frame.destroy()
  state.machine = undefined
}

function windowRobot(player: LuaPlayer): { window: MachineWindow; robot: RobotRecord } | undefined {
  const window = guiOf(player).machine
  if (window === undefined || !window.frame.valid) return undefined
  const robot = storage.robots.byId[window.robotId]
  if (robot === undefined || !robot.entity.valid) {
    closeMachine(player)
    return undefined
  }
  return { window, robot }
}

const STATUS_CAPTIONS: Record<string, string> = { ready: "running", waiting: "waiting", done: "done", error: "error" }

export function refreshMachine(window: MachineWindow): void {
  const robot = storage.robots.byId[window.robotId]
  if (robot === undefined || !robot.entity.valid) return
  const record = machineOf(robot.id)
  const program = record.programId === undefined ? undefined : storage.programs.byId[record.programId]
  window.title.caption = robot.name
  const status = program === undefined ? "no-program" : record.paused && record.machine.status === "ready" ? "paused" : STATUS_CAPTIONS[record.machine.status]
  // Ждёт — чего именно (поездки, добычи, времени…); работает — чем занята машина.
  const waitingFor = record.machine.status === "waiting" ? record.machine.waiting?.__host : undefined
  window.state.caption = [
    `automaton-gui.status-${status}`,
    waitingFor !== undefined ? [`automaton-gui.wait-${waitingFor}`] : [`automaton-gui.robot-${robotState(robot)}`],
  ]
  const loaded = program !== undefined ? loadedProgram(program) : undefined
  const line = loaded !== undefined && typeof loaded !== "string" ? pausedLine(loaded, record.machine) : undefined
  window.line.caption = line === undefined ? "—" : formatLine(line, program?.modules)
  window.version.caption =
    program === undefined ? "—" : record.version === program.version ? `v${program.version}` : ["automaton-gui.old-version", record.version, program.version]
  const e = record.machine.status === "error" ? record.machine.error : undefined
  window.error.caption = e === undefined ? "" : `${e.line !== undefined ? `${formatLine(e.line, program?.modules)}: ` : ""}${e.name}: ${e.message}`
  window.error.visible = e !== undefined

  // Консоль — перерисовать, только если изменилась.
  const size = record.console.length + (record.console[record.console.length - 1]?.length ?? 0) * 1000
  if (size !== window.consoleSize) {
    window.consoleSize = size
    window.console.clear()
    const first = math.max(0, record.console.length - CONSOLE_SHOWN)
    for (let i = first; i < record.console.length; i++) {
      window.console.add({ type: "label", caption: record.console[i], style: "automaton_console_line" })
    }
    window.scroll.scroll_to_bottom()
  }

  window.cargo.clear()
  for (const content of robot.cargo.get_contents()) {
    window.cargo.add({ type: "sprite-button", sprite: `item/${content.name}`, number: content.count, style: "slot_button" })
  }
  const stack = robot.fuel[0]
  const stored = robot.energy + (stack.valid_for_read ? stack.count * fuelValue(stack.name) : 0)
  window.fuel.value = math.min(1, stored / FULL_TANK_JOULES)
  const tank = tankOf(robot)
  window.tank.value = math.min(1, tank.amount / tankCapacity(robot))
  window.tank.caption = tank.fluid === undefined ? "" : `${math.floor(tank.amount)}`
  window.tank.tooltip = tank.fluid === undefined ? ["automaton-gui.tank-empty"] : ["", prototypes.fluid[tank.fluid]?.localised_name ?? tank.fluid, `: ${math.floor(tank.amount)} / ${tankCapacity(robot)}, ${math.floor(tank.temperature)} °C`]
  window.home.caption = record.home === undefined ? ["automaton-gui.no-home"] : `${math.floor(record.home.x)}, ${math.floor(record.home.y)}`
  window.pause.caption = [record.paused ? "automaton-gui.resume" : "automaton-gui.pause"]
}

function refreshAll(): void {
  if (storage.gui === undefined) return
  for (const [index, state] of pairs(storage.gui)) {
    const window = state.machine
    if (window === undefined) continue
    if (!window.frame.valid) {
      state.machine = undefined
      continue
    }
    const player = game.get_player(index as PlayerIndex)
    if (player !== undefined) windowRobot(player)
    if (state.machine !== undefined) refreshMachine(state.machine)
  }
}

export function registerMachineWindow(): void {
  // Клик «открыть» по машине.
  script.on_event("automaton-open", (e) => {
    const player = game.get_player(e.player_index)
    const selected = player?.selected
    if (player === undefined || selected === undefined || modelOf(selected.name) === undefined) return
    const robot = storage.robots.byId[storage.robots.idByUnit[selected.unit_number!] ?? -1]
    if (robot !== undefined) openMachine(player, robot)
  })
  onEvent(defines.events.on_gui_closed, (e) => {
    if (!e.element?.valid) return
    const player = game.get_player(e.player_index)!
    if (e.element.name === FRAME) closeMachine(player)
    else if (e.element.name === "automaton-programs") closePrograms(player)
    else if (e.element.name === "automaton-picker") closePicker(player)
  })
  onTick((tick) => {
    if (tick % REFRESH_TICKS === 0) refreshAll()
  })

  onGuiClick("machine-close", (player) => closeMachine(player))
  onGuiClick("machine-pick", (player) => {
    const found = windowRobot(player)
    if (found !== undefined) openPicker(player, [found.robot.id])
  })
  onProgramPicked((player) => {
    const found = windowRobot(player)
    if (found === undefined) return
    fillPrograms(found.window, found.robot)
    refreshMachine(found.window)
  })
  onGuiClick("machine-library", (player) => {
    const found = windowRobot(player)
    const programId = found === undefined ? undefined : machineOf(found.robot.id).programId
    openPrograms(player, programId, found?.robot.id)
  })
  onGuiClick("machine-run", (player) => {
    const found = windowRobot(player)
    if (found === undefined) return
    const record = machineOf(found.robot.id)
    record.paused = undefined
    restartMachine(record)
    refreshMachine(found.window)
  })
  onGuiClick("machine-stop", (player) => {
    const found = windowRobot(player)
    if (found === undefined) return
    stopMachine(machineOf(found.robot.id))
    refreshMachine(found.window)
  })
  onGuiClick("machine-pause", (player) => {
    const found = windowRobot(player)
    if (found === undefined) return
    const record = machineOf(found.robot.id)
    record.paused = record.paused ? undefined : true
    if (!record.paused) wake(record.robotId)
    refreshMachine(found.window)
  })
  onGuiClick("machine-step", (player) => {
    const found = windowRobot(player)
    if (found === undefined) return
    const record = machineOf(found.robot.id)
    record.paused = true
    stepMachine(record)
    refreshMachine(found.window)
  })
  onGuiConfirm("machine-name", (player, element) => {
    const found = windowRobot(player)
    if (found === undefined) return
    const name = string.sub(trim((element as TextFieldGuiElement).text), 1, 40)
    if (name === "") return
    found.robot.name = name
    if (found.robot.label.valid) found.robot.label.text = name
    refreshMachine(found.window)
  })
  onGuiClick("machine-home", (player) => {
    const found = windowRobot(player)
    if (found === undefined) return
    machineOf(found.robot.id).home = found.robot.entity.position
    refreshMachine(found.window)
  })
  onGuiClick("machine-home-clear", (player) => {
    const found = windowRobot(player)
    if (found === undefined) return
    machineOf(found.robot.id).home = undefined
    refreshMachine(found.window)
  })
  onGuiClick("machine-args", (player) => {
    const found = windowRobot(player)
    if (found === undefined) return
    const text = trim(found.window.args.text)
    const [ok, value] = pcall(lib.JSON.parse, text === "" ? "{}" : text)
    if (!ok || type(value) !== "table") {
      found.window.argsError.caption = ["automaton-gui.args-error", ok ? "{…}" : formatValue((value as { message?: unknown })?.message ?? value)]
      return
    }
    found.window.argsError.caption = ["automaton-gui.args-saved"]
    machineOf(found.robot.id).args = value
  })
}
