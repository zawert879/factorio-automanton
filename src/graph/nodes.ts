// Каталог узлов схемы (этап 15): разъёмы, настройки и код каждого вида. Действия (exec) выполняются по красным
// проводам и дают результат, данные (без exec) — выражения, которые пересчитываются при каждом использовании,
// как чистые узлы в Unreal. Порядок (если, циклы, попытка, функции, переменные) собирает src/graph/codegen.ts.
import { GraphNode, GraphValue, PinType } from "./model"

export interface PinSpec {
  id: string
  type: PinType
  /** Можно не подключать и не задавать — аргумент не передаётся. */
  optional?: boolean
  /** Значение в настройках узла по умолчанию (для входа без провода). */
  default?: GraphValue
  /** Выход может быть null (receive, tryReceive, tasks.next): в провод идёт с «!». */
  nullable?: boolean
}

export type SettingKind = "text" | "number" | "boolean" | "enum" | "type" | "params"

export interface SettingSpec {
  id: string
  kind: SettingKind
  options?: string[]
  default?: GraphValue
}

export type Category =
  | "flow"
  | "move"
  | "items"
  | "buildings"
  | "fluids"
  | "energy"
  | "vision"
  | "map"
  | "me"
  | "objects"
  | "values"
  | "logic"
  | "variables"
  | "functions"
  | "output"
  | "team"
  | "combat"

export const CATEGORIES: Category[] = [
  "flow",
  "move",
  "items",
  "buildings",
  "fluids",
  "energy",
  "vision",
  "map",
  "me",
  "objects",
  "values",
  "logic",
  "variables",
  "functions",
  "output",
  "team",
  "combat",
]

export interface CodeContext {
  node: GraphNode
  /** Подключить помощника схемы (функцию в конце кода). */
  use(this: void, helper: string): void
}

/** Выражения входов по id; не подключённый необязательный — undefined. */
export type Args = Record<string, string | undefined>

export interface NodeSpec {
  kind: string
  category: Category
  /** Вход порядка и выход «дальше»; у узлов данных нет. */
  exec: boolean
  /** Нет входа порядка (старт, функция). */
  entry?: boolean
  /** Нет выхода «дальше» (повторять всегда, прервать, стоп). */
  noNext?: boolean
  /** Выходы порядка, кроме «дальше»: ветки, тело цикла. */
  branches?: string[]
  inputs: PinSpec[]
  outputs: PinSpec[]
  settings?: SettingSpec[]
  /** Код: у действий — вызов, у данных — выражение. У узлов порядка нет (их собирает codegen). */
  code?: (this: void, a: Args, ctx: CodeContext) => string
  /** Инструкция без результата (присваивание): codegen не берёт её значение. */
  statement?: boolean
}

/** Разъёмы из строки: «to:target radius:number? item:item=coal» (? — необязательный, = — значение по умолчанию). */
function pins(text: string): PinSpec[] {
  const result: PinSpec[] = []
  for (const [part] of string.gmatch(text, "%S+")) {
    const [id, rest] = string.match(part, "^([%w_]+):(.+)$")
    if (id === undefined || rest === undefined) error(`разъём: ${part}`)
    let type = rest
    let optional = false
    let nullable = false
    let fallback: GraphValue | undefined
    const [base, value] = string.match(type, "^([%w_]+)=(.*)$")
    if (base !== undefined) {
      type = base
      fallback = tonumber(value) ?? (value === "true" ? true : value === "false" ? false : value)
    }
    if (string.sub(type, -1) === "?") {
      type = string.sub(type, 1, -2)
      optional = true
    }
    if (string.sub(type, -1) === "!") {
      type = string.sub(type, 1, -2)
      nullable = true
    }
    result.push({ id, type: type as PinType, optional: optional || undefined, default: fallback, nullable: nullable || undefined })
  }
  return result
}

/** Вызов с необязательными аргументами: хвостовые пропуски отбрасываются, в середине — undefined. */
export function call(name: string, ...args: (string | undefined)[]): string {
  let last = args.length
  while (last > 0 && args[last - 1] === undefined) last--
  const parts: string[] = []
  for (let i = 0; i < last; i++) parts.push(args[i] ?? "undefined")
  return `${name}(${parts.join(", ")})`
}

/** Строковый литерал TypeScript. */
export function quote(text: string): string {
  const [a] = string.gsub(text, "\\", "\\\\")
  const [b] = string.gsub(a, '"', '\\"')
  const [c] = string.gsub(b, "\n", "\\n")
  return `"${c}"`
}

