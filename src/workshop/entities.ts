// Мастерская схем (этап 15): поверхность программы, здания узлов и разъёмов, вид узла (rendering), чтение схемы
// с поверхности (узлы и провода) и постройка поверхности из схемы. Узлы из палитры и вставка (Ctrl+V) приходят
// призраками — они сразу оживают; разъёмы узла ищутся по месту, недостающие ставятся заново.
import { Color, LocalisedString, LuaEntity, LuaSurface, MapGenSettingsWrite, MapPosition, Tags } from "factorio:runtime"
import { blueprintOf } from "../automaton/blueprints"
import { onEvent, onTick } from "../events"
import { resolvePins } from "../graph/codegen"
import { Graph, GraphNode, GraphValue, GraphWire, emptyGraph } from "../graph/model"
import { Category, NODES, PinSpec } from "../graph/nodes"
import { escapeRichText } from "../lang/highlight"
import { NODE_BODY_PREFIX, NODE_MAX_HEIGHT, NODE_MIN_HEIGHT, NODE_WIDTH, PIN_DATA, PIN_EXEC, WORKSHOP_SURFACE_PREFIX } from "../names"
import { Workshop, WorkshopNode, workshopState } from "./state"

export const NODE_TAG = "automaton_node"

export interface NodeTag {
  kind: string
  values: Record<string, GraphValue | undefined>
  /** Узел, с которого снят чертёж (программа и номер): вырезанный узел при вставке отдаёт новому свои провода. */
  from?: { programId: number; node: number }
}

const COLORS: Record<Category, Color> = {
  flow: { r: 0.9, g: 0.8, b: 0.38 },
  move: { r: 0.47, g: 0.68, b: 0.88 },
  items: { r: 0.91, g: 0.66, b: 0.36 },
  buildings: { r: 0.82, g: 0.62, b: 0.42 },
  fluids: { r: 0.42, g: 0.8, b: 0.86 },
  energy: { r: 0.95, g: 0.56, b: 0.3 },
  vision: { r: 0.51, g: 0.78, b: 0.51 },
  map: { r: 0.56, g: 0.8, b: 0.66 },
  me: { r: 0.85, g: 0.58, b: 0.63 },
  objects: { r: 0.72, g: 0.76, b: 0.56 },
  values: { r: 0.76, g: 0.76, b: 0.76 },
  logic: { r: 0.62, g: 0.85, b: 0.6 },
  variables: { r: 0.86, g: 0.56, b: 0.62 },
  functions: { r: 0.74, g: 0.64, b: 0.87 },
  output: { r: 0.72, g: 0.72, b: 0.72 },
  team: { r: 0.74, g: 0.64, b: 0.87 },
  combat: { r: 0.9, g: 0.46, b: 0.4 },
}
const RED: Color = { r: 0.88, g: 0.27, b: 0.23 }
const GREEN: Color = { r: 0.31, g: 0.76, b: 0.31 }
const DARK: Color = { r: 0.09, g: 0.09, b: 0.09 }
const LABEL: Color = { r: 0.9, g: 0.9, b: 0.9 }
const ERROR: Color = { r: 1, g: 0.35, b: 0.3 }

export function isNodeBody(name: string): boolean {
  return string.sub(name, 1, NODE_BODY_PREFIX.length) === NODE_BODY_PREFIX
}

export function isPin(name: string): boolean {
  return name === PIN_EXEC || name === PIN_DATA
}

export function isWorkshopEntity(name: string): boolean {
  return isNodeBody(name) || isPin(name)
}

/** Номер программы, чья это мастерская; не мастерская — undefined. */
export function workshopProgram(surface: LuaSurface): number | undefined {
  if (string.sub(surface.name, 1, WORKSHOP_SURFACE_PREFIX.length) !== WORKSHOP_SURFACE_PREFIX) return undefined
  return tonumber(string.sub(surface.name, WORKSHOP_SURFACE_PREFIX.length + 1))
}

export function workshopOf(programId: number): Workshop | undefined {
  const ws = workshopState().byProgram[programId]
  return ws !== undefined && ws.surface.valid ? ws : undefined
}

