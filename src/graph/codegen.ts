// Схема → TypeScript (этап 15, B1: в одну сторону). Порядок действий — по красным проводам от «Старта»
// (и от узлов «Функция»), структурно: ветки «Если» сходятся в общем узле, назад — только через узлы-циклы.
// Данные — по зелёным: узел без порядка становится выражением в месте использования (пересчитывается каждый
// раз), результат действия — переменной `rN`, объявленной в начале программы или функции. Каждая строка
// кода помнит свой узел: ошибки компилятора и отладка показывают узел, а не строку.
import { assignable, ELEMENT_TYPES, Graph, GraphDiagnostic, GraphNode, GraphValue, PinType, TS_TYPES } from "./model"
import { HELPERS, NODES, NodeSpec, PinSpec, quote, settingType } from "./nodes"

export interface GraphSource {
  ok: boolean
  source: string
  /** Строка кода (с 1) → номер узла. */
  lineNodes: Record<number, number>
  diagnostics: GraphDiagnostic[]
}

export interface ResolvedPins {
  inputs: PinSpec[]
  outputs: PinSpec[]
  /** Есть вход порядка. */
  execIn: boolean
  /** Выходы порядка: «next» и ветки. */
  execOuts: string[]
}

interface Source {
  node: number
  pin: string
}

interface FunctionInfo {
  node: GraphNode
  ident: string
  params: { name: string; type: PinType }[]
  returns: PinType | undefined
}

const KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "default", "do", "else", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "let", "new", "null", "of", "return", "super",
  "switch", "this", "throw", "true", "try", "typeof", "undefined", "var", "void", "while", "me", "args",
])

/** Имена API и встроенной библиотеки: переменная или параметр с таким именем закрыли бы функцию. */
const GLOBALS = new Set([
  "print", "say", "chat", "alert", "move", "canReach", "follow", "goHome", "mine", "take", "put", "pickup", "drop", "give",
  "repair", "setRecipe", "build", "deconstruct", "rotate", "pump", "fill", "drain", "refuel", "charge", "marker", "zone",
  "find", "send", "publish", "subscribe", "unsubscribe", "receive", "tryReceive", "request", "robot", "display", "attack",
  "guard", "patrol", "reload", "wait", "waitUntil", "exit", "restart", "scan", "board", "tasks", "signals", "world", "Math",
  "JSON", "String", "Number", "Array", "Map", "Set", "Object", "Error", "ActionError", "console", "Infinity", "NaN",
  "nearestPatch", "nearestWater", "nearestEntity", "chestAt", "markersOf", "writeSignal",
])

/** Имя константы параметра машины: совпадает с функцией API — с суффиксом Arg (zone → zoneArg). */
function paramConst(name: string): string {
  return GLOBALS.has(name) ? `${name}Arg` : name
}

/** Есть ли в строке совпадение с шаблоном Lua (string.find в TSTL возвращает несколько значений). */
function has(text: string, pattern: string): boolean {
  const [at] = string.find(text, pattern)
  return at !== undefined
}

/** Не буква (латиница или байт UTF-8 — кириллица), не цифра и не _. */
const NOT_NAME_CHAR = `[^%w_${string.char(128)}-${string.char(255)}]`

/** Имя переменной, параметра или функции: буквы (и кириллица), цифры, _; не с цифры и не с «__». */
export function validName(name: unknown, allowGlobal = false): name is string {
  if (typeof name !== "string" || name === "" || KEYWORDS.has(name) || string.sub(name, 1, 2) === "__") return false
  if (!allowGlobal && GLOBALS.has(name)) return false
  if (has(name, "^[%d]")) return false
  return !has(name, NOT_NAME_CHAR)
}

/** Параметры функции из настройки: «куда: marker, сколько: number». */
export function parseParams(text: GraphValue | undefined): { name: string; type: PinType }[] {
  const result: { name: string; type: PinType }[] = []
  if (typeof text !== "string") return result
  for (const [part] of string.gmatch(text, "[^,]+")) {
    const [name, type] = string.match(part, "^%s*([^:%s]+)%s*:?%s*([%w]*)%s*$")
    if (name !== undefined) result.push({ name, type: type !== undefined && type !== "" ? (type as PinType) : "value" })
  }
  return result
}

