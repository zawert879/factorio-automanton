// Схема программы (этап 15): узлы, провода и значения входов — простые данные. Хранится в записи программы
// и в строке обмена; мастерская (здания на поверхности) — вид черновика, читается в эти данные и строится из них.

/** Тип разъёма: порядок действий (красный провод) или данные (зелёный). */
export type PinType =
  | "exec"
  | "number"
  | "boolean"
  | "string"
  | "item"
  | "fluid"
  | "position"
  | "entity"
  | "robot"
  | "marker"
  | "zone"
  | "target"
  | "entities"
  | "robots"
  | "enemy"
  | "enemies"
  | "targets"
  | "message"
  | "task"
  | "value"
  | "list"

export type GraphValue = string | number | boolean

export interface GraphNode {
  /** Номер узла в схеме — постоянный, на него ссылаются провода. */
  id: number
  kind: string
  /** Левый верхний угол в мастерской, клетки. */
  x: number
  y: number
  /** Значения входов без провода и настройки узла (имя переменной, тип, оператор). */
  values: Record<string, GraphValue | undefined>
}

/** Провод: выход `out` узла `from` → вход `in` узла `to`. */
export interface GraphWire {
  from: number
  out: string
  to: number
  in: string
}

export interface Graph {
  nodes: GraphNode[]
  wires: GraphWire[]
}

/** Ошибка схемы — на узле (и разъёме, если дело в нём). */
export interface GraphDiagnostic {
  node: number
  code: string
  params: (string | number)[]
  pin?: string
}

/** Тип TypeScript для значения разъёма. */
export const TS_TYPES: Record<Exclude<PinType, "exec">, string> = {
  number: "number",
  boolean: "boolean",
  string: "string",
  item: "Item",
  fluid: "Fluid",
  position: "Position",
  entity: "Entity",
  robot: "Robot",
  marker: "Marker",
  zone: "Zone",
  target: "Target",
  entities: "Entity[]",
  robots: "Robot[]",
  enemy: "Enemy",
  enemies: "Enemy[]",
  targets: "Target[]",
  message: "Message",
  task: "Task<Value>",
  value: "Value",
  list: "Value[]",
}

/** Элемент списка: «для каждого», «первый». */
export const ELEMENT_TYPES: Partial<Record<PinType, PinType>> = {
  entities: "entity",
  robots: "robot",
  enemies: "enemy",
  targets: "target",
  list: "value",
}

/** Можно ли провести провод из выхода типа `from` во вход типа `to`. */
export function assignable(from: PinType, to: PinType): boolean {
  if (from === to) return true
  if (from === "exec" || to === "exec") return false
  switch (to) {
    case "value":
      return from !== "target" && from !== "marker" && from !== "zone" && from !== "message" && from !== "task" && from !== "targets" && from !== "enemy" && from !== "enemies"
    case "target":
      return from === "position" || from === "entity" || from === "robot" || from === "marker" || from === "zone"
    case "string":
      return from === "item" || from === "fluid"
    case "item":
    case "fluid":
      return from === "string"
    case "list":
      return from === "entities" || from === "robots"
    case "targets":
      return false
    default:
      return false
  }
}

/** Пустая схема программы: один узел «Старт». */
export function emptyGraph(): Graph {
  return { nodes: [{ id: 1, kind: "start", x: 0, y: 0, values: {} }], wires: [] }
}

export function nextNodeId(graph: Graph): number {
  let max = 0
  for (const node of graph.nodes) if (node.id > max) max = node.id
  return max + 1
}

/** Схема из чужих данных (строка обмена, JSON): только узнаваемые поля, иначе undefined. */
export function sanitizeGraph(raw: unknown): Graph | undefined {
  if (type(raw) !== "table") return undefined
  const data = raw as { nodes?: unknown; wires?: unknown }
  const nodes: GraphNode[] = []
  const wires: GraphWire[] = []
  for (const item of (type(data.nodes) === "table" ? data.nodes : []) as Record<string, unknown>[]) {
    if (typeof item?.id !== "number" || typeof item.kind !== "string" || typeof item.x !== "number" || typeof item.y !== "number") return undefined
    const values: Record<string, GraphValue | undefined> = {}
    if (type(item.values) === "table") {
      for (const [key, value] of pairs(item.values as Record<string, unknown>)) {
        if (typeof key === "string" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) values[key] = value
      }
    }
    nodes.push({ id: item.id, kind: item.kind, x: item.x, y: item.y, values })
  }
  for (const item of (type(data.wires) === "table" ? data.wires : []) as Record<string, unknown>[]) {
    if (typeof item?.from !== "number" || typeof item.to !== "number" || typeof item.out !== "string" || typeof item.in !== "string") return undefined
    wires.push({ from: item.from, out: item.out, to: item.to, in: item.in })
  }
  return nodes.length > 0 ? { nodes, wires } : undefined
}
