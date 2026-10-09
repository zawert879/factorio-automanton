// Окна мастерской (этап 15): панель сверху (проверить, опубликовать, код, выйти), палитра узлов слева (клик —
// узел в руку чертежом), окно настроек узла (клик по узлу): значения входов без провода и настройки.
import { LocalisedString, LuaGuiElement, LuaPlayer, PlayerIndex } from "factorio:runtime"
import { onCustomInput, onEvent } from "../events"
import { GraphValue, PinType } from "../graph/model"
import { CATEGORIES, NODES, SettingSpec } from "../graph/nodes"
import { NODE_BODY_PREFIX } from "../names"
import { addCode } from "../gui/codeView"
import { onGuiChange, onGuiChecked, onGuiClick, onGuiElemChanged, onGuiSelection, titlebar } from "../gui/common"
import { findProgram, onProgramPublished, onProgramRemoved, ProgramRecord } from "../program/store"
import { buildGraph, deleteWorkshop, drawNode, isNodeBody, NODE_TAG, nodeOfEntity, readGraph, refreshNode, slotsOf, workshopOf } from "./entities"
import { newGraphProgram } from "./programs"
import { buildWorkshop, publishing, publishWorkshop, showErrors } from "./publish"
import { breakLine, machinesOf } from "./debug"
import { MachineRecord, wake } from "../program/machines"
import { stepMachine } from "../program/scheduler"
import { currentWorkshop, enterWorkshop, exitWorkshop, onWorkshopEnter, onWorkshopExit, visitorOf, visitorsOf } from "./session"
import { Workshop, WorkshopNode, workshopState } from "./state"

const HUD = "automaton-workshop-hud"
const PALETTE = "automaton-workshop-palette"
const NODE_WINDOW = "automaton-workshop-node"
const CODE_WINDOW = "automaton-workshop-code"

function programOf(ws: Workshop): ProgramRecord | undefined {
  return storage.programs.byId[ws.programId]
}

// ---------- Панель ----------

function openHud(player: LuaPlayer, ws: Workshop): void {
  player.gui.screen[HUD]?.destroy()
  const program = programOf(ws)
  const frame = player.gui.screen.add({ type: "frame", name: HUD, direction: "vertical" })
  const row = frame.add({ type: "flow", direction: "horizontal" })
  row.style.vertical_align = "center"
  row.style.horizontal_spacing = 8
  row.add({ type: "label", caption: ["automaton-workshop.hud-title", program?.name ?? "?"], style: "frame_title" })
  row.add({ type: "button", caption: ["automaton-workshop.check"], tags: { action: "workshop-check" } })
  row.add({ type: "button", caption: ["automaton-workshop.publish"], style: "green_button", tags: { action: "workshop-publish" } })
  row.add({ type: "button", caption: ["automaton-workshop.code"], tags: { action: "workshop-code" } })
  row.add({ type: "button", caption: ["automaton-workshop.exit"], style: "red_button", tags: { action: "workshop-exit" } })
  // Отладка (15.9): машина с этой программой — её узел подсвечен, «Продолжить», «Шаг», «Пауза».
  const debugRow = frame.add({ type: "flow", direction: "horizontal" })
  debugRow.style.vertical_align = "center"
  debugRow.style.horizontal_spacing = 8
  debugRow.add({ type: "label", caption: ["automaton-workshop.debug"], style: "bold_label" })
  const machines = program === undefined ? [] : machinesOf(program)
  const visitor = visitorOf(player)
  const items: LocalisedString[] = [["automaton-workshop.debug-none"]]
  for (const record of machines) items.push(storage.robots.byId[record.robotId]?.name ?? `${record.robotId}`)
  const chosen = machines.findIndex((r) => r.robotId === visitor?.debugRobot)
  debugRow.add({
    type: "drop-down",
    items,
    selected_index: chosen >= 0 ? chosen + 2 : 1,
    tags: { action: "workshop-debug-select", ids: machines.map((r) => r.robotId).join(",") },
  })
  debugRow.add({ type: "button", caption: ["automaton-workshop.debug-continue"], tags: { action: "workshop-debug-continue" } })
  debugRow.add({ type: "button", caption: ["automaton-workshop.debug-step"], tags: { action: "workshop-debug-step" } })
  debugRow.add({ type: "button", caption: ["automaton-workshop.debug-pause"], tags: { action: "workshop-debug-pause" } })
  const status = frame.add({ type: "label", name: "status", caption: ["automaton-workshop.status-hint"] })
  status.style.single_line = false
  status.style.maximal_width = 720
  frame.location = { x: math.max(0, math.floor(player.display_resolution.width / 2 - 360 * player.display_scale)), y: math.floor(8 * player.display_scale) }
}