/** Разъёмы узла с учётом настроек и схемы (параметры, переменные, функции, элемент списка). */
export function resolvePins(node: GraphNode, graph: Graph, sourceType?: (node: GraphNode, pin: string) => PinType | undefined): ResolvedPins | undefined {
  const spec = NODES[node.kind]
  if (spec === undefined) return undefined
  let inputs = spec.inputs
  let outputs = spec.outputs
  const typeOf = (name: GraphValue | undefined) => variableType(graph, name)
  switch (node.kind) {
    case "param": {
      const type = settingType(node.values.type, "item")
      outputs = [{ id: "value", type }]
      break
    }
    case "variable-get":
      outputs = [{ id: "value", type: typeOf(node.values.name) }]
      break
    case "variable-set":
      inputs = [{ id: "value", type: typeOf(node.values.name) }]
      break
    case "as":
      outputs = [{ id: "value", type: settingType(node.values.type, "item") }]
      break
    case "foreach":
    case "list-first": {
      const listType = sourceType?.(node, "list")
      const element = (listType !== undefined ? ELEMENT_TYPES[listType] : undefined) ?? "value"
      outputs = [{ id: node.kind === "foreach" ? "element" : "element", type: element }]
      break
    }
    case "function":
      outputs = parseParams(node.values.params).map((p) => ({ id: p.name, type: p.type }))
      break
    case "call": {
      const fn = functionNode(graph, node.values.name)
      if (fn !== undefined) {
        inputs = parseParams(fn.values.params).map((p) => ({ id: p.name, type: p.type }))
        const returns = settingType(fn.values.returns, "value")
        outputs = fn.values.returns === undefined || fn.values.returns === "none" ? [] : [{ id: "result", type: returns }]
      } else {
        inputs = []
        outputs = []
      }
      break
    }
    case "return": {
      const fn = ownerFunction(graph, node)
      const returns = fn === undefined || fn.values.returns === undefined || fn.values.returns === "none" ? undefined : settingType(fn.values.returns, "value")
      inputs = returns === undefined ? [] : [{ id: "value", type: returns }]
      break
    }
  }
  const execOuts: string[] = []
  if (spec.exec && !spec.noNext) execOuts.push("next")
  for (const branch of spec.branches ?? []) execOuts.push(branch)
  return { inputs, outputs, execIn: spec.exec && !spec.entry, execOuts }
}

function variableType(graph: Graph, name: GraphValue | undefined): PinType {
  for (const node of graph.nodes) if (node.kind === "variable" && node.values.name === name) return settingType(node.values.type, "number")
  return "value"
}

function functionNode(graph: Graph, name: GraphValue | undefined): GraphNode | undefined {
  for (const node of graph.nodes) if (node.kind === "function" && node.values.name === name) return node
  return undefined
}

/** Функция, из которой по порядку достижим узел (для «Вернуть»). */
function ownerFunction(graph: Graph, target: GraphNode): GraphNode | undefined {
  const next: Record<number, number[] | undefined> = {}
  for (const wire of graph.wires) {
    const list = next[wire.from] ?? []
    list.push(wire.to)
    next[wire.from] = list
  }
  for (const fn of graph.nodes) {
    if (fn.kind !== "function") continue
    const seen: Record<number, boolean | undefined> = {}
    const stack = [fn.id]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (id === target.id) return fn
      if (seen[id]) continue
      seen[id] = true
      for (const to of next[id] ?? []) stack.push(to)
    }
  }
  return undefined
}

/** Узлы, которым машину можно назвать именем (send, subscribe, request принимают имя). */
const ROBOT_BY_NAME = ["send", "subscribe", "request"]

/** Значение из настройки как литерал TypeScript нужного типа (consumer — вид узла, чей это вход). */
function literal(value: GraphValue, type: PinType, consumer?: string): string | undefined {
  if (type === "robot" && consumer !== undefined && !ROBOT_BY_NAME.includes(consumer)) return `robot(${quote(`${value}`)})!`
  switch (type) {
    case "number": {
      const n = typeof value === "number" ? value : tonumber(value)
      return n === undefined ? undefined : `${n}`
    }
    case "boolean":
      return value === true || value === "true" ? "true" : "false"
    case "marker":
    case "target":
      return `marker(${quote(`${value}`)})`
    case "zone":
      return `zone(${quote(`${value}`)})`
    case "value":
      return typeof value === "number" || typeof value === "boolean" ? `${value}` : quote(value)
    case "string":
    case "item":
    case "fluid":
    case "robot":
      return quote(`${value}`)
    default:
      return undefined
  }
}