/** Мастерская программы: создать поверхность и построить на ней схему (или пустую — со «Стартом»). */
export function ensureWorkshop(programId: number, force: string, graph: Graph | undefined): Workshop {
  const existing = workshopOf(programId)
  if (existing !== undefined) return existing
  const name = `${WORKSHOP_SURFACE_PREFIX}${programId}`
  // Без руды, деревьев, камней и врагов: только пол из лабораторной плитки.
  const nothing = { treat_missing_as_default: false, settings: {} }
  const settings = { peaceful_mode: true, default_enable_all_autoplace_controls: false, autoplace_settings: { entity: nothing, decorative: nothing, tile: nothing } }
  const surface = game.get_surface(name) ?? game.create_surface(name, settings as unknown as MapGenSettingsWrite)
  surface.generate_with_lab_tiles = true
  surface.always_day = true
  surface.show_clouds = false
  surface.request_to_generate_chunks({ x: 32, y: 16 }, 3)
  surface.force_generate_chunk_requests()
  const ws: Workshop = { programId, force, surface, nextId: 1, nodes: {} }
  workshopState().byProgram[programId] = ws
  buildGraph(ws, graph ?? emptyGraph())
  return ws
}

/** Удалить мастерскую (программу удалили). */
export function deleteWorkshop(programId: number): void {
  const state = workshopState()
  const ws = state.byProgram[programId]
  if (ws === undefined) return
  for (const [, node] of pairs(ws.nodes)) forgetNode(node)
  state.byProgram[programId] = undefined
  if (ws.surface.valid) game.delete_surface(ws.surface)
}

// ---------- Разъёмы узла ----------

export interface PinSlot {
  key: string
  side: "in" | "out"
  exec: boolean
  row: number
  spec?: PinSpec
}

/** Схема из узлов мастерской без проводов — для разъёмов (переменные, функции зависят от других узлов). */
function nodesView(ws: Workshop): Graph {
  const nodes: GraphNode[] = []
  for (const [, node] of pairs(ws.nodes)) nodes.push({ id: node.id, kind: node.kind, x: 0, y: 0, values: node.values })
  return { nodes, wires: [] }
}

export function slotsOf(ws: Workshop, node: { id: number; kind: string; values: Record<string, GraphValue | undefined> }): { height: number; slots: PinSlot[] } {
  const pins = resolvePins({ id: node.id, kind: node.kind, x: 0, y: 0, values: node.values }, nodesView(ws))
  const slots: PinSlot[] = []
  let left = 0
  let right = 0
  if (pins !== undefined) {
    if (pins.execIn) slots.push({ key: "in:exec", side: "in", exec: true, row: ++left })
    for (const spec of pins.inputs) slots.push({ key: `in:${spec.id}`, side: "in", exec: false, row: ++left, spec })
    for (const out of pins.execOuts) slots.push({ key: `out:${out}`, side: "out", exec: true, row: ++right })
    for (const spec of pins.outputs) slots.push({ key: `out:${spec.id}`, side: "out", exec: false, row: ++right, spec })
  }
  const height = math.min(NODE_MAX_HEIGHT, math.max(NODE_MIN_HEIGHT, 1 + math.max(1, left, right)))
  return { height, slots }
}

function bodyHeight(body: LuaEntity): number {
  return tonumber(string.sub(body.name, NODE_BODY_PREFIX.length + 1)) ?? NODE_MIN_HEIGHT
}

/** Левый верхний угол узла (клетки) по положению тела. */
export function nodeCorner(body: LuaEntity): MapPosition {
  const h = bodyHeight(body)
  return { x: math.floor(body.position.x - NODE_WIDTH / 2 + 0.5), y: math.floor(body.position.y - h / 2 + 0.5) }
}

function slotPosition(body: LuaEntity, slot: PinSlot): MapPosition {
  const corner = nodeCorner(body)
  return { x: corner.x + (slot.side === "in" ? 0.5 : NODE_WIDTH - 0.5), y: corner.y + slot.row + 0.5 }
}

// ---------- Узлы ----------

/** Поставить узел с левым верхним углом (x, y); место занято — ниже. */
export function addNode(ws: Workshop, kind: string, values: Record<string, GraphValue | undefined>, x: number, y: number, id?: number): WorkshopNode | undefined {
  if (NODES[kind] === undefined) return undefined
  const nodeId = id ?? ws.nextId
  ws.nextId = math.max(ws.nextId, nodeId + 1)
  const { height } = slotsOf(ws, { id: nodeId, kind, values })
  let body: LuaEntity | undefined
  for (let dy = 0; dy < 60 && body === undefined; dy++) {
    const position = { x: x + NODE_WIDTH / 2, y: y + dy + height / 2 }
    const name = `${NODE_BODY_PREFIX}${height}`
    if (ws.surface.can_place_entity({ name, position, force: ws.force })) body = ws.surface.create_entity({ name, position, force: ws.force, create_build_effect_smoke: false })
  }
  if (body === undefined) return undefined
  return registerBody(ws, body, kind, values, nodeId)
}

