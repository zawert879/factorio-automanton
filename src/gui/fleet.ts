// Окно «Все машины» (18.6; решения — DESIGN.md, «Все машины»): ярлык на панели быстрого доступа и кнопка
// «Машины: N» у программы в окне программ (окно открывается с фильтром по ней). Таблица машин команды
// (машина, программа, состояние, топливо) с сортировкой по столбцу и страницами по 50; поиск, фильтры с числами
// (с ошибкой, без топлива, стоят) и программа. Клик по строке — удалённый вид на машину и её окно.
import { DropDownGuiElement, FrameGuiElement, LocalisedString, LuaForce, LuaGuiElement, LuaPlayer, TableGuiElement, TextFieldGuiElement } from "factorio:runtime"
import { RobotRecord } from "../automaton/registry"
import { onEvent, onTick } from "../events"
import { mapCase, trim } from "../lang/runtime/strings"
import { FLEET_SHORTCUT } from "../names"
import { robotState } from "../program/handles"
import { MachineRecord, machineOf } from "../program/machines"
import { programsOf } from "../program/store"
import { guiOf, onGuiChange, onGuiClick, onGuiSelection, titlebar } from "./common"
import { fuelLevel, openMachine } from "./machine"

const FRAME = "automaton-fleet"
const PAGE_SIZE = 50
const REFRESH_TICKS = 60
const FILTERS = ["all", "error", "no-fuel", "idle"] as const
export type Filter = (typeof FILTERS)[number]
const COLUMNS = ["name", "program", "state", "fuel"] as const
type Column = (typeof COLUMNS)[number]
/** Топливо ниже — «без топлива» (вместе с состоянием машины «нет топлива»). */
const LOW_FUEL = 0.02

export interface FleetWindow {
  frame: FrameGuiElement
  search: TextFieldGuiElement
  chips: LuaGuiElement
  programs: DropDownGuiElement
  /** id программ выпадающего списка (после «все»). */
  programIds: number[]
  table: TableGuiElement
  pager: LuaGuiElement
  total: LuaGuiElement
  filter: Filter
  programId?: number
  sort: Column
  page: number
}

export interface Row {
  robot: RobotRecord
  record: MachineRecord
  program?: string
  fuel: number
  /** Тяжесть состояния для сортировки: ошибка, нет топлива, застряла, стоит, работает. */
  severity: number
  state: LocalisedString
  stateColor: { r: number; g: number; b: number }
  tooltip: LocalisedString
  error: boolean
  noFuel: boolean
  idle: boolean
}

const RED = { r: 1, g: 0.48, b: 0.42 }
const ORANGE = { r: 0.95, g: 0.68, b: 0.24 }
const GREEN = { r: 0.56, g: 0.84, b: 0.56 }
const GRAY = { r: 0.66, g: 0.66, b: 0.66 }

function windowOf(player: LuaPlayer): FleetWindow | undefined {
  const window = guiOf(player).fleet
  return window !== undefined && window.frame.valid ? window : undefined
}

/** Машины команды (подобранные — нет) с тем, что про них показать. */
export function fleetRows(force: LuaForce): Row[] {
  const rows: Row[] = []
  for (const [, robot] of pairs(storage.robots.byId)) {
    if (robot === undefined || !robot.entity.valid || robot.entity.force !== force) continue
    const record = machineOf(robot.id)
    if (record.parked) continue
    const program = record.programId === undefined ? undefined : storage.programs.byId[record.programId]
    const fuel = fuelLevel(robot)
    const activity = robotState(robot)
    const status = record.machine.status
    const error = program !== undefined && (status === "error" || program.quarantined === true)
    const noFuel = activity === "no-fuel" || fuel < LOW_FUEL
    const idle = program === undefined || status === "done" || record.paused === true
    let state: LocalisedString
    let color = GREEN
    let severity = 4
    let tooltip: LocalisedString = ""
    if (error) {
      const e = record.machine.error
      state = e === undefined ? ["automaton-gui.status-error"] : ["", ["automaton-gui.status-error"], `: ${e.name}`]
      tooltip = e === undefined ? "" : `${e.name}: ${e.message}`
      color = RED
      severity = 0
    } else if (program === undefined) {
      state = ["automaton-gui.status-no-program"]
      color = GRAY
      severity = 3
    } else if (status === "done") {
      state = ["automaton-gui.status-done"]
      color = GRAY
      severity = 3
    } else {
      state = [`automaton-gui.robot-${activity}`]
      if (record.paused) state = ["automaton-gui.status-paused", state]
      if (noFuel || activity === "stuck") {
        color = ORANGE
        severity = noFuel ? 1 : 2
      } else if (record.paused || activity === "idle") {
        color = GRAY
        severity = 3
      }
    }
    rows.push({ robot, record, program: program?.name, fuel, severity, state, stateColor: color, tooltip, error, noFuel, idle })
  }
  return rows
}

