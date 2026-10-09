// Сборка схемы кодом (тесты, примеры-схемы для снимков): узлы, провода порядка и данных, раскладка по клеткам.
import { Graph, GraphNode, GraphValue } from "./model"
import { NODES } from "./nodes"
import { resolvePins } from "./codegen"
import { NODE_WIDTH } from "../names"

export { NODE_WIDTH }

const GAP_X = 2
const GAP_Y = 1
/** Цепочка длиннее — продолжается строкой ниже (как перенос строки), чтобы схема не уходила далеко вправо. */
const WRAP_WIDTH = 64

/** Высота узла: заголовок и по строке на разъём (входы слева, выходы справа). */
export function nodeHeight(graph: Graph, node: GraphNode): number {
  const pins = resolvePins(node, graph)
  if (pins === undefined) return 2
  const left = pins.inputs.length + (pins.execIn ? 1 : 0)
  const right = pins.outputs.length + pins.execOuts.length
  return 1 + math.max(1, left, right)
}

export class GraphBuilder {
  readonly graph: Graph = { nodes: [], wires: [] }
  private next = 1

  node(kind: string, values: Record<string, GraphValue | undefined> = {}): GraphNode {
    if (NODES[kind] === undefined) error(`нет узла ${kind}`)
    // Настройки узла — по умолчанию, как у узла из палитры.
    const all: Record<string, GraphValue | undefined> = {}
    for (const setting of NODES[kind].settings ?? []) if (setting.default !== undefined) all[setting.id] = setting.default
    for (const [key, value] of pairs(values)) all[key] = value
    const node: GraphNode = { id: this.next++, kind, x: 0, y: 0, values: all }
    this.graph.nodes.push(node)
    return node
  }

  /** Порядок: выход `out` (next, then, else, body, catch) → вход узла `to`. */
  exec(from: GraphNode, to: GraphNode, out = "next"): this {
    this.graph.wires.push({ from: from.id, out, to: to.id, in: "exec" })
    return this
  }

  /** Цепочка действий: каждый следующий — по «дальше» предыдущего. */
  seq(...nodes: GraphNode[]): this {
    for (let i = 1; i < nodes.length; i++) this.exec(nodes[i - 1], nodes[i])
    return this
  }

  /** Данные: выход `out` (по умолчанию первый) узла `from` → вход `pin` узла `to`. */
  data(from: GraphNode, to: GraphNode, pin: string, out?: string): this {
    const pins = resolvePins(from, this.graph)
    const name = out ?? pins?.outputs[0]?.id ?? "value"
    this.graph.wires.push({ from: from.id, out: name, to: to.id, in: pin })
    return this
  }

  /** Разложить узлы: порядок — слева направо, ветки и тела циклов — ниже, данные — левее своего узла. */
  layout(): Graph {
    layoutGraph(this.graph)
    return this.graph
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function layoutGraph(graph: Graph): void {
  const byId: Record<number, GraphNode | undefined> = {}
  for (const node of graph.nodes) byId[node.id] = node
  const placed: Record<number, boolean | undefined> = {}
  const boxes: Box[] = []
  const height = (node: GraphNode) => nodeHeight(graph, node)
  const free = (b: Box) => boxes.every((o) => b.x + b.w + GAP_X <= o.x || o.x + o.w + GAP_X <= b.x || b.y + b.h + GAP_Y <= o.y || o.y + o.h + GAP_Y <= b.y)
  const put = (node: GraphNode, x: number, y: number) => {
    const box = { x, y, w: NODE_WIDTH, h: height(node) }
    while (!free(box)) box.y += 1
    node.x = box.x
    node.y = box.y
    boxes.push(box)
    placed[node.id] = true
    return box
  }
  const execOut = (id: number, out: string): GraphNode | undefined => {
    for (const wire of graph.wires) if (wire.from === id && wire.out === out && wire.in === "exec") return byId[wire.to]
    return undefined
  }
  const dataInputs = (id: number): GraphNode[] => {
    const list: GraphNode[] = []
    for (const wire of graph.wires) if (wire.to === id && wire.in !== "exec") {
      const from = byId[wire.from]
      if (from !== undefined && !NODES[from.kind]?.exec && !list.includes(from)) list.push(from)
    }
    return list
  }
  // Данные узла — левее и ниже, рекурсивно (их входы — ещё левее).
  const placeData = (consumer: Box, node: GraphNode) => {
    let row = consumer.y + consumer.h + GAP_Y
    for (const input of dataInputs(node.id)) {
      if (placed[input.id]) continue
      const box = put(input, consumer.x - NODE_WIDTH + 1, row)
      row = box.y + box.h + GAP_Y
      placeData(box, input)
    }
  }
  // Цепочка: узлы вправо; ветки — со следующей колонки, одна под другой. Итог — правый край.
  const chain = (start: GraphNode | undefined, x: number, y: number): number => {
    let node = start
    let right = x
    let row = y
    while (node !== undefined && !placed[node.id]) {
      if (right > x && right + NODE_WIDTH > x + WRAP_WIDTH) {
        right = x
        row = maxBottom() + GAP_Y + 3
      }
      const box = put(node, right, row)
      placeData(box, node)
      right = box.x + NODE_WIDTH + GAP_X
      let branchY = box.y + box.h + GAP_Y + 3
      let widest = right
      for (const branch of NODES[node.kind]?.branches ?? []) {
        const first = execOut(node.id, branch)
        if (first === undefined || placed[first.id]) continue
        const end = chain(first, right, branchY)
        widest = math.max(widest, end)
        branchY = maxBottom() + GAP_Y + 1
      }
      right = widest
      node = execOut(node.id, "next")
    }
    return right
  }
  const maxBottom = () => {
    let bottom = 0
    for (const b of boxes) bottom = math.max(bottom, b.y + b.h)
    return bottom
  }
  let y = 0
  for (const entry of graph.nodes) {
    if (entry.kind !== "start" && entry.kind !== "function") continue
    chain(entry, NODE_WIDTH + GAP_X, y)
    y = maxBottom() + 4
  }
  // Остальное (объявления переменных, отдельные данные) — снизу в ряд.
  let x = 0
  for (const node of graph.nodes) {
    if (placed[node.id]) continue
    const box = put(node, x, y)
    x = box.x + NODE_WIDTH + GAP_X
  }
}