function setStatus(player: LuaPlayer, caption: LocalisedString): void {
  const hud = player.gui.screen[HUD]
  const status = hud === undefined ? undefined : hud["status"]
  if (status !== undefined) status.caption = caption
}

// ---------- Палитра ----------

function openPalette(player: LuaPlayer): void {
  player.gui.screen[PALETTE]?.destroy()
  const visitor = visitorOf(player)
  const category = visitor?.category ?? "flow"
  const frame = player.gui.screen.add({ type: "frame", name: PALETTE, direction: "vertical", caption: ["automaton-workshop.palette-title"] })
  const index = math.max(1, CATEGORIES.indexOf(category as never) + 1)
  frame.add({
    type: "drop-down",
    items: CATEGORIES.map((c) => [`automaton-node-category.${c}`] as LocalisedString),
    selected_index: index,
    tags: { action: "workshop-category" },
  })
  const scroll = frame.add({ type: "scroll-pane" })
  scroll.style.maximal_height = 560
  for (const [kind, spec] of pairs(NODES)) {
    if (spec.category !== category) continue
    const button = scroll.add({ type: "button", caption: [`automaton-node.${kind}`], tags: { action: "workshop-pick", kind } })
    button.style.width = 230
    button.style.horizontal_align = "left"
  }
  const hint = frame.add({ type: "label", caption: ["automaton-workshop.palette-hint"] })
  hint.style.single_line = false
  hint.style.maximal_width = 230
  hint.style.font_color = { r: 0.7, g: 0.7, b: 0.7 }
  frame.location = { x: math.floor(8 * player.display_scale), y: math.floor(120 * player.display_scale) }
}

/** Значения по умолчанию из настроек вида узла (имя, тип, оператор). */
function defaultValues(kind: string): Record<string, GraphValue | undefined> {
  const values: Record<string, GraphValue | undefined> = {}
  for (const setting of NODES[kind]?.settings ?? []) if (setting.default !== undefined) values[setting.id] = setting.default
  return values
}

/** Узел в руку: чертёж из одного тела с тегом (разъёмы ставятся при постройке). */
function pickNode(player: LuaPlayer, ws: Workshop, kind: string): void {
  const values = defaultValues(kind)
  const { height } = slotsOf(ws, { id: 0, kind, values })
  player.clear_cursor()
  const hand = player.cursor_stack
  if (hand === undefined || !hand.set_stack({ name: "blueprint" })) return
  hand.set_blueprint_entities([{ entity_number: 1, name: `${NODE_BODY_PREFIX}${height}`, position: { x: 0, y: 0 }, tags: { [NODE_TAG]: { kind, values } as never } }])
}

// ---------- Окно узла ----------

function closeNodeWindow(player: LuaPlayer): void {
  player.gui.screen[NODE_WINDOW]?.destroy()
  const visitor = visitorOf(player)
  if (visitor !== undefined) visitor.editing = undefined
}

/** Подключён ли разъём проводом. */
function wired(node: WorkshopNode, key: string): boolean {
  const pin = node.pins[key]
  if (pin === undefined || !pin.valid) return false
  for (const id of [defines.wire_connector_id.circuit_red, defines.wire_connector_id.circuit_green]) {
    const connector = pin.get_wire_connector(id, false)
    if (connector !== undefined && connector.connection_count > 0) return true
  }
  return false
}

function addField(parent: LuaGuiElement, key: string, kind: PinType | SettingSpec["kind"], value: GraphValue | undefined, options?: string[]): void {
  const tags = { action: "workshop-value", key, kind }
  switch (kind) {
    case "item":
    case "fluid":
      parent.add({ type: "choose-elem-button", elem_type: kind, [kind]: typeof value === "string" ? value : undefined, tags } as never)
      return
    case "boolean":
      parent.add({ type: "checkbox", state: value === true, caption: "", tags })
      return
    case "enum":
    case "type": {
      const list = options ?? []
      const items: LocalisedString[] = list.map((o) => (kind === "type" ? [`automaton-pin-type.${o}`] : o))
      parent.add({ type: "drop-down", items, selected_index: math.max(1, list.indexOf(`${value}`) + 1), tags: { ...tags, options: list.join("|") } })
      return
    }
    case "number": {
      const field = parent.add({ type: "textfield", text: value === undefined ? "" : `${value}`, numeric: true, allow_decimal: true, allow_negative: true, tags })
      field.style.width = 120
      return
    }
    default: {
      const field = parent.add({ type: "textfield", text: value === undefined ? "" : `${value}`, tags })
      field.style.width = 220
    }
  }
}