export function passes(row: Row, filter: Filter): boolean {
  return filter === "all" || (filter === "error" ? row.error : filter === "no-fuel" ? row.noFuel : row.idle)
}

function compare(a: Row, b: Row, column: Column): boolean {
  if (column === "program" && a.program !== b.program) return (a.program ?? "\u{FFFF}") < (b.program ?? "\u{FFFF}")
  if (column === "state" && a.severity !== b.severity) return a.severity < b.severity
  if (column === "fuel" && a.fuel !== b.fuel) return a.fuel < b.fuel
  return a.robot.id < b.robot.id
}

export function openFleet(player: LuaPlayer, programId?: number): void {
  player.gui.screen[FRAME]?.destroy()
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-fleet.title"], "fleet-close")
  const body = frame.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const top = body.add({ type: "flow", direction: "horizontal" })
  top.style.vertical_align = "center"
  top.style.horizontal_spacing = 8
  top.add({ type: "label", caption: ["automaton-gui.search"] })
  const search = top.add({ type: "textfield", text: "", tags: { action: "fleet-search" } })
  search.style.width = 160
  const chips = top.add({ type: "flow", direction: "horizontal" })
  const programs = top.add({ type: "drop-down", items: [], tags: { action: "fleet-program" } })
  programs.style.width = 200
  const pane = body.add({ type: "scroll-pane", horizontal_scroll_policy: "never", vertical_scroll_policy: "auto" })
  pane.style.height = 520
  pane.style.width = 760
  const table = pane.add({ type: "table", column_count: COLUMNS.length })
  table.style.horizontal_spacing = 16
  table.style.vertical_spacing = 2
  const bottom = body.add({ type: "flow", direction: "horizontal" })
  bottom.style.vertical_align = "center"
  const total = bottom.add({ type: "label", caption: "" })
  const spacer = bottom.add({ type: "empty-widget" })
  spacer.style.horizontally_stretchable = true
  const pager = bottom.add({ type: "flow", direction: "horizontal" })
  pager.style.vertical_align = "center"
  const window: FleetWindow = { frame, search, chips, programs, programIds: [], table, pager, total, filter: "all", programId, sort: "name", page: 1 }
  guiOf(player).fleet = window
  // Не «открытое окно» игрока: иначе окно машины из списка закрыло бы список (закрывается крестиком и ярлыком).
  player.set_shortcut_toggled(FLEET_SHORTCUT, true)
  refreshFleet(window, player)
}

export function closeFleet(player: LuaPlayer): void {
  player.gui.screen[FRAME]?.destroy()
  guiOf(player).fleet = undefined
  player.set_shortcut_toggled(FLEET_SHORTCUT, false)
}

function cell(table: LuaGuiElement, caption: LocalisedString, robotId: number, color?: { r: number; g: number; b: number }, tooltip?: LocalisedString): void {
  const label = table.add({ type: "label", caption, tags: { action: "fleet-open", robot: robotId } })
  if (color !== undefined) label.style.font_color = color
  if (tooltip !== undefined && tooltip !== "") label.tooltip = tooltip
}