function registerBody(ws: Workshop, body: LuaEntity, kind: string, values: Record<string, GraphValue | undefined>, id?: number): WorkshopNode {
  const nodeId = id ?? ws.nextId
  ws.nextId = math.max(ws.nextId, nodeId + 1)
  const node: WorkshopNode = { id: nodeId, kind, values, body, pins: {}, renders: [] }
  ws.nodes[nodeId] = node
  workshopState().bodies[body.unit_number!] = { programId: ws.programId, node: nodeId }
  attachPins(ws, node)
  drawNode(ws, node)
  return node
}

/** Разъёмы на местах: свои — оставить, чужие свободные на месте — забрать (вставка), недостающие — поставить. */
function attachPins(ws: Workshop, node: WorkshopNode): void {
  const state = workshopState()
  const { slots } = slotsOf(ws, node)
  const wanted: Record<string, boolean | undefined> = {}
  for (const slot of slots) {
    wanted[slot.key] = true
    const name = slot.exec ? PIN_EXEC : PIN_DATA
    const position = slotPosition(node.body, slot)
    const current = node.pins[slot.key]
    if (current !== undefined && current.valid) {
      if (current.name === name && math.abs(current.position.x - position.x) < 0.01 && math.abs(current.position.y - position.y) < 0.01) continue
      state.pins[current.unit_number!] = undefined
      current.destroy()
    }
    let pin: LuaEntity | undefined
    for (const candidate of ws.surface.find_entities_filtered({ name, position, radius: 0.1 })) {
      if (state.pins[candidate.unit_number!] === undefined) {
        pin = candidate
        break
      }
    }
    pin ??= ws.surface.create_entity({ name, position, force: ws.force, create_build_effect_smoke: false })
    if (pin === undefined) continue
    node.pins[slot.key] = pin
    state.pins[pin.unit_number!] = { programId: ws.programId, node: node.id, key: slot.key }
    drawPin(pin, slot.exec)
  }
  for (const [key, pin] of pairs(node.pins)) {
    if (wanted[key]) continue
    if (pin.valid) {
      state.pins[pin.unit_number!] = undefined
      pin.destroy()
    }
    node.pins[key] = undefined
  }
}

function drawPin(pin: LuaEntity, exec: boolean): void {
  const surface = pin.surface
  if (exec) {
    rendering.draw_polygon({
      color: RED,
      vertices: [
        { entity: pin, offset: [-0.18, -0.22] },
        { entity: pin, offset: [0.24, 0] },
        { entity: pin, offset: [-0.18, 0.22] },
      ],
      surface,
    })
  } else {
    rendering.draw_circle({ color: DARK, radius: 0.2, filled: true, target: { entity: pin }, surface })
    rendering.draw_circle({ color: GREEN, radius: 0.15, filled: true, target: { entity: pin }, surface })
  }
}

/** Значение входа в подписи узла: предмет и жидкость — значком, текст — в кавычках. */
function valueText(value: GraphValue, spec: PinSpec | undefined): string {
  if (typeof value === "boolean") return value ? "✔" : "✘"
  if (typeof value === "number") return `${value}`
  if (spec?.type === "item" && prototypes.item[value] !== undefined) return `[item=${value}]`
  if (spec?.type === "fluid" && prototypes.fluid[value] !== undefined) return `[fluid=${value}]`
  return `«${escapeRichText(value)}»`
}

/** Что показать в заголовке рядом с названием: имя переменной, функции, параметра, оператор, константу. */
function titleDetail(node: WorkshopNode): string | undefined {
  const v = node.values
  switch (node.kind) {
    case "param":
    case "variable":
    case "variable-get":
    case "variable-set":
    case "function":
    case "call":
      return v.name === undefined ? undefined : escapeRichText(`${v.name}`)
    case "compare":
    case "math":
    case "equals":
      return v.op === undefined ? undefined : escapeRichText(`${v.op}`)
    case "number":
    case "text":
    case "flag":
      return v.value === undefined ? undefined : valueText(v.value, { id: "value", type: node.kind === "number" ? "number" : node.kind === "flag" ? "boolean" : "string" })
    case "item":
      return v.value === undefined ? undefined : valueText(v.value, { id: "value", type: "item" })
    case "find-in-zone":
      return v.by === "type" ? "type" : undefined
  }
  return undefined
}