export function graphToSource(graph: Graph, title = "", english = false): GraphSource {
  const diagnostics: GraphDiagnostic[] = []
  const fail = (node: number, code: string, params: (string | number)[] = [], pin?: string) => {
    diagnostics.push({ node, code, params, pin })
  }
  const byId: Record<number, GraphNode | undefined> = {}
  for (const node of graph.nodes) {
    if (byId[node.id] !== undefined) fail(node.id, "graph-duplicate-node")
    byId[node.id] = node
    if (NODES[node.kind] === undefined) fail(node.id, "graph-unknown-node", [node.kind])
  }

  // Провода: у выхода порядка — один провод, у входа данных — один источник.
  const execTo: Record<number, Record<string, number | undefined> | undefined> = {}
  const execFrom: Record<number, number[] | undefined> = {}
  const dataFrom: Record<number, Record<string, Source | undefined> | undefined> = {}
  const pinsCache: Record<number, ResolvedPins | undefined> = {}
  const sourceType = (node: GraphNode, pin: string): PinType | undefined => {
    const src = dataFrom[node.id]?.[pin]
    if (src === undefined) return undefined
    const from = byId[src.node]
    if (from === undefined) return undefined
    return pinsOf(from)?.outputs.find((p) => p.id === src.pin)?.type
  }
  const pinsOf = (node: GraphNode): ResolvedPins | undefined => {
    if (pinsCache[node.id] === undefined) pinsCache[node.id] = resolvePins(node, graph, sourceType)
    return pinsCache[node.id]
  }
  // Сначала провода данных (по ним считается тип элемента списка), потом проверка типов.
  for (const wire of graph.wires) {
    const from = byId[wire.from]
    const to = byId[wire.to]
    if (from === undefined || to === undefined) continue
    const fromSpec = NODES[from.kind]
    const isExec = wire.out === "next" || (fromSpec?.branches ?? []).includes(wire.out)
    if (isExec) {
      const outs = execTo[from.id] ?? {}
      if (outs[wire.out] !== undefined) fail(from.id, "graph-exec-two-wires", [], wire.out)
      outs[wire.out] = to.id
      execTo[from.id] = outs
      const list = execFrom[to.id] ?? []
      list.push(from.id)
      execFrom[to.id] = list
    } else {
      const ins = dataFrom[to.id] ?? {}
      if (ins[wire.in] !== undefined) fail(to.id, "graph-data-two-wires", [], wire.in)
      ins[wire.in] = { node: from.id, pin: wire.out }
      dataFrom[to.id] = ins
    }
  }
  for (const wire of graph.wires) {
    const from = byId[wire.from]
    const to = byId[wire.to]
    if (from === undefined || to === undefined) continue
    const fromPins = pinsOf(from)
    const toPins = pinsOf(to)
    if (fromPins === undefined || toPins === undefined) continue
    if (fromPins.execOuts.includes(wire.out)) {
      if (wire.in !== "exec" || !toPins.execIn) fail(to.id, "graph-wire-kind", [], wire.in)
      continue
    }
    const out = fromPins.outputs.find((p) => p.id === wire.out)
    const input = toPins.inputs.find((p) => p.id === wire.in)
    if (out === undefined) fail(from.id, "graph-no-pin", [wire.out], wire.out)
    else if (input === undefined) fail(to.id, "graph-no-pin", [wire.in], wire.in)
    else if (!compatible(out.type, input.type, to.kind)) fail(to.id, "graph-wire-type", [out.type, input.type], wire.in)
  }

  // Переменные, параметры машины, функции.
  const variables: { node: number; text: string }[] = []
  const declared: Record<string, boolean | undefined> = {}
  const params: { name: string; type: PinType; fallback: GraphValue | undefined }[] = []
  const paramSeen: Record<string, boolean | undefined> = {}
  const functions: FunctionInfo[] = []
  let starts = 0
  for (const node of graph.nodes) {
    if (node.kind === "start") starts++
    if (node.kind === "variable") {
      const name = node.values.name
      if (!validName(name)) fail(node.id, "graph-bad-name", [`${name ?? ""}`])
      else if (declared[name]) fail(node.id, "graph-duplicate-variable", [name])
      else {
        declared[name] = true
        const type = settingType(node.values.type, "number")
        const initial = node.values.initial ?? (type === "number" ? 0 : type === "boolean" ? false : "")
        const value = type === "value" || type === "position" ? initialValue(initial, type) : literal(initial, type)
        if (value === undefined) fail(node.id, "graph-bad-value", [`${initial}`])
        variables.push({ node: node.id, text: `let ${name}: ${tsType(type)} = ${value ?? "null"};` })
      }
    }
    if (node.kind === "param") {
      const name = node.values.name
      if (!validName(name, true)) fail(node.id, "graph-bad-name", [`${name ?? ""}`])
      else if (!paramSeen[name]) {
        paramSeen[name] = true
        params.push({ name, type: settingType(node.values.type, "item"), fallback: node.values.default })
      }
    }
    if (node.kind === "function") {
      const name = node.values.name
      if (!validName(name)) fail(node.id, "graph-bad-name", [`${name ?? ""}`])
      const list = parseParams(node.values.params)
      for (const p of list) if (!validName(p.name)) fail(node.id, "graph-bad-name", [p.name])
      const returns = node.values.returns === undefined || node.values.returns === "none" ? undefined : settingType(node.values.returns, "value")
      functions.push({ node, ident: `${name}`, params: list, returns })
    }
  }
  for (const node of graph.nodes) {
    if ((node.kind === "variable-get" || node.kind === "variable-set") && !declared[`${node.values.name}`]) fail(node.id, "graph-no-variable", [`${node.values.name ?? ""}`])
    if (node.kind === "call" && functionNode(graph, node.values.name) === undefined) fail(node.id, "graph-no-function", [`${node.values.name ?? ""}`])
  }
  if (starts === 0 && functions.length === 0) fail(0, "graph-no-start")
  if (starts > 1) for (const node of graph.nodes) if (node.kind === "start") fail(node.id, "graph-two-starts")

  // ---------- Выпуск кода ----------
  const helpers: Record<string, boolean | undefined> = {}
  const helperOrder: string[] = []
  const useHelper = (name: string) => {
    if (!helpers[name]) {
      helpers[name] = true
      helperOrder.push(name)
    }
  }

  interface Block {
    lines: string[]
    nodes: (number | undefined)[]
    hoists: string[]
    hoisted: Record<string, boolean | undefined>
  }
  const newBlock = (): Block => ({ lines: [], nodes: [], hoists: [], hoisted: {} })
  let block = newBlock()
  const line = (text: string, depth: number, node?: number) => {
    block.lines.push(`${string.rep("  ", depth)}${text}`)
    block.nodes.push(node)
  }

  const emitted: Record<number, boolean | undefined> = {}
  /** Переменная результата: без значения по умолчанию (здание, сообщение) — может быть null до выполнения. */
  const nullableResult = (pin: PinSpec) => pin.nullable === true || defaultOf(pin.type) === "null"
  const resultVar = (node: GraphNode, pin: PinSpec): string => {
    const name = `r${node.id}`
    if (!block.hoisted[name]) {
      block.hoisted[name] = true
      const type = tsType(pin.type)
      block.hoists.push(nullableResult(pin) ? `let ${name}: ${type} | null = null;` : `let ${name}: ${type} = ${defaultOf(pin.type)};`)
    }
    return name
  }

  /** Выражение для выхода `pin` узла `id` (для входа узла вида `consumer`). */
  const valueOf = (id: number, pin: string, consumer: string, visiting: Record<number, boolean | undefined>): string => {
    const node = byId[id]
    if (node === undefined) return "undefined"
    const spec = NODES[node.kind]!
    const pins = pinsOf(node)
    const out = pins?.outputs.find((p) => p.id === pin)
    if (out === undefined) return "undefined"
    switch (node.kind) {
      case "param":
        // Параметр — константа в начале программы с тем же именем (имя функции API — с суффиксом Arg).
        return paramConst(`${node.values.name}`)
      case "variable-get":
        return `${node.values.name}`
      case "repeat":
        return `i${node.id}`
      case "foreach":
        return `e${node.id}`
      case "try":
        return `c${node.id}`
      case "function":
        return pin
    }
    if (spec.exec) {
      // Результат действия — переменная; узел должен выполниться раньше.
      const name = resultVar(node, out)
      return nullableResult(out) && consumer !== "exists" ? `${name}!` : name
    }
    if (visiting[id]) {
      fail(id, "graph-data-cycle")
      return "undefined"
    }
    visiting[id] = true
    const args = argsOf(node, visiting)
    visiting[id] = undefined
    const expr = spec.code!(args, { node, use: useHelper })
    return out.nullable && consumer !== "exists" ? `${expr}!` : expr
  }

  const argsOf = (node: GraphNode, visiting: Record<number, boolean | undefined> = {}): Record<string, string | undefined> => {
    const args: Record<string, string | undefined> = {}
    const pins = pinsOf(node)
    if (pins === undefined) return args
    for (const input of pins.inputs) {
      const src = dataFrom[node.id]?.[input.id]
      if (src !== undefined) {
        args[input.id] = valueOf(src.node, src.pin, node.kind, visiting)
        continue
      }
      const value = node.values[input.id] ?? input.default
      if (value !== undefined && value !== "") {
        const text = literal(value, input.type, node.kind)
        if (text === undefined) fail(node.id, "graph-bad-value", [`${value}`], input.id)
        args[input.id] = text
      } else if (!input.optional) {
        fail(node.id, "graph-unconnected", [input.id], input.id)
        args[input.id] = "undefined"
      }
    }
    return args
  }

  /** Узлы, достижимые по порядку из `start` (без входа в тела циклов — они свои). */
  const reach = (start: number | undefined): Record<number, boolean | undefined> => {
    const seen: Record<number, boolean | undefined> = {}
    const stack: number[] = start === undefined ? [] : [start]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (seen[id]) continue
      seen[id] = true
      const node = byId[id]
      if (node === undefined) continue
      const outs = execTo[id]
      if (outs === undefined) continue
      for (const out of pinsOf(node)?.execOuts ?? []) {
        const to = outs[out]
        if (to !== undefined) stack.push(to)
      }
    }
    return seen
  }

  /** Где сходятся ветки: первый общий узел, из которого достижимы все остальные общие. */
  const joinOf = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a === undefined || b === undefined) return undefined
    const ra = reach(a)
    const rb = reach(b)
    const common: number[] = []
    for (const node of graph.nodes) if (ra[node.id] && rb[node.id]) common.push(node.id)
    for (const candidate of common) {
      const rc = reach(candidate)
      if (common.every((other) => rc[other])) return candidate
    }
    return undefined
  }

  /** Цепочка действий от `start` до `stop` (узел слияния) — инструкции на глубине `depth`. */
  const chain = (start: number | undefined, stop: number | undefined, depth: number, path: Record<number, boolean | undefined>): void => {
    let current = start
    while (current !== undefined && current !== stop) {
      const node = byId[current]
      if (node === undefined) return
      if (path[current]) {
        fail(current, "graph-loop-back")
        return
      }
      if (emitted[current]) {
        fail(current, "graph-two-paths")
        return
      }
      emitted[current] = true
      path[current] = true
      current = statement(node, stop, depth, path)
    }
  }

  /** Одна инструкция (или конструкция порядка); итог — следующий узел цепочки. */
  const statement = (node: GraphNode, stop: number | undefined, depth: number, path: Record<number, boolean | undefined>): number | undefined => {
    const spec = NODES[node.kind]!
    const outs = execTo[node.id] ?? {}
    const sub = (start: number | undefined, end: number | undefined) => chain(start, end, depth + 1, { ...path })
    switch (node.kind) {
      case "if": {
        const args = argsOf(node)
        // Ветки сходятся в общем узле — после «если» цепочка идёт дальше с него.
        const join = joinOf(outs.then, outs.else)
        if (outs.then === undefined || outs.then === join) {
          line(`if (!${wrap(args.cond!)}) {`, depth, node.id)
          sub(outs.else, join)
        } else {
          line(`if (${unwrap(args.cond!)}) {`, depth, node.id)
          sub(outs.then, join)
          if (outs.else !== undefined && outs.else !== join) {
            line("} else {", depth, node.id)
            sub(outs.else, join)
          }
        }
        line("}", depth, node.id)
        return join
      }
      case "forever":
        line("while (true) {", depth, node.id)
        sub(outs.body, undefined)
        line("}", depth, node.id)
        return undefined
      case "while": {
        const args = argsOf(node)
        line(`while (${unwrap(args.cond!)}) {`, depth, node.id)
        sub(outs.body, undefined)
        line("}", depth, node.id)
        return outs.next
      }
      case "repeat": {
        const args = argsOf(node)
        line(`for (let i${node.id} = 0; i${node.id} < ${args.count}; i${node.id}++) {`, depth, node.id)
        sub(outs.body, undefined)
        line("}", depth, node.id)
        return outs.next
      }
      case "foreach": {
        const args = argsOf(node)
        line(`for (const e${node.id} of ${args.list}) {`, depth, node.id)
        sub(outs.body, undefined)
        line("}", depth, node.id)
        return outs.next
      }
      case "try": {
        line("try {", depth, node.id)
        sub(outs.body, undefined)
        line(`} catch (x${node.id}) {`, depth, node.id)
        if (usedOutput(node.id)) line(`const c${node.id} = x${node.id} instanceof ActionError ? x${node.id}.code : String(x${node.id});`, depth + 1, node.id)
        sub(outs.catch, undefined)
        line("}", depth, node.id)
        return outs.next
      }
      case "break":
        line("break;", depth, node.id)
        return undefined
      case "continue":
        line("continue;", depth, node.id)
        return undefined
      case "return": {
        const args = argsOf(node)
        line(args.value === undefined ? "return;" : `return ${args.value};`, depth, node.id)
        return undefined
      }
      case "variable-set": {
        const args = argsOf(node)
        line(`${node.values.name} = ${args.value};`, depth, node.id)
        return outs.next
      }
      case "call": {
        const fn = functions.find((f) => f.ident === node.values.name)
        const args = argsOf(node)
        const text = `${node.values.name}(${(fn?.params ?? []).map((p) => args[p.name] ?? "undefined").join(", ")})`
        const pins = pinsOf(node)
        const result = pins?.outputs[0]
        line(result !== undefined && usedOutput(node.id) ? `${resultVar(node, result)} = ${text};` : `${text};`, depth, node.id)
        return outs.next
      }
    }
    const args = argsOf(node)
    const text = spec.code!(args, { node, use: useHelper })
    const result = pinsOf(node)?.outputs[0]
    if (!spec.statement && result !== undefined && usedOutput(node.id)) line(`${resultVar(node, result)} = ${text};`, depth, node.id)
    else line(`${text};`, depth, node.id)
    return spec.noNext ? undefined : outs.next
  }

  const usedOutput = (id: number): boolean => {
    for (const wire of graph.wires) if (wire.from === id && wire.out !== "next" && !(NODES[byId[id]!.kind]?.branches ?? []).includes(wire.out)) return true
    return false
  }

  // Главная программа — от «Старта».
  const main = newBlock()
  block = main
  const start = graph.nodes.find((n) => n.kind === "start")
  if (start !== undefined) {
    emitted[start.id] = true
    chain(execTo[start.id]?.next, undefined, 0, { [start.id]: true })
  }
  // Функции.
  const fnBlocks: { info: FunctionInfo; block: Block }[] = []
  for (const info of functions) {
    const fb = newBlock()
    block = fb
    emitted[info.node.id] = true
    chain(execTo[info.node.id]?.next, undefined, 1, { [info.node.id]: true })
    fnBlocks.push({ info, block: fb })
  }
  // Действия, до которых порядок не доходит, — ошибка: иначе узел молча не выполнится.
  for (const node of graph.nodes) {
    const spec = NODES[node.kind]
    if (spec !== undefined && spec.exec && !spec.entry && !emitted[node.id]) fail(node.id, "graph-not-in-order")
  }

  // ---------- Сборка текста ----------
  const out: string[] = []
  const lineNodes: Record<number, number> = {}
  const push = (text: string, node?: number) => {
    out.push(text)
    if (node !== undefined) lineNodes[out.length] = node
  }
  push(english ? `// Built from the graph${title !== "" ? ` "${title}"` : ""}. Edit it in the workshop.` : `// Собрано из схемы${title !== "" ? ` «${title}»` : ""}. Править — в мастерской.`)
  if (params.length > 0) {
    const fields = params.map((p) => `${p.name}?: ${p.type === "marker" || p.type === "zone" ? "string" : tsType(p.type)}`)
    const owner = graph.nodes.find((n) => n.kind === "param")
    push(`const args = me.args<{ ${fields.join("; ")} }>();`, owner?.id)
    for (const p of params) {
      const keyType = p.type === "marker" || p.type === "zone" ? "string" : p.type
      const fallback = p.fallback === undefined || p.fallback === "" ? undefined : literal(p.fallback, keyType)
      const raw = fallback === undefined ? `args.${p.name}` : `args.${p.name} ?? ${fallback}`
      const value = p.type === "marker" ? `marker(${raw})` : p.type === "zone" ? `zone(${raw})` : raw
      const declared = fallback === undefined && p.type !== "marker" && p.type !== "zone" ? `${tsType(p.type)} | undefined` : tsType(p.type)
      push(`const ${paramConst(p.name)}: ${declared} = ${value};`, graph.nodes.find((n) => n.kind === "param" && n.values.name === p.name)?.id)
    }
  }
  for (const variable of variables) push(variable.text, variable.node)
  const appendBlock = (b: Block, depth: number) => {
    for (const hoist of b.hoists) push(`${string.rep("  ", depth)}${hoist}`)
    for (let i = 0; i < b.lines.length; i++) push(b.lines[i], b.nodes[i])
  }
  appendBlock(main, 0)
  for (const { info, block: fb } of fnBlocks) {
    out.push("")
    const signature = info.params.map((p) => `${p.name}: ${tsType(p.type)}`).join(", ")
    push(`function ${info.ident}(${signature})${info.returns === undefined ? "" : `: ${tsType(info.returns)}`} {`, info.node.id)
    appendBlock(fb, 1)
    if (info.returns !== undefined) push(`  throw new Error(${quote(`функция ${info.ident} закончилась без «Вернуть»`)});`, info.node.id)
    push("}", info.node.id)
  }
  for (const name of helperOrder) {
    out.push("")
    for (const text of HELPERS[name].split("\n")) out.push(text)
  }
  out.push("")
  return { ok: diagnostics.length === 0, source: out.join("\n"), lineNodes, diagnostics }
}