function refreshFleet(window: FleetWindow, player: LuaPlayer): void {
  const all = fleetRows(player.force as LuaForce)
  // Фильтры с числами (по выбранной программе и поиску — нет: числа про весь парк).
  window.chips.clear()
  for (const filter of FILTERS) {
    const count = all.filter((r) => passes(r, filter)).length
    const chip = window.chips.add({ type: "button", caption: [`automaton-fleet.filter-${filter}`, count], tags: { action: "fleet-filter", filter }, style: "button" })
    chip.toggled = window.filter === filter
    chip.style.minimal_width = 0
  }
  // Программы, по которым работают машины.
  const used = programsOf(player.force.name).filter((p) => all.some((r) => r.record.programId === p.id))
  window.programIds = used.map((p) => p.id)
  window.programs.items = [["automaton-fleet.all-programs"], ...used.map((p) => p.name)]
  const selected = window.programId === undefined ? 0 : window.programIds.indexOf(window.programId) + 1
  window.programs.selected_index = selected > 0 ? selected : 1
  if (selected <= 0) window.programId = undefined

  const query = mapCase(trim(window.search.text), false)
  const rows = all
    .filter((r) => passes(r, window.filter))
    .filter((r) => window.programId === undefined || r.record.programId === window.programId)
    .filter((r) => query === "" || mapCase(r.robot.name, false).includes(query) || (r.program !== undefined && mapCase(r.program, false).includes(query)))
  table.sort(rows, (a, b) => compare(a, b, window.sort))
  const pages = math.max(1, math.ceil(rows.length / PAGE_SIZE))
  window.page = math.min(window.page, pages)

  window.table.clear()
  for (const column of COLUMNS) {
    const head = window.table.add({ type: "label", caption: ["", [`automaton-fleet.column-${column}`], window.sort === column ? " ▾" : ""], style: "bold_label", tags: { action: "fleet-sort", column } })
    head.tooltip = ["automaton-fleet.sort-tooltip"]
  }
  for (const row of rows.slice((window.page - 1) * PAGE_SIZE, window.page * PAGE_SIZE)) {
    const id = row.robot.id
    cell(window.table, row.robot.name, id)
    cell(window.table, row.program ?? "—", id, row.program === undefined ? GRAY : undefined)
    cell(window.table, row.state, id, row.stateColor, row.tooltip)
    cell(window.table, `${math.floor(row.fuel * 100)}%`, id, row.noFuel ? ORANGE : undefined)
  }
  window.total.caption = ["automaton-fleet.total", rows.length, all.length]
  window.pager.clear()
  if (pages > 1) {
    window.pager.add({ type: "button", caption: "‹", style: "tool_button", tags: { action: "fleet-page", delta: -1 } }).enabled = window.page > 1
    window.pager.add({ type: "label", caption: `${window.page} / ${pages}` })
    window.pager.add({ type: "button", caption: "›", style: "tool_button", tags: { action: "fleet-page", delta: 1 } }).enabled = window.page < pages
  }
}

/** Удалённый вид на машину (камера следует за ней) и её окно. */
export function showRobot(player: LuaPlayer, robot: RobotRecord): void {
  const entity = robot.entity
  const [ok] = pcall(() => {
    player.set_controller({ type: defines.controllers.remote, position: entity.position, surface: entity.surface })
    player.centered_on = entity
  })
  if (!ok) player.print(["automaton-fleet.no-remote-view"])
  openMachine(player, robot)
}

export function registerFleetWindow(): void {
  onEvent(defines.events.on_lua_shortcut, (e) => {
    if (e.prototype_name !== FLEET_SHORTCUT) return
    const player = game.get_player(e.player_index)
    if (player === undefined) return
    if (windowOf(player) !== undefined) closeFleet(player)
    else openFleet(player)
  })
  onGuiClick("fleet-close", (player) => closeFleet(player))
  onGuiClick("programs-machines", (player) => openFleet(player, guiOf(player).programs?.programId))
  onGuiChange("fleet-search", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    window.page = 1
    refreshFleet(window, player)
  })
  onGuiClick("fleet-filter", (player, element) => {
    const window = windowOf(player)
    if (window === undefined) return
    window.filter = (element.tags as { filter: Filter }).filter
    window.page = 1
    refreshFleet(window, player)
  })
  onGuiSelection("fleet-program", (player, element) => {
    const window = windowOf(player)
    if (window === undefined) return
    const index = (element as DropDownGuiElement).selected_index
    window.programId = index <= 1 ? undefined : window.programIds[index - 2]
    window.page = 1
    refreshFleet(window, player)
  })
  onGuiClick("fleet-sort", (player, element) => {
    const window = windowOf(player)
    if (window === undefined) return
    window.sort = (element.tags as { column: Column }).column
    refreshFleet(window, player)
  })
  onGuiClick("fleet-page", (player, element) => {
    const window = windowOf(player)
    if (window === undefined) return
    window.page += (element.tags as { delta: number }).delta
    refreshFleet(window, player)
  })
  onGuiClick("fleet-open", (player, element) => {
    const robot = storage.robots.byId[(element.tags as { robot: number }).robot]
    if (robot !== undefined && robot.entity.valid) showRobot(player, robot)
  })
  onTick((tick) => {
    if (tick % REFRESH_TICKS !== 0) return
    for (const player of game.connected_players) {
      const window = windowOf(player)
      if (window !== undefined) refreshFleet(window, player)
    }
  })
}