export function drawNode(ws: Workshop, node: WorkshopNode): void {
  for (const render of node.renders) if (render.valid) render.destroy()
  node.renders = []
  const body = node.body
  const surface = ws.surface
  const spec = NODES[node.kind]
  const h = bodyHeight(body)
  const halfW = NODE_WIDTH / 2
  const top = -h / 2
  const color = spec === undefined ? COLORS.values : COLORS[spec.category]
  node.renders.push(
    rendering.draw_rectangle({
      color,
      filled: true,
      left_top: { entity: body, offset: [-halfW + 0.55, top + 0.05] },
      right_bottom: { entity: body, offset: [halfW - 0.55, top + 0.95] },
      surface,
    }),
  )
  const detail = titleDetail(node)
  const title: LocalisedString = detail === undefined ? [`automaton-node.${node.kind}`] : ["", [`automaton-node.${node.kind}`], `  ${detail}`]
  node.renders.push(
    rendering.draw_text({
      text: title,
      surface,
      target: { entity: body, offset: [-halfW + 0.75, top + 0.12] },
      color: DARK,
      scale: 1.25,
      font: "default-bold",
      alignment: "left",
      use_rich_text: true,
    }),
  )
  const { slots } = slotsOf(ws, node)
  for (const slot of slots) {
    const y = top + slot.row + 0.5
    const id = string.sub(slot.key, slot.side === "in" ? 4 : 5)
    if (slot.exec && id === "exec") continue
    // Параметры функций — свои имена (могут быть кириллицей), остальное — из локали.
    const custom = !slot.exec && (node.kind === "function" || (node.kind === "call" && slot.side === "in"))
    const label: LocalisedString = custom ? escapeRichText(id) : [`automaton-pin.${id}`]
    const value = slot.side === "in" ? node.values[id] ?? slot.spec?.default : undefined
    const text: LocalisedString = value === undefined || value === "" ? label : ["", label, `  [color=1,0.72,0.3]${valueText(value, slot.spec)}[/color]`]
    node.renders.push(
      rendering.draw_text({
        text,
        surface,
        target: { entity: body, offset: [slot.side === "in" ? -halfW + 0.85 : halfW - 0.85, y] },
        color: slot.exec ? { r: 1, g: 0.75, b: 0.7 } : LABEL,
        scale: 1.1,
        alignment: slot.side === "in" ? "left" : "right",
        vertical_alignment: "middle",
        use_rich_text: true,
      }),
    )
  }
  if (node.error !== undefined) {
    node.renders.push(
      rendering.draw_rectangle({
        color: ERROR,
        width: 4,
        filled: false,
        left_top: { entity: body, offset: [-halfW + 0.35, top - 0.15] },
        right_bottom: { entity: body, offset: [halfW - 0.35, -top + 0.15] },
        surface,
      }),
      rendering.draw_text({
        text: node.error,
        surface,
        target: { entity: body, offset: [-halfW + 0.5, -top + 0.25] },
        color: ERROR,
        scale: 1,
        alignment: "left",
      }),
    )
  }
}

/** Заново: разъёмы (настройки поменяли их набор) и вид. */
export function refreshNode(ws: Workshop, node: WorkshopNode): void {
  const { height } = slotsOf(ws, node)
  if (height !== bodyHeight(node.body)) {
    // Другая высота — другое тело на том же месте.
    const corner = nodeCorner(node.body)
    const state = workshopState()
    state.bodies[node.body.unit_number!] = undefined
    node.body.destroy()
    const name = `${NODE_BODY_PREFIX}${height}`
    const body = ws.surface.create_entity({ name, position: { x: corner.x + NODE_WIDTH / 2, y: corner.y + height / 2 }, force: ws.force, create_build_effect_smoke: false })
    if (body === undefined) return
    node.body = body
    state.bodies[body.unit_number!] = { programId: ws.programId, node: node.id }
  }
  attachPins(ws, node)
  drawNode(ws, node)
}