/** Часть шаблонной строки: строковый литерал — текстом, остальное — подстановкой. */
function templatePart(expr: string): string {
  const [text] = string.match(expr, '^"([^"\\]*)"$')
  if (text === undefined) return `\${${expr}}`
  const [noTicks] = string.gsub(text, "`", "\\`")
  const [safe] = string.gsub(noTicks, "%${", "\\${")
  return safe
}

/** Объект опций без пустых полей: { radius: 2 } или undefined. */
function options(fields: [string, string | undefined][]): string | undefined {
  const parts: string[] = []
  for (const [key, value] of fields) if (value !== undefined) parts.push(`${key}: ${value}`)
  return parts.length === 0 ? undefined : `{ ${parts.join(", ")} }`
}

export const NODES: Record<string, NodeSpec> = {}

function define(spec: NodeSpec): void {
  NODES[spec.kind] = spec
}

function action(kind: string, category: Category, inputs: string, outputs: string, code: (this: void, a: Args, ctx: CodeContext) => string): void {
  define({ kind, category, exec: true, inputs: pins(inputs), outputs: pins(outputs), code })
}

function data(kind: string, category: Category, inputs: string, outputs: string, code: (this: void, a: Args, ctx: CodeContext) => string, settings?: SettingSpec[]): void {
  define({ kind, category, exec: false, inputs: pins(inputs), outputs: pins(outputs), code, settings })
}

// ---------- Порядок (собирает codegen) ----------

define({ kind: "start", category: "flow", exec: true, entry: true, inputs: [], outputs: [] })
define({ kind: "if", category: "flow", exec: true, noNext: true, branches: ["then", "else"], inputs: pins("cond:boolean"), outputs: [] })
define({ kind: "forever", category: "flow", exec: true, noNext: true, branches: ["body"], inputs: [], outputs: [] })
define({ kind: "while", category: "flow", exec: true, branches: ["body"], inputs: pins("cond:boolean"), outputs: [] })
define({ kind: "repeat", category: "flow", exec: true, branches: ["body"], inputs: pins("count:number=3"), outputs: pins("index:number") })
define({ kind: "foreach", category: "flow", exec: true, branches: ["body"], inputs: pins("list:list"), outputs: pins("element:value") })
define({ kind: "break", category: "flow", exec: true, noNext: true, inputs: [], outputs: [] })
define({ kind: "continue", category: "flow", exec: true, noNext: true, inputs: [], outputs: [] })
define({ kind: "try", category: "flow", exec: true, branches: ["body", "catch"], inputs: [], outputs: pins("code:string") })
define({ kind: "stop", category: "flow", exec: true, noNext: true, inputs: [], outputs: [], code: () => "exit()" })
define({ kind: "restart", category: "flow", exec: true, noNext: true, inputs: [], outputs: [], code: () => "restart()" })
action("wait", "flow", "seconds:number=1", "", (a) => call("wait", a.seconds))
action("wait-until", "flow", "cond:boolean every:number? timeout:number?", "result:boolean", (a) =>
  call("waitUntil", `() => ${a.cond}`, options([["every", a.every], ["timeout", a.timeout]])),
)

// ---------- Движение ----------

action("move", "move", "to:target radius:number?", "", (a) => call("move", a.to, options([["radius", a.radius]])))
action("go-home", "move", "", "", () => "goHome()")
action("can-reach", "move", "to:target", "result:boolean", (a) => call("canReach", a.to))
action("follow", "move", "target:robot until:boolean", "result:boolean", (a) => call("follow", a.target, `() => ${a.until}`))

// ---------- Предметы ----------

action("mine", "items", "item:item=coal count:number?", "result:number", (a) => call("mine", a.item, a.count))
action("take", "items", "from:entity item:item count:number?", "result:number", (a) => call("take", a.from, a.item, a.count))
action("put", "items", "into:entity item:item count:number?", "result:number", (a) => call("put", a.into, a.item, a.count))
action("pickup", "items", "item:item? count:number?", "result:number", (a) => call("pickup", a.item, a.count))
action("drop", "items", "item:item count:number?", "result:number", (a) => call("drop", a.item, a.count))
action("give", "items", "robot:robot item:item count:number?", "result:number", (a) => call("give", a.robot, a.item, a.count))
action("chest-at", "items", "marker:marker", "chest:entity", (a, ctx) => {
  ctx.use("chestAt")
  return call("chestAt", a.marker)
})

