// Окна мастерской (этап 15): панель сверху (проверить, опубликовать, код, выйти), палитра узлов слева (клик —
// узел в руку чертежом), окно настроек узла (клик по узлу): значения входов без провода и настройки.
import { LocalisedString, LuaGuiElement, LuaPlayer, PlayerIndex } from "factorio:runtime"
import { onCustomInput, onEvent } from "../events"
import { callLibrary, formatParams, GraphParam, parseParams } from "../graph/codegen"
import { GraphValue, PinType } from "../graph/model"
import { CATEGORIES, NODES, SettingSpec, settingType, TYPED_VALUE, typedDefault } from "../graph/nodes"
import { NODE_BODY_PREFIX, NODE_MOVER } from "../names"
import { addCode } from "../gui/codeView"
import { onGuiChange, onGuiChecked, onGuiClick, onGuiElemChanged, onGuiSelection, titlebar } from "../gui/common"
import { findProgram, onProgramPublished, onProgramRemoved, onProgramRenamed, ProgramRecord } from "../program/store"
import { trim } from "../lang/runtime/strings"
import { buildGraph, checkWiresLater, deleteWorkshop, drawNode, isNodeBody, isPin, NODE_TAG, nodeOfEntity, readGraph, refreshNode, removeNode, slotsOf, workshopOf } from "./entities"
import { applyCall, callChoices, refreshLibraryCalls, renameLibraryCalls } from "./libraries"
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
  // Провода — свои кнопки: кнопки игры на панели быстрого доступа появляются только с исследованием «Сеть цепей».
  const wires = frame.add({ type: "flow", direction: "horizontal" })
  for (const wire of ["red-wire", "green-wire"]) {
    const button = wires.add({ type: "button", caption: [`automaton-workshop.${wire}`], tooltip: [`automaton-workshop.${wire}-tooltip`], tags: { action: "workshop-wire", wire } })
    button.style.width = 113
  }
  // Перенос узлов (23.1): инструмент в руку — рамка от узла переносит его.
  const mover = frame.add({ type: "button", caption: ["automaton-workshop.mover"], tooltip: ["automaton-workshop.mover-tooltip"], tags: { action: "workshop-mover" } })
  mover.style.width = 230
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