/** Без внешних скобок, если они охватывают всё выражение: if ((a < b)) → if (a < b). */
function unwrap(expr: string): string {
  if (string.sub(expr, 1, 1) !== "(" || string.sub(expr, -1) !== ")") return expr
  let depth = 0
  for (let i = 1; i <= expr.length; i++) {
    const c = string.sub(expr, i, i)
    if (c === "(") depth++
    else if (c === ")") {
      depth--
      if (depth === 0 && i < expr.length) return expr
    }
  }
  return string.sub(expr, 2, -2)
}

function wrap(expr: string): string {
  return has(expr, "^[%w_.!%(%)]+$") ? expr : `(${expr})`
}

function tsType(type: PinType): string {
  return type === "exec" ? "void" : TS_TYPES[type]
}

/** Начальное значение переменной результата. */
function defaultOf(type: PinType): string {
  switch (type) {
    case "number":
      return "0"
    case "boolean":
      return "false"
    case "string":
    case "item":
    case "fluid":
      return '""'
    case "entities":
    case "robots":
    case "enemies":
    case "targets":
    case "list":
      return "[]"
    default:
      return "null"
  }
}

function initialValue(value: GraphValue, type: PinType): string | undefined {
  if (type === "position") return "{ x: 0, y: 0 }"
  if (typeof value === "number" || typeof value === "boolean") return `${value}`
  if (value === "" || value === "null") return "null"
  const n = tonumber(value)
  return n !== undefined ? `${n}` : quote(value)
}

/** Тип выхода годится для входа (с учётом списков у «для каждого»). */
function compatible(from: PinType, to: PinType, consumer: string): boolean {
  if (consumer === "foreach" || consumer === "list-first" || consumer === "list-length" || consumer === "list-empty") {
    if (to === "list") return ELEMENT_TYPES[from] !== undefined
  }
  if (consumer === "exists" || consumer === "print" || consumer === "join" || consumer === "to-text") return from !== "exec"
  return assignable(from, to)
}

/** Заголовок кода схемы английский (собрал игрок с английской игрой) — пересобирать так же. */
export function englishGraphSource(source: string): boolean {
  return string.sub(source, 1, 17) === "// Built from the"
}