// ---------- Здания ----------

action("set-recipe", "buildings", "machine:entity recipe:string", "", (a) => call("setRecipe", a.machine, a.recipe))
action("build", "buildings", "item:item at:position direction:string?", "entity:entity", (a) =>
  call("build", a.item, a.at, a.direction === undefined ? undefined : `${a.direction} as Direction`),
)
action("deconstruct", "buildings", "target:entity", "", (a) => call("deconstruct", a.target))
action("rotate", "buildings", "target:entity reverse:boolean?", "", (a) => call("rotate", a.target, a.reverse))
action("repair", "buildings", "target:entity", "", (a) => call("repair", a.target))

// ---------- Жидкости ----------

action("pump", "fluids", "fluid:fluid=water amount:number?", "result:number", (a) => call("pump", a.fluid, a.amount))
action("fill", "fluids", "into:entity amount:number?", "result:number", (a) => call("fill", a.into, a.amount))
action("drain", "fluids", "from:entity fluid:fluid amount:number?", "result:number", (a) => call("drain", a.from, a.fluid, a.amount))

// ---------- Энергия ----------

action("refuel", "energy", "item:item? robot:robot?", "", (a) => call("refuel", a.item, a.robot))
action("charge", "energy", "station:entity?", "", (a) => call("charge", a.station))

// ---------- Зрение ----------

data("nearest-patch", "vision", "item:item=coal", "position:position", (a, ctx) => {
  ctx.use("nearestPatch")
  return call("nearestPatch", a.item)
})
data("nearest-water", "vision", "", "position:position", (_a, ctx) => {
  ctx.use("nearestWater")
  return "nearestWater()"
})
data("entities-near", "vision", "type:string=container radius:number?", "entities:entities", (a) =>
  call("scan.entities", options([["type", a.type], ["radius", a.radius]])),
)
data("nearest-entity", "vision", "type:string=container", "entity:entity", (a, ctx) => {
  ctx.use("nearestEntity")
  return call("nearestEntity", a.type)
})
data("robots-near", "vision", "radius:number?", "robots:robots", (a) => call("scan.robots", a.radius))
data("enemies-near", "vision", "radius:number?", "enemies:enemies", (a) => call("scan.enemies", a.radius))

// ---------- Карта ----------

data("marker", "map", "name:string=склад", "marker:marker", (a) => call("marker", a.name))
data("zone", "map", "name:string=плавильня", "zone:zone", (a) => call("zone", a.name))
data(
  "find-in-zone",
  "map",
  "what:string=stone-furnace zone:zone",
  "entities:entities",
  (a, ctx) => (ctx.node.values.by === "type" ? call("find", `{ type: ${a.what} }`, a.zone) : call("find", a.what, a.zone)),
  [{ id: "by", kind: "enum", options: ["name", "type"], default: "name" }],
)
data("markers", "map", "names:string=пост-1,пост-2", "points:targets", (a, ctx) => {
  ctx.use("markersOf")
  return call("markersOf", a.names)
})

// ---------- Своя машина ----------

data("me-fuel", "me", "", "value:number", () => "me.fuel")
data("me-cargo-count", "me", "item:item?", "value:number", (a) => call("me.cargo.count", a.item))
data("me-cargo-free", "me", "item:item?", "value:number", (a) => call("me.cargo.free", a.item))
data("me-cargo-full", "me", "", "value:boolean", () => "me.cargo.isFull()")
data("me-cargo-empty", "me", "", "value:boolean", () => "me.cargo.isEmpty()")
data("me-position", "me", "", "value:position", () => "me.position")
data("me-health", "me", "", "value:number", () => "me.health")
data("me-tank", "me", "", "value:number", () => "(me.tank?.amount ?? 0)")
data("me-ammo", "me", "", "value:number", () => "(me.weapon?.ammo?.count ?? 0)")
data("me-name", "me", "", "value:string", () => "me.name")
data("me-id", "me", "", "value:number", () => "me.id")
data("me-self", "me", "", "robot:robot", () => "me")
data("memory-get", "me", "key:string=счётчик", "value:value", (a) => call("me.memory.get", a.key))
action("memory-set", "me", "key:string=счётчик value:value", "", (a) => call("me.memory.set", a.key, a.value))
define({
  kind: "set-label",
  category: "me",
  exec: true,
  inputs: pins("text:string"),
  outputs: [],
  statement: true,
  code: (a) => `me.label = ${a.text}`,
})