function openNodeWindow(player: LuaPlayer, ws: Workshop, node: WorkshopNode): void {
  player.gui.screen[NODE_WINDOW]?.destroy()
  const visitor = visitorOf(player)
  if (visitor === undefined) return
  visitor.editing = node.id
  const spec = NODES[node.kind]
  const frame = player.gui.screen.add({ type: "frame", name: NODE_WINDOW, direction: "vertical" })
  titlebar(frame, [`automaton-node.${node.kind}`], "workshop-node-close")
  const table = frame.add({ type: "table", column_count: 2 })
  table.style.vertical_spacing = 6
  table.style.horizontal_spacing = 12
  let fields = 0
  for (const setting of spec?.settings ?? []) {
    table.add({ type: "label", caption: [`automaton-pin.${setting.id}`], style: "bold_label" })
    addField(table, setting.id, setting.kind, node.values[setting.id] ?? setting.default, setting.options)
    fields++
  }
  for (const slot of slotsOf(ws, node).slots) {
    if (slot.side !== "in" || slot.exec || slot.spec === undefined) continue
    const id = slot.spec.id
    const custom = node.kind === "call"
    table.add({ type: "label", caption: custom ? id : [`automaton-pin.${id}`], style: "bold_label" })
    if (wired(node, slot.key)) {
      table.add({ type: "label", caption: ["automaton-workshop.wired"] })
    } else if (["entity", "entities", "robots", "enemy", "enemies", "targets", "message", "task", "list", "position"].includes(slot.spec.type)) {
      table.add({ type: "label", caption: ["automaton-workshop.wire-only", [`automaton-pin-type.${slot.spec.type}`]] })
    } else {
      addField(table, id, slot.spec.type, node.values[id] ?? slot.spec.default)
    }
    fields++
  }
  if (fields === 0) frame.add({ type: "label", caption: ["automaton-workshop.no-settings"] })
  // Точка остановки у машины, выбранной для отладки.
  const program = programOf(ws)
  const record = visitor.debugRobot === undefined ? undefined : storage.machines[visitor.debugRobot]
  if (program !== undefined && record !== undefined && spec?.exec) {
    const line = breakLine(program, node.id)
    const name = storage.robots.byId[record.robotId]?.name ?? `${record.robotId}`
    if (line === undefined) frame.add({ type: "label", caption: ["automaton-workshop.no-break"] })
    else frame.add({ type: "checkbox", state: record.breakpoints?.[line] === true, caption: ["automaton-workshop.breakpoint", name], tags: { action: "workshop-breakpoint", line } })
  }
  if (node.error !== undefined) {
    const error = frame.add({ type: "label", caption: node.error })
    error.style.font_color = { r: 1, g: 0.4, b: 0.35 }
    error.style.single_line = false
    error.style.maximal_width = 400
  }
  frame.auto_center = true
}

/** Узлы, чьи разъёмы зависят от этой настройки (переменная, функция, параметр) — обновить все. */
const SHAPING = ["name", "type", "params", "returns"]

/** Машина, выбранная игроком для отладки в мастерской. */
function debugRecord(player: LuaPlayer): MachineRecord | undefined {
  const id = visitorOf(player)?.debugRobot
  return id === undefined ? undefined : storage.machines[id]
}

function setValue(player: LuaPlayer, key: string, value: GraphValue | undefined): void {
  const ws = currentWorkshop(player)
  const visitor = visitorOf(player)
  const node = visitor?.editing === undefined ? undefined : ws?.nodes[visitor.editing]
  if (ws === undefined || node === undefined || !node.body.valid) return
  node.values[key] = value
  if (SHAPING.includes(key) && (NODES[node.kind]?.settings ?? []).some((s) => s.id === key)) {
    for (const [, other] of pairs(ws.nodes)) if (other.body.valid) refreshNode(ws, other)
    openNodeWindow(player, ws, node)
  } else {
    drawNode(ws, node)
  }
}

function parsed(text: string, kind: string): GraphValue | undefined {
  if (text === "") return undefined
  if (kind === "number" || kind === "value") return tonumber(text) ?? text
  return text
}

// ---------- Код ----------

function openCode(player: LuaPlayer, ws: Workshop): void {
  player.gui.screen[CODE_WINDOW]?.destroy()
  const program = programOf(ws)
  if (program === undefined) return
  const build = buildWorkshop(ws, program, player.locale !== "ru")
  const frame = player.gui.screen.add({ type: "frame", name: CODE_WINDOW, direction: "vertical" })
  titlebar(frame, ["automaton-workshop.code-title", program.name], "workshop-code-close")
  const scroll = frame.add({ type: "scroll-pane" })
  scroll.style.maximal_height = 600
  scroll.style.maximal_width = 900
  addCode(scroll, build.source.source, 820)
  frame.auto_center = true
}