function forgetNode(node: WorkshopNode): void {
  const state = workshopState()
  for (const render of node.renders) if (render.valid) render.destroy()
  for (const [, pin] of pairs(node.pins)) {
    if (!pin.valid) continue
    state.pins[pin.unit_number!] = undefined
    pin.destroy()
  }
  if (node.body.valid) state.bodies[node.body.unit_number!] = undefined
}

export function removeNode(ws: Workshop, nodeId: number): void {
  const node = ws.nodes[nodeId]
  if (node === undefined) return
  forgetNode(node)
  if (node.body.valid) node.body.destroy()
  ws.nodes[nodeId] = undefined
}

/** Узел по зданию (телу или разъёму). */
export function nodeOfEntity(entity: LuaEntity): { ws: Workshop; node: WorkshopNode } | undefined {
  if (entity.unit_number === undefined) return undefined
  const state = workshopState()
  const ref = state.bodies[entity.unit_number] ?? state.pins[entity.unit_number]
  if (ref === undefined) return undefined
  const ws = workshopOf(ref.programId)
  const node = ws?.nodes[ref.node]
  return ws !== undefined && node !== undefined ? { ws, node } : undefined
}

// ---------- Схема ↔ поверхность ----------

export interface WireProblem {
  node: number
  code: string
}

/** Схема с поверхности: узлы (место — по телу) и провода между разъёмами. */
export function readGraph(ws: Workshop): { graph: Graph; problems: WireProblem[] } {
  const state = workshopState()
  const nodes: GraphNode[] = []
  const ids: number[] = []
  for (const [id, node] of pairs(ws.nodes)) {
    if (!node.body.valid) {
      ws.nodes[id] = undefined
      continue
    }
    ids.push(id)
  }
  table.sort(ids)
  for (const id of ids) {
    const node = ws.nodes[id]!
    const corner = nodeCorner(node.body)
    nodes.push({ id, kind: node.kind, x: corner.x, y: corner.y, values: node.values })
  }
  const wires: GraphWire[] = []
  const problems: WireProblem[] = []
  const seen: Record<string, boolean | undefined> = {}
  for (const id of ids) {
    const node = ws.nodes[id]!
    for (const [key, pin] of pairs(node.pins)) {
      if (!pin.valid) continue
      for (const connectorId of [defines.wire_connector_id.circuit_red, defines.wire_connector_id.circuit_green]) {
        const connector = pin.get_wire_connector(connectorId, false)
        if (connector === undefined) continue
        for (const connection of connector.connections) {
          const other = connection.target.owner
          if (!other.valid || other.unit_number === undefined) continue
          const ref = state.pins[other.unit_number]
          if (ref === undefined || ref.programId !== ws.programId) continue
          const a = `${id}/${key}`
          const b = `${ref.node}/${ref.key}`
          const pair = a < b ? `${a}|${b}` : `${b}|${a}`
          if (seen[pair]) continue
          seen[pair] = true
          const thisOut = string.sub(key, 1, 4) === "out:"
          const otherOut = string.sub(ref.key, 1, 4) === "out:"
          if (thisOut === otherOut) {
            problems.push({ node: id, code: thisOut ? "graph-wire-two-outputs" : "graph-wire-two-inputs" })
            continue
          }
          const [from, out, to, input] = thisOut ? [id, key, ref.node, ref.key] : [ref.node, ref.key, id, key]
          wires.push({ from, out: string.sub(out, 5), to, in: string.sub(input, 4) })
        }
      }
    }
  }
  table.sort(wires, (x, y) => (x.from !== y.from ? x.from < y.from : x.to !== y.to ? x.to < y.to : x.out < y.out))
  return { graph: { nodes, wires }, problems }
}

/** Построить схему на поверхности заново (прежние узлы убираются). */
export function buildGraph(ws: Workshop, graph: Graph): void {
  for (const [id] of pairs(ws.nodes)) removeNode(ws, id)
  for (const entity of ws.surface.find_entities_filtered({ name: [PIN_EXEC, PIN_DATA] })) entity.destroy()
  ws.nextId = 1
  for (const node of graph.nodes) addNode(ws, node.kind, { ...node.values }, node.x, node.y, node.id)
  for (const wire of graph.wires) {
    const from = ws.nodes[wire.from]?.pins[`out:${wire.out}`]
    const to = ws.nodes[wire.to]?.pins[`in:${wire.in}`]
    if (from === undefined || to === undefined || !from.valid || !to.valid) continue
    const color = wire.in === "exec" ? defines.wire_connector_id.circuit_red : defines.wire_connector_id.circuit_green
    from.get_wire_connector(color, true)!.connect_to(to.get_wire_connector(color, true)!, false)
  }
}