// ---------- Здания, машины, сообщения: свойства ----------

data("entity-count", "objects", "entity:entity item:item", "value:number", (a) => `${a.entity}.count(${a.item})`)
data("entity-status", "objects", "entity:entity", "value:string", (a) => `${a.entity}.status`)
data("entity-position", "objects", "entity:entity", "value:position", (a) => `${a.entity}.position`)
data("entity-fluid", "objects", "entity:entity fluid:fluid?", "value:number", (a) => call(`${a.entity}.fluid`, a.fluid))
data("entity-name", "objects", "entity:entity", "value:string", (a) => `${a.entity}.name`)
data("entity-id", "objects", "entity:entity", "value:number", (a) => `${a.entity}.id`)
data("robot-fuel", "objects", "robot:robot", "value:number", (a) => `${a.robot}.fuel`)
data("robot-state", "objects", "robot:robot", "value:string", (a) => `${a.robot}.state`)
data("robot-position", "objects", "robot:robot", "value:position", (a) => `${a.robot}.position`)
data("robot-name", "objects", "robot:robot", "value:string", (a) => `${a.robot}.name`)
data("robot-model", "objects", "robot:robot", "value:string", (a) => `${a.robot}.model`)
data("robot-by-name", "objects", "name:string", "robot:robot!", (a) => call("robot", a.name))
data("distance", "objects", "from:robot to:target", "value:number", (a) => `${a.from}.distance(${a.to})`)

// ---------- Значения ----------

data("number", "values", "", "value:number", (_a, ctx) => `${ctx.node.values.value ?? 0}`, [{ id: "value", kind: "number", default: 0 }])
data("text", "values", "", "value:string", (_a, ctx) => quote(`${ctx.node.values.value ?? ""}`), [{ id: "value", kind: "text", default: "" }])
data("flag", "values", "", "value:boolean", (_a, ctx) => (ctx.node.values.value === true ? "true" : "false"), [{ id: "value", kind: "boolean", default: true }])
data("item", "values", "", "value:item", (_a, ctx) => quote(`${ctx.node.values.value ?? "coal"}`), [{ id: "value", kind: "text", default: "coal" }])
define({
  kind: "param",
  category: "values",
  exec: false,
  inputs: [],
  outputs: pins("value:value"),
  settings: [
    { id: "name", kind: "text", default: "ore" },
    { id: "type", kind: "type", options: ["item", "number", "string", "boolean", "marker", "zone", "fluid"], default: "item" },
    { id: "default", kind: "text", default: "coal" },
  ],
})
data("compare", "logic", "a:number b:number", "value:boolean", (a, ctx) => `(${a.a} ${ctx.node.values.op ?? "<"} ${a.b})`, [
  { id: "op", kind: "enum", options: ["<", "<=", ">", ">=", "===", "!=="], default: "<" },
])
data("equals", "logic", "a:value b:value", "value:boolean", (a, ctx) => `(${a.a} ${ctx.node.values.op === "!==" ? "!==" : "==="} ${a.b})`, [
  { id: "op", kind: "enum", options: ["===", "!=="], default: "===" },
])
data("and", "logic", "a:boolean b:boolean", "value:boolean", (a) => `(${a.a} && ${a.b})`)
data("or", "logic", "a:boolean b:boolean", "value:boolean", (a) => `(${a.a} || ${a.b})`)
data("not", "logic", "a:boolean", "value:boolean", (a) => `!${a.a}`)
data("exists", "logic", "value:value", "value:boolean", (a) => `(${a.value} !== null)`)
data(
  "math",
  "logic",
  "a:number b:number",
  "value:number",
  (a, ctx) => {
    const op = `${ctx.node.values.op ?? "+"}`
    return op === "min" || op === "max" ? `Math.${op}(${a.a}, ${a.b})` : `(${a.a} ${op} ${a.b})`
  },
  [{ id: "op", kind: "enum", options: ["+", "-", "*", "/", "%", "min", "max"], default: "+" }],
)
data("floor", "logic", "a:number", "value:number", (a) => `Math.floor(${a.a})`)
data("random", "logic", "max:number=10", "value:number", (a) => `Math.floor(Math.random() * ${a.max})`)
data("join", "logic", "a:value b:value", "value:string", (a) => `\`${templatePart(a.a!)}${templatePart(a.b!)}\``)
data("to-text", "logic", "value:value", "value:string", (a) => `String(${a.value})`)
data(
  "as",
  "logic",
  "value:value",
  "value:value",
  (a, ctx) => `(${a.value} as ${ctx.node.values.type ?? "Item"})`,
  [{ id: "type", kind: "type", options: ["item", "number", "string", "boolean", "position", "fluid", "entity", "robot"], default: "item" }],
)
data("field", "logic", "object:value key:string=item", "value:value", (a) => `(${a.object} as Record<string, Value>)[${a.key}]`)
data("list-length", "logic", "list:list", "value:number", (a) => `${a.list}.length`)
data("list-first", "logic", "list:list", "element:value", (a) => `${a.list}[0]`)
data("list-empty", "logic", "list:list", "value:boolean", (a) => `(${a.list}.length === 0)`)
data("is-night", "logic", "", "value:boolean", () => "time.isNight()")