// ---------- Проверка и публикация ----------

function check(player: LuaPlayer, ws: Workshop): void {
  const program = programOf(ws)
  if (program === undefined) return
  const build = buildWorkshop(ws, program, player.locale !== "ru")
  showErrors(ws, build.errors)
  reportErrors(player, build.errors.length, build.errors.find((e) => e.node === 0)?.message)
}

function reportErrors(player: LuaPlayer, count: number, general: LocalisedString | undefined): void {
  if (count === 0) setStatus(player, ["automaton-workshop.status-ok"])
  else if (general !== undefined) setStatus(player, ["automaton-workshop.status-general", count, general])
  else setStatus(player, ["automaton-workshop.status-errors", count])
}

function publishFrom(player: LuaPlayer, ws: Workshop): void {
  const program = programOf(ws)
  if (program === undefined) return
  const before = program.version
  const { build, result } = publishWorkshop(ws, program, player.name, player.locale !== "ru")
  if (result === undefined || !result.ok) {
    reportErrors(player, build.errors.length, build.errors.find((e) => e.node === 0)?.message)
    return
  }
  setStatus(player, result.program.version === before ? ["automaton-workshop.status-same"] : ["automaton-workshop.status-published", result.program.version])
}

// ---------- Регистрация ----------

function openAll(player: LuaPlayer, ws: Workshop): void {
  openHud(player, ws)
  openPalette(player)
}

function closeAll(player: LuaPlayer): void {
  for (const name of [HUD, PALETTE, NODE_WINDOW, CODE_WINDOW]) player.gui.screen[name]?.destroy()
}

/** После обновления мода окна закрыты — игрокам в мастерской вернуть панель (без неё не выйти). */
export function restoreWorkshopWindows(): void {
  for (const [index, visitor] of pairs(workshopState().visitors)) {
    const player = game.get_player(index as PlayerIndex)
    const ws = workshopOf(visitor.programId)
    if (player === undefined) continue
    if (ws === undefined) exitWorkshop(player)
    else openAll(player, ws)
  }
}

export { enterWorkshop, exitWorkshop }