// ---------- События ----------

/**
 * Вставленный разъём (Ctrl+V): на нём провода вставки. Тело уже стоит — разъём занимает своё место (прежний,
 * поставленный при оживлении тела, убирается); тела ещё нет — ждёт его тик (тело заберёт разъём по месту).
 */
function adoptOrDefer(ws: Workshop, pin: LuaEntity): void {
  const state = workshopState()
  if (state.pins[pin.unit_number!] !== undefined) return
  const exec = pin.name === PIN_EXEC
  const names: string[] = []
  for (let h = NODE_MIN_HEIGHT; h <= NODE_MAX_HEIGHT; h++) names.push(`${NODE_BODY_PREFIX}${h}`)
  for (const body of ws.surface.find_entities_filtered({ name: names, position: pin.position, radius: NODE_WIDTH + NODE_MAX_HEIGHT })) {
    const ref = state.bodies[body.unit_number!]
    const node = ref === undefined ? undefined : ws.nodes[ref.node]
    if (node === undefined) continue
    for (const slot of slotsOf(ws, node).slots) {
      if (slot.exec !== exec) continue
      const at = slotPosition(body, slot)
      if (math.abs(at.x - pin.position.x) > 0.01 || math.abs(at.y - pin.position.y) > 0.01) continue
      const old = node.pins[slot.key]
      if (old !== undefined && old.valid) {
        // Провода, уже переданные прежнему разъёму (вставка вырезанного), — новому.
        transferConnections(old, pin)
        state.pins[old.unit_number!] = undefined
        old.destroy()
      }
      node.pins[slot.key] = pin
      state.pins[pin.unit_number!] = { programId: ws.programId, node: node.id, key: slot.key }
      drawPin(pin, exec)
      return
    }
  }
  state.orphans.push(pin)
}

function handleBuilt(entity: LuaEntity, tags: Tags | undefined): void {
  if (!entity.valid) return
  const ghost = entity.name === "entity-ghost"
  const name = ghost ? entity.ghost_name : entity.name
  if (!isWorkshopEntity(name)) return
  const programId = workshopProgram(entity.surface)
  const ws = programId === undefined ? undefined : workshopOf(programId)
  if (ws === undefined) {
    // Узлы — только в мастерской.
    entity.destroy()
    return
  }
  if (ghost) {
    const ghostTags = entity.tags ?? tags
    const [, revived] = entity.revive()
    if (revived !== undefined) handleBuilt(revived, ghostTags)
    return
  }
  const state = workshopState()
  if (isPin(name)) {
    adoptOrDefer(ws, entity)
    return
  }
  if (state.bodies[entity.unit_number!] !== undefined) return
  const tag = tags?.[NODE_TAG] as NodeTag | undefined
  if (tag === undefined || NODES[tag.kind] === undefined) {
    entity.destroy()
    return
  }
  const values: Record<string, GraphValue | undefined> = {}
  for (const [key, value] of pairs(tag.values ?? {})) values[key] = value as GraphValue
  const node = registerBody(ws, entity, tag.kind, values)
  // Вставка вырезанного (Ctrl+X → Ctrl+V): прежний узел ещё стоит, помеченный к разбору, — его провода
  // к узлам вне рамки переходят новому, сам он убирается. Копия (прежний не помечен) проводов не забирает.
  const old = tag.from?.programId === ws.programId ? ws.nodes[tag.from.node] : undefined
  if (old !== undefined && old !== node && old.body.valid && old.body.to_be_deconstructed()) {
    moveExternalWires(old, node)
    removeNode(ws, old.id)
  }
}

/** Провода прежнего узла к узлам, которые не переезжают (не помечены к разбору), — на те же разъёмы нового. */
function moveExternalWires(old: WorkshopNode, node: WorkshopNode): void {
  const state = workshopState()
  for (const [key, pin] of pairs(old.pins)) {
    const target = node.pins[key]
    if (!pin.valid || target === undefined || !target.valid) continue
    for (const id of [defines.wire_connector_id.circuit_red, defines.wire_connector_id.circuit_green]) {
      const connector = pin.get_wire_connector(id, false)
      if (connector === undefined) continue
      for (const connection of connector.connections) {
        const other = connection.target.owner
        const ref = other.valid && other.unit_number !== undefined ? state.pins[other.unit_number] : undefined
        const owner = ref === undefined ? undefined : workshopOf(ref.programId)?.nodes[ref.node]
        if (owner === undefined || owner === old || owner.body.to_be_deconstructed()) continue
        target.get_wire_connector(id, true)!.connect_to(connection.target, false)
      }
    }
  }
}