// ---------- Переменные и функции (собирает codegen) ----------

define({
  kind: "variable",
  category: "variables",
  exec: false,
  inputs: [],
  outputs: [],
  settings: [
    { id: "name", kind: "text", default: "счётчик" },
    { id: "type", kind: "type", options: ["number", "string", "boolean", "item", "position", "value"], default: "number" },
    { id: "initial", kind: "text", default: "0" },
  ],
})
define({ kind: "variable-get", category: "variables", exec: false, inputs: [], outputs: pins("value:value"), settings: [{ id: "name", kind: "text", default: "счётчик" }] })
define({ kind: "variable-set", category: "variables", exec: true, inputs: pins("value:value"), outputs: [], settings: [{ id: "name", kind: "text", default: "счётчик" }] })
define({
  kind: "function",
  category: "functions",
  exec: true,
  entry: true,
  inputs: [],
  outputs: [],
  settings: [
    { id: "name", kind: "text", default: "deliver" },
    { id: "params", kind: "params", default: "" },
    { id: "returns", kind: "type", options: ["none", "number", "string", "boolean", "item", "entity", "position", "value"], default: "none" },
  ],
})
define({ kind: "return", category: "functions", exec: true, noNext: true, inputs: pins("value:value?"), outputs: [] })
define({ kind: "call", category: "functions", exec: true, inputs: [], outputs: [], settings: [{ id: "name", kind: "text", default: "deliver" }] })

// ---------- Вывод ----------

action("print", "output", "value:value", "", (a) => call("print", a.value))
action("say", "output", "text:string seconds:number?", "", (a) => call("say", a.text, a.seconds))
action("alert", "output", "text:string", "", (a) => call("alert", a.text))
action("chat", "output", "text:string", "", (a) => call("chat", a.text))

// ---------- Команда ----------

action("send", "team", "robot:robot topic:string=задача data:value?", "", (a) => call("send", a.robot, a.topic, a.data))
action("publish", "team", "topic:string=задача data:value?", "", (a) => call("publish", a.topic, a.data))
action("subscribe", "team", "robot:robot topic:string?", "", (a) => call("subscribe", a.robot, a.topic))
action("receive", "team", "topic:string? timeout:number?", "message:message!", (a) => call("receive", a.topic, a.timeout))
action("try-receive", "team", "topic:string?", "message:message!", (a) => call("tryReceive", a.topic))
action("request", "team", "robot:robot topic:string data:value? timeout:number?", "result:value", (a) => call("request", a.robot, a.topic, a.data, a.timeout))
action("reply", "team", "message:message data:value", "", (a) => `${a.message}.reply(${a.data})`)
data("message-data", "team", "message:message", "value:value", (a) => `${a.message}.data`)
data("message-from", "team", "message:message", "robot:robot", (a) => `${a.message}.from`)
data("message-topic", "team", "message:message", "value:string", (a) => `${a.message}.topic`)
data("board-get", "team", "key:string", "value:value", (a) => call("board.get", a.key))
action("board-set", "team", "key:string value:value", "", (a) => call("board.set", a.key, a.value))
action("board-increment", "team", "key:string by:number?", "result:number", (a) => call("board.increment", a.key, a.by))
action("board-claim", "team", "key:string ttl:number?", "result:boolean", (a) => call("board.claim", a.key, a.ttl))
action("board-release", "team", "key:string", "", (a) => call("board.release", a.key))
action("board-delete", "team", "key:string", "", (a) => call("board.delete", a.key))
action("tasks-push", "team", "queue:string=доставка data:value priority:number?", "", (a) =>
  call("tasks.push", a.queue, a.data, options([["priority", a.priority]])),
)
action("tasks-next", "team", "queue:string=доставка timeout:number? lease:number?", "task:task!", (a) =>
  call("tasks.next", a.queue, options([["timeout", a.timeout], ["lease", a.lease]])),
)
data("tasks-size", "team", "queue:string=доставка", "value:number", (a) => call("tasks.size", a.queue))
data("task-data", "team", "task:task", "value:value", (a) => `${a.task}.data`)
action("task-done", "team", "task:task", "", (a) => `${a.task}.done()`)
action("task-fail", "team", "task:task reason:string?", "", (a) => call(`${a.task}.fail`, a.reason))
action("display-clear", "team", "name:string=табло", "", (a) => `${call("display", a.name)}.clear()`)
action("display-text", "team", "name:string=табло x:number=2 y:number=2 text:string", "", (a) =>
  call(`${call("display", a.name)}.text`, a.x, a.y, a.text),
)
action("display-bar", "team", "name:string=табло x:number=2 y:number=20 width:number=60 height:number=6 value:number", "", (a) =>
  call(`${call("display", a.name)}.bar`, a.x, a.y, a.width, a.height, a.value),
)
data("signal-read", "team", "at:marker signal:string=signal-A", "value:number", (a) => call("signals.read", a.at, a.signal))
action("signal-write", "team", "at:marker signal:string=signal-A value:number", "", (a, ctx) => {
  ctx.use("writeSignal")
  return call("writeSignal", a.at, a.signal, a.value)
})