/** Провод в руку (красный — порядок, зелёный — данные): клик по разъёму, клик по другому. */
export function giveWire(player: LuaPlayer, wire: string): void {
  const hand = player.cursor_stack
  if (hand === undefined) return
  hand.clear()
  hand.set_stack({ name: wire })
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
    case "fluid": {
      // Имени нет в игре («0» от типа «число», предмет убранного мода) — пустой выбор: с таким именем кнопка не создаётся.
      const known = typeof value === "string" && (kind === "item" ? prototypes.item[value] : prototypes.fluid[value]) !== undefined
      parent.add({ type: "choose-elem-button", elem_type: kind, [kind]: known ? value : undefined, tags } as never)
      return
    }
    case "boolean":
      parent.add({ type: "checkbox", state: value === true || value === "true", caption: "", tags })
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

/** Начальное значение переменной, значение параметра по умолчанию — полем своего типа: предмет — выбором предмета. */
function addTypedField(parent: LuaGuiElement, node: WorkshopNode, setting: SettingSpec): void {
  const type = settingType(node.values.type, node.kind === "param" ? "item" : "number")
  const value = node.values[setting.id] ?? setting.default
  if (type === "position") parent.add({ type: "label", caption: ["automaton-workshop.initial-position"] })
  else addField(parent, setting.id, type === "item" || type === "fluid" || type === "boolean" || type === "number" ? type : "text", value)
}

export function openNodeWindow(player: LuaPlayer, ws: Workshop, node: WorkshopNode): void {
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
    if (setting.kind === "params") addParamsEditor(table, node.values.params)
    else if (setting.kind === "function") addFunctionPicker(table, ws, node)
    else if (TYPED_VALUE[node.kind] === setting.id) addTypedField(table, node, setting)
    else addField(table, setting.id, setting.kind, node.values[setting.id] ?? setting.default, setting.options)
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
  // Переменная и параметр машины: откуда значение (переменную принимали за параметр из окна машины).
  if (node.kind === "variable" || node.kind === "param") {
    const hint = frame.add({ type: "label", caption: node.kind === "variable" ? ["automaton-workshop.variable-hint"] : ["automaton-workshop.param-hint"] })
    hint.style.single_line = false
    hint.style.maximal_width = 400
  }
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
  // Удалить узел (23.1): провода к нему снимаются вместе с разъёмами.
  frame.add({ type: "button", caption: ["automaton-workshop.delete-node"], tooltip: ["automaton-workshop.delete-node-tooltip"], style: "red_button", tags: { action: "workshop-node-delete" } })
  frame.auto_center = true
}

// ---------- Параметры функции и выбор функции (20.1) ----------

/** Типы параметров функции схемы. */
const PARAM_TYPES: PinType[] = ["number", "string", "boolean", "item", "fluid", "position", "entity", "robot", "marker", "zone", "target", "entities", "robots", "value"]
const PARAMS_TABLE = "params"

/** Параметры «Функции» таблицей: имя, тип, ✕; под ней — «+ параметр». */
function addParamsEditor(parent: LuaGuiElement, value: GraphValue | undefined): void {
  const flow = parent.add({ type: "flow", direction: "vertical" })
  const rows = flow.add({ type: "table", name: PARAMS_TABLE, column_count: 3 })
  rows.style.horizontal_spacing = 6
  rows.style.vertical_spacing = 4
  const types: LocalisedString[] = PARAM_TYPES.map((t) => [`automaton-pin-type.${t}`])
  for (const p of parseParams(value)) {
    const name = rows.add({ type: "textfield", text: p.name, tags: { action: "workshop-param-name" } })
    name.style.width = 140
    rows.add({ type: "drop-down", items: types, selected_index: math.max(1, PARAM_TYPES.indexOf(p.type) + 1), tags: { action: "workshop-param-type" } })
    const remove = rows.add({ type: "sprite-button", sprite: "utility/close", style: "tool_button_red", tooltip: ["automaton-workshop.remove-param"], tags: { action: "workshop-param-remove" } })
    remove.style.size = 28
  }
  flow.add({ type: "button", caption: ["automaton-workshop.add-param"], tags: { action: "workshop-param-add" } })
}

/** Параметры из таблицы окна (без пустых имён; разделители из имени убираются — имя проверит сборка). */
function paramRows(rows: LuaGuiElement, skip?: LuaGuiElement): GraphParam[] {
  const children = rows.children
  const list: GraphParam[] = []
  for (let i = 0; i + 2 < children.length; i += 3) {
    if (skip !== undefined && children[i + 2].index === skip.index) continue
    const [name] = string.gsub(trim((children[i] as unknown as { text: string }).text), "[%s,:?]", "")
    const type = PARAM_TYPES[(children[i + 1] as unknown as { selected_index: number }).selected_index - 1] ?? "value"
    if (name !== "") list.push({ name, type })
  }
  return list
}

/** Свободное имя нового параметра: p1, p2… */
function newParamName(list: GraphParam[]): string {
  let n = 1
  while (list.some((p) => p.name === `p${n}`)) n++
  return `p${n}`
}

/** Узел «Вызвать»: список функций своей схемы и библиотек команды («отвезти — lib/Доставка»). */
function addFunctionPicker(parent: LuaGuiElement, ws: Workshop, node: WorkshopNode): void {
  const choices = callChoices(ws)
  const library = callLibrary(node) ?? ""
  const names = choices.map((c) => c.name)
  const libraries = choices.map((c) => c.library ?? "")
  const items: LocalisedString[] = choices.map((c) => (c.library === undefined ? c.name : `${c.name} — ${c.library}`))
  let selected = choices.findIndex((c) => c.name === node.values.name && (c.library ?? "") === library) + 1
  // Выбранной функции больше нет (узел «Функция» убрали, библиотеку переименовали вне игры) — показать её как есть.
  if (selected === 0 && typeof node.values.name === "string" && node.values.name !== "") {
    names.unshift(node.values.name)
    libraries.unshift(library)
    items.unshift(library === "" ? node.values.name : `${node.values.name} — ${library}`)
    selected = 1
  }
  if (items.length === 0) {
    const label = parent.add({ type: "label", caption: ["automaton-workshop.no-functions"] })
    label.style.single_line = false
    label.style.maximal_width = 300
    return
  }
  const dropdown = parent.add({ type: "drop-down", items, selected_index: selected, tags: { action: "workshop-call-pick", names, libraries } })
  dropdown.style.maximal_width = 360
}

function editedNode(player: LuaPlayer): { ws: Workshop; node: WorkshopNode } | undefined {
  const ws = currentWorkshop(player)
  const visitor = visitorOf(player)
  const node = visitor?.editing === undefined ? undefined : ws?.nodes[visitor.editing]
  return ws === undefined || node === undefined || !node.body.valid ? undefined : { ws, node }
}

/** Новые параметры функции: разъёмы её и вызовов — заново; окно — заново, если поменялись строки таблицы. */
function setParams(player: LuaPlayer, list: GraphParam[], reopen: boolean): void {
  setValue(player, "params", list.length === 0 ? "" : formatParams(list))
  const edited = editedNode(player)
  if (reopen && edited !== undefined) openNodeWindow(player, edited.ws, edited.node)
}

/** Узлы, чьи разъёмы зависят от этой настройки (переменная, функция, параметр) — обновить все. */
const SHAPING = ["name", "type", "params", "returns"]

/** Входы узла в окне: поменялись — окно открыть заново (иначе — нет: поле ввода не теряет фокус). */
function inputsKey(ws: Workshop, node: WorkshopNode): string {
  return slotsOf(ws, node)
    .slots.filter((s) => s.side === "in" && !s.exec)
    .map((s) => `${s.key}:${s.spec?.type}`)
    .join(",")
}

/** Машина, выбранная игроком для отладки в мастерской. */
function debugRecord(player: LuaPlayer): MachineRecord | undefined {
  const id = visitorOf(player)?.debugRobot
  return id === undefined ? undefined : storage.machines[id]
}

function setValue(player: LuaPlayer, key: string, value: GraphValue | undefined): void {
  const edited = editedNode(player)
  if (edited === undefined) return
  const { ws, node } = edited
  const before = inputsKey(ws, node)
  node.values[key] = value
  // Новый тип — значение своего типа: «0» от числа предмету не подходит; поле — другое (выбор предмета, галочка).
  const typed = key === "type" ? TYPED_VALUE[node.kind] : undefined
  if (typed !== undefined) node.values[typed] = typedDefault(settingType(value, "value"))
  if (SHAPING.includes(key) && (NODES[node.kind]?.settings ?? []).some((s) => s.id === key)) {
    for (const [, other] of pairs(ws.nodes)) if (other.body.valid) refreshNode(ws, other)
    if (typed !== undefined || inputsKey(ws, node) !== before) openNodeWindow(player, ws, node)
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
  onWorkshopEnter((player, ws) => {
    refreshLibraryCalls(ws)
    openAll(player, ws)
  })
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
  onGuiClick("workshop-mover", (player) => {
    const hand = player.cursor_stack
    if (hand === undefined || currentWorkshop(player) === undefined) return
    hand.clear()
    hand.set_stack({ name: NODE_MOVER })
  })
  onGuiClick("workshop-node-delete", (player) => {
    const ws = currentWorkshop(player)
    const nodeId = visitorOf(player)?.editing
    closeNodeWindow(player)
    if (ws !== undefined && nodeId !== undefined) removeNode(ws, nodeId)
  })
  onGuiClick("workshop-wire", (player, element) => {
    const wire = (element.tags as unknown as { wire?: string }).wire
    if (wire === "red-wire" || wire === "green-wire") giveWire(player, wire)
  })
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
  onGuiChange("workshop-param-name", (player, element) => setParams(player, paramRows(element.parent!), false))
  onGuiSelection("workshop-param-type", (player, element) => setParams(player, paramRows(element.parent!), false))
  onGuiClick("workshop-param-remove", (player, element) => setParams(player, paramRows(element.parent!, element), true))
  onGuiClick("workshop-param-add", (player, element) => {
    const list = paramRows(element.parent![PARAMS_TABLE]!)
    list.push({ name: newParamName(list), type: "number" })
    setParams(player, list, true)
  })
  onGuiSelection("workshop-call-pick", (player, element) => {
    const edited = editedNode(player)
    if (edited === undefined) return
    const tags = element.tags as unknown as { names: string[]; libraries: string[] }
    const index = (element as unknown as { selected_index: number }).selected_index
    const name = tags.names[index - 1]
    const library = tags.libraries[index - 1]
    const choice = callChoices(edited.ws).find((c) => c.name === name && (c.library ?? "") === library)
    if (choice === undefined) return
    applyCall(edited.node.values, choice)
    for (const [, other] of pairs(edited.ws.nodes)) if (other.body.valid) refreshNode(edited.ws, other)
    openNodeWindow(player, edited.ws, edited.node)
  })
  onGuiSelection("workshop-value", (player, element) => {
    const tags = element.tags as { key: string; options: string }
    const options = tags.options.split("|")
    setValue(player, tags.key, options[(element as unknown as { selected_index: number }).selected_index - 1])
  })
  // Клик по узлу пустой рукой — окно настроек; клик проводом по разъёму — проверка цвета провода.
  onCustomInput("automaton-open", (e) => {
    const player = game.get_player(e.player_index)
    const selected = player?.selected
    if (player === undefined || selected === undefined) return
    if (isPin(selected.name)) {
      const hand = player.cursor_stack
      if (hand?.valid_for_read && (hand.name === "red-wire" || hand.name === "green-wire")) checkWiresLater(player, selected)
      return
    }
    if (!isNodeBody(selected.name)) return
    if (player.cursor_stack?.valid_for_read || player.cursor_ghost !== undefined) return
    const found = nodeOfEntity(selected)
    if (found !== undefined) openNodeWindow(player, found.ws, found.node)
  })
  // Новая версия схемы не из этой мастерской (импорт строкой) — мастерская строится заново. Пересборка из-за новой
  // версии библиотеки схему не меняет — черновик остаётся.
  onProgramPublished((program) => {
    if (publishing.fromWorkshop || program.graph === undefined) return
    if (program.history[program.history.length - 1]?.rebuiltFor !== undefined) return
    const ws = workshopOf(program.id)
    if (ws !== undefined) buildGraph(ws, program.graph)
  })
  // Библиотеку переименовали — вызовы её функций в мастерских под новым именем.
  onProgramRenamed((program, oldName) => renameLibraryCalls(program.force, oldName, program.name))
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
    wire: (index: number, wire: string) => {
      const player = playerOf(index)
      if (player !== undefined && currentWorkshop(player) !== undefined && (wire === "red-wire" || wire === "green-wire")) giveWire(player, wire)
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
    values: (name: string, node: number) => workshopNamed(name)?.nodes[node]?.values,
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