/** Перенести провода разъёма на другой (тот же разъём узла после вставки). */
function transferConnections(from: LuaEntity, to: LuaEntity): void {
  for (const id of [defines.wire_connector_id.circuit_red, defines.wire_connector_id.circuit_green]) {
    const connector = from.get_wire_connector(id, false)
    if (connector === undefined) continue
    for (const connection of connector.connections) {
      if (connection.target.owner !== to) to.get_wire_connector(id, true)!.connect_to(connection.target, false)
    }
  }
}

export function registerWorkshopEntities(): void {
  onEvent(defines.events.on_built_entity, (e) => handleBuilt(e.entity, e.tags))
  onEvent(defines.events.on_robot_built_entity, (e) => handleBuilt(e.entity, e.tags))
  onEvent(defines.events.script_raised_built, (e) => handleBuilt(e.entity, undefined))
  onEvent(defines.events.script_raised_revive, (e) => handleBuilt(e.entity, e.tags))
  // Вырезать и разобрать в мастерской — сразу, без роботов.
  onEvent(defines.events.on_marked_for_deconstruction, (e) => {
    const entity = e.entity
    if (!entity.valid || workshopProgram(entity.surface) === undefined) return
    // Вырезать (Ctrl+X): узел ждёт вставки — тогда отдаст провода и уйдёт; планировщик разбора — убрать сразу.
    const player = e.player_index === undefined ? undefined : game.get_player(e.player_index)
    const cutting = player?.cursor_stack?.valid_for_read === true && player.cursor_stack.name === "cut-paste-tool"
    if (cutting && isNodeBody(entity.name)) return
    if (isNodeBody(entity.name)) {
      const found = nodeOfEntity(entity)
      if (found !== undefined) removeNode(found.ws, found.node.id)
      else entity.destroy()
    } else if (isPin(entity.name)) {
      // Разъём живёт с узлом.
      entity.cancel_deconstruction(entity.force)
    } else if (entity.name === "entity-ghost") {
      entity.destroy()
    }
  })
  onEvent(defines.events.on_player_mined_entity, (e) => {
    const entity = e.entity
    if (!isNodeBody(entity.name)) return
    const found = nodeOfEntity(entity)
    if (found === undefined) return
    forgetNode(found.node)
    found.ws.nodes[found.node.id] = undefined
  })
  onEvent(defines.events.on_gui_opened, (e) => {
    const entity = e.entity
    if (entity === undefined || !isPin(entity.name)) return
    const player = game.get_player(e.player_index)
    if (player !== undefined) player.opened = undefined
  })
  onTick(() => {
    const state = storage.workshop
    if (state === undefined || state.orphans.length === 0) return
    for (const pin of state.orphans) if (pin.valid && state.pins[pin.unit_number!] === undefined) pin.destroy()
    state.orphans = []
  })
  onEvent(defines.events.on_player_setup_blueprint, (e) => {
    const player = game.get_player(e.player_index)
    if (player === undefined || workshopProgram(e.surface) === undefined) return
    const blueprint = blueprintOf(player, e.stack, e.record)
    if (blueprint === undefined) return
    const entities = blueprint.get_blueprint_entities()
    if (entities === undefined) return
    const mapping = e.mapping.get()
    let changed = false
    const updated = entities.map((entity) => {
      const source = mapping[entity.entity_number]
      if (source === undefined || !source.valid || !isNodeBody(source.name)) return entity
      const tag = nodeTag(source)
      if (tag === undefined) return entity
      changed = true
      return { ...entity, tags: { ...(entity.tags ?? {}), [NODE_TAG]: tag as unknown as Tags[string] } }
    })
    if (changed) blueprint.set_blueprint_entities(updated)
  })
}

/** Теги тел узлов для чертежа (вырезать, копировать): вид узла и значения. */
export function nodeTag(entity: LuaEntity): NodeTag | undefined {
  const found = nodeOfEntity(entity)
  if (found === undefined || found.node.body !== entity) return undefined
  return { kind: found.node.kind, values: found.node.values, from: { programId: found.ws.programId, node: found.node.id } }
}