// ---------- Бой ----------

action("attack", "combat", "target:enemy", "result:boolean", (a) => call("attack", a.target))
action("guard", "combat", "at:target radius:number?", "", (a) => call("guard", a.at, options([["radius", a.radius]])))
action("patrol", "combat", "points:targets until:boolean?", "", (a) => call("patrol", a.points, a.until === undefined ? undefined : `() => ${a.until}`))
action("reload", "combat", "ammo:item?", "", (a) => call("reload", a.ammo))

/** Помощники схемы: функции в конце кода — только нужные. */
export const HELPERS: Record<string, string> = {
  nearestPatch: `/** Ближайшая клетка месторождения; нет — сообщить команде и остановить программу. */
function nearestPatch(item: Item): Position {
  const patch = scan.resources().find((p) => p.item === item);
  if (patch === undefined) {
    alert(\`\${me.name}: рядом нет месторождения \${item}\`);
    exit();
  }
  return patch.nearest;
}`,
  nearestWater: `/** Ближайшая вода; нет — сообщить и остановить программу. */
function nearestWater(): Position {
  const water = scan.water();
  if (water === null) {
    alert(\`\${me.name}: рядом нет воды\`);
    exit();
  }
  return water;
}`,
  nearestEntity: `/** Ближайшее здание этого типа; нет — сообщить и остановить программу. */
function nearestEntity(type: string): Entity {
  const found = scan.entities({ type })[0];
  if (found === undefined) {
    alert(\`\${me.name}: рядом нет \${type}\`);
    exit();
  }
  return found;
}`,
  chestAt: `/** Доехать до метки и найти сундук рядом с ней; нет — сообщить и остановить программу. */
function chestAt(at: Marker): Entity {
  move(at, { radius: 2 });
  let best: Entity | null = null;
  let bestDistance = Infinity;
  for (const e of scan.entities({ type: ["container", "logistic-container"], radius: 6 })) {
    const d = (e.position.x - at.position.x) ** 2 + (e.position.y - at.position.y) ** 2;
    if (d < bestDistance) {
      best = e;
      bestDistance = d;
    }
  }
  if (best === null) {
    alert(\`\${me.name}: у метки «\${at.name}» нет сундука\`);
    exit();
  }
  return best;
}`,
  markersOf: `/** Метки по именам через запятую. */
function markersOf(names: string): Target[] {
  return names.split(",").map((name) => marker(name));
}`,
  writeSignal: `/** Выставить один сигнал на сигнальной метке. */
function writeSignal(at: Marker, signal: string, value: number): void {
  const values: Record<string, number> = {};
  values[signal] = value;
  signals.write(at, values);
}`,
}

/** Тип параметра или переменной из настройки «тип». */
export function settingType(value: GraphValue | undefined, fallback: PinType): PinType {
  return typeof value === "string" && value !== "none" ? (value as PinType) : fallback
}