export function registerWorkshopGui(): void {
  onWorkshopEnter((player, ws) => openAll(player, ws))
  onWorkshopExit((player) => closeAll(player))
  onGuiClick("workshop-exit", (player) => exitWorkshop(player))
  onGuiClick("workshop-check", (player) => {
    const ws = currentWorkshop(player)
    if (ws !== undefined) check(player, ws)
  })
  onGuiClick("workshop-publish", (player) => {
    const ws = currentWorkshop(player)
    if (ws !== undefined) publishFrom(player, ws)
  })
  onGuiClick("workshop-code", (player) => {
    const ws = currentWorkshop(player)
    if (ws !== undefined) openCode(player, ws)
  })
  onGuiClick("workshop-code-close", (player) => player.gui.screen[CODE_WINDOW]?.destroy())
  onGuiClick("workshop-node-close", (player) => closeNodeWindow(player))
  onGuiClick("workshop-pick", (player, element) => {
    const ws = currentWorkshop(player)
    const kind = (element.tags as unknown as { kind?: string }).kind
    if (ws !== undefined && kind !== undefined) pickNode(player, ws, kind)
  })
  onGuiSelection("workshop-category", (player, element) => {
    const visitor = visitorOf(player)
    if (visitor === undefined) return
    visitor.category = CATEGORIES[(element as unknown as { selected_index: number }).selected_index - 1]
    openPalette(player)
  })
  onGuiChange("workshop-value", (player, element) => {
    const tags = element.tags as { key: string; kind: string }
    setValue(player, tags.key, parsed((element as unknown as { text: string }).text, tags.kind))
  })
  onGuiSelection("workshop-debug-select", (player, element) => {
    const visitor = visitorOf(player)
    if (visitor === undefined) return
    const ids = (element.tags as unknown as { ids: string }).ids.split(",")
    const index = (element as unknown as { selected_index: number }).selected_index
    visitor.debugRobot = index >= 2 ? tonumber(ids[index - 2]) : undefined
  })
  onGuiClick("workshop-debug-continue", (player) => {
    const record = debugRecord(player)
    if (record === undefined) return
    record.paused = undefined
    record.stopLine = undefined
    wake(record.robotId)
  })
  onGuiClick("workshop-debug-step", (player) => {
    const record = debugRecord(player)
    if (record === undefined) return
    record.paused = true
    stepMachine(record)
  })
  onGuiClick("workshop-debug-pause", (player) => {
    const record = debugRecord(player)
    if (record !== undefined) record.paused = true
  })
  onGuiChecked("workshop-breakpoint", (player, element) => {
    const record = debugRecord(player)
    if (record === undefined) return
    const line = (element.tags as unknown as { line: number }).line
    record.breakpoints ??= {}
    record.breakpoints[line] = (element as unknown as { state: boolean }).state ? true : undefined
    if (next(record.breakpoints)[0] === undefined) record.breakpoints = undefined
  })
  onGuiChecked("workshop-value", (player, element) => {
    const tags = element.tags as { key: string }
    setValue(player, tags.key, (element as unknown as { state: boolean }).state)
  })
  onGuiElemChanged("workshop-value", (player, element) => {
    const tags = element.tags as { key: string }
    const value = (element as unknown as { elem_value?: unknown }).elem_value
    setValue(player, tags.key, typeof value === "string" ? value : undefined)
  })
  onGuiSelection("workshop-value", (player, element) => {
    const tags = element.tags as { key: string; options: string }
    const options = tags.options.split("|")
    setValue(player, tags.key, options[(element as unknown as { selected_index: number }).selected_index - 1])
  })
  // Клик по узлу пустой рукой — окно настроек.
  onCustomInput("automaton-open", (e) => {
    const player = game.get_player(e.player_index)
    const selected = player?.selected
    if (player === undefined || selected === undefined || !isNodeBody(selected.name)) return
    if (player.cursor_stack?.valid_for_read || player.cursor_ghost !== undefined) return
    const found = nodeOfEntity(selected)
    if (found !== undefined) openNodeWindow(player, found.ws, found.node)
  })
  // Новая версия схемы не из этой мастерской (импорт строкой) — мастерская строится заново.
  onProgramPublished((program) => {
    if (publishing.fromWorkshop || program.graph === undefined) return
    const ws = workshopOf(program.id)
    if (ws !== undefined) buildGraph(ws, program.graph)
  })
  // Программу удалили — мастерскую тоже, игроков из неё — наружу.
  onProgramRemoved((program) => {
    for (const player of visitorsOf(program.id)) exitWorkshop(player)
    deleteWorkshop(program.id)
  })
  onEvent(defines.events.on_player_removed, (e) => {
    workshopState().visitors[e.player_index] = undefined
  })
  registerRemote()
}

/** Для проверок с игроком (npm run test:sim) и других модов: войти, взять узел, прочитать схему, опубликовать, выйти. */
function registerRemote(): void {
  const playerOf = (index: number) => game.get_player(index as PlayerIndex)
  const workshopNamed = (name: string) => {
    const program = findProgram(name)
    return program === undefined ? undefined : workshopOf(program.id)
  }
  remote.add_interface("automaton-workshop", {
    enter: (index: number, name: string) => {
      const player = playerOf(index)
      if (player === undefined) return false
      let program = findProgram(name, player.force.name)
      if (program === undefined) {
        const created = newGraphProgram(player, name)
        if (!created.ok) return false
        program = created.program
      }
      enterWorkshop(player, program)
      return true
    },
    exit: (index: number) => {
      const player = playerOf(index)
      if (player !== undefined) exitWorkshop(player)
    },
    pick: (index: number, kind: string) => {
      const player = playerOf(index)
      const ws = player === undefined ? undefined : currentWorkshop(player)
      if (player !== undefined && ws !== undefined) pickNode(player, ws, kind)
    },
    graph: (name: string) => {
      const ws = workshopNamed(name)
      if (ws === undefined) return undefined
      const { graph, problems } = readGraph(ws)
      return {
        nodes: graph.nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y })),
        wires: graph.wires.map((w) => `${w.from}.${w.out}>${w.to}.${w.in}`),
        problems: problems.length,
      }
    },
    pin: (name: string, node: number, key: string) => {
      const pin = workshopNamed(name)?.nodes[node]?.pins[key]
      return pin !== undefined && pin.valid ? pin.position : undefined
    },
    body: (name: string, node: number) => {
      const body = workshopNamed(name)?.nodes[node]?.body
      return body !== undefined && body.valid ? body.position : undefined
    },
    publish: (index: number) => {
      const player = playerOf(index)
      const ws = player === undefined ? undefined : currentWorkshop(player)
      const program = ws === undefined ? undefined : programOf(ws)
      if (player === undefined || ws === undefined || program === undefined) return undefined
      const { build, result } = publishWorkshop(ws, program, player.name)
      return { errors: build.errors.length, version: result?.ok ? result.program.version : undefined }
    },
  })
}
