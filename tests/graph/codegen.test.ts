// Схема → TypeScript (15.3): код собирается компилятором мода с проверкой типов; ошибки схемы — на узлах.
import { describe, expect, test } from "../../src/test/testing"
import { compile } from "../../src/lang/codegen"
import { GraphBuilder } from "../../src/graph/builder"
import { graphToSource } from "../../src/graph/codegen"
import { Graph, GraphNode, GraphValue } from "../../src/graph/model"
import { libraryFunctions, signatureValues } from "../../src/graph/signatures"
import { NODES } from "../../src/graph/nodes"
import "../lang/api-stubs"
import { outputOf, run } from "../lang/harness"

function contains(text: string, part: string): boolean {
  const [at] = string.find(text, part, 1, true)
  return at !== undefined
}

function source(graph: Graph): string {
  const result = graphToSource(graph, "тест")
  if (!result.ok) error(`схема: ${result.diagnostics.map((d) => `${d.code}@${d.node}${d.pin !== undefined ? `.${d.pin}` : ""}`).join("; ")}`)
  return result.source
}

function compiles(graph: Graph): string {
  const text = source(graph)
  const compiled = compile(text)
  if (!compiled.ok) error(`компиляция: ${compiled.diagnostics.map((d) => `${d.code}(${d.params.join(",")})@${d.line}`).join("; ")}\n${text}`)
  return text
}

function codes(graph: Graph): string[] {
  return graphToSource(graph).diagnostics.map((d) => `${d.code}@${d.node}`)
}

/** «Шахтёр» с макета: параметр ore, повторять всегда, ехать к полю, копать, заправиться, если топлива мало, отвезти. */
function miner(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const loop = b.node("forever")
  const ore = b.node("param", { name: "ore", type: "item", default: "coal" })
  const patch = b.node("nearest-patch")
  const move1 = b.node("move")
  const mine = b.node("mine")
  const fuel = b.node("me-fuel")
  const low = b.node("compare", { op: "<", b: 0.2 })
  const cond = b.node("if")
  const refuel = b.node("refuel", { item: "coal" })
  const depot = b.node("chest-at", { marker: "склад" })
  const put = b.node("put")
  b.exec(start, loop).exec(loop, move1, "body").seq(move1, mine, cond)
  b.exec(cond, refuel, "then").exec(cond, depot, "else").exec(refuel, depot).exec(depot, put)
  b.data(ore, patch, "item").data(patch, move1, "to").data(ore, mine, "item").data(fuel, low, "a").data(low, cond, "cond")
  b.data(depot, put, "into").data(ore, put, "item")
  return b.layout()
}

describe("схема → код", () => {
  test("шахтёр: код собирается и проходит проверку типов", () => {
    const text = compiles(miner())
    expect(contains(text, "while (true) {")).toBe(true)
    expect(contains(text, "const args = me.args<{ ore?: Item }>();")).toBe(true)
    expect(contains(text, "function chestAt(")).toBe(true)
    // Ветки «если» сходятся в «сундук у метки»: после if — без else.
    expect(contains(text, "} else {")).toBe(false)
  })

  test("строки кода помнят узлы", () => {
    const graph = miner()
    const result = graphToSource(graph)
    const lines = result.source.split("\n")
    const mineNode = graph.nodes.find((n) => n.kind === "mine")!
    let found = false
    for (const [line, node] of pairs(result.lineNodes)) {
      if (node === mineNode.id) {
        found = true
        expect(contains(lines[line - 1], "mine(")).toBe(true)
      }
    }
    expect(found).toBe(true)
  })

  test("исполняется: цикл, переменная, функция с результатом", () => {
    const b = new GraphBuilder()
    const start = b.node("start")
    const total = b.node("variable", { name: "total", type: "number", initial: 0 })
    const repeat = b.node("repeat", { count: 4 })
    const getTotal = b.node("variable-get", { name: "total" })
    const call = b.node("call", { name: "twice" })
    const add = b.node("math", { op: "+" })
    const set = b.node("variable-set", { name: "total" })
    const print = b.node("print")
    const fn = b.node("function", { name: "twice", params: "x: number", returns: "number" })
    const mul = b.node("math", { op: "*", b: 2 })
    const ret = b.node("return")
    b.exec(start, repeat).exec(repeat, call, "body").exec(call, set).exec(repeat, print)
    b.data(repeat, call, "x", "index").data(getTotal, add, "a").data(call, add, "b", "result").data(add, set, "value").data(getTotal, print, "value")
    b.exec(fn, ret).data(fn, mul, "a", "x").data(mul, ret, "value")
    void total
    const r = run(compiles(b.layout()))
    expect(r.status).toBe("done")
    // 2*(0+1+2+3) = 12
    expect(r.output).toEqual(["12"])
  })

  test("для каждого, попытка: код ошибки действия в ветке «ошибка»", () => {
    const b = new GraphBuilder()
    const start = b.node("start")
    const tryNode = b.node("try")
    const move = b.node("move", { to: "nowhere" })
    const print = b.node("print")
    const robots = b.node("robots-near")
    const each = b.node("foreach")
    const say = b.node("print")
    const name = b.node("robot-name")
    b.exec(start, tryNode).exec(tryNode, move, "body").exec(tryNode, print, "catch").exec(tryNode, each).exec(each, say, "body")
    b.data(tryNode, print, "value", "code").data(robots, each, "list").data(each, name, "robot", "element").data(name, say, "value")
    const text = compiles(b.layout())
    expect(contains(text, "x2 instanceof ActionError ? x2.code")).toBe(true)
    expect(contains(text, "for (const e6 of scan.robots())")).toBe(true)
  })

  test("ошибки схемы — на узлах", () => {
    const b = new GraphBuilder()
    const start = b.node("start")
    const move = b.node("move")
    const lonely = b.node("say", { text: "привет" })
    const fuel = b.node("me-fuel")
    const put = b.node("put", { item: "coal" })
    b.seq(start, move, put)
    b.data(fuel, put, "into")
    const errors = codes(b.graph)
    expect(errors.includes(`graph-unconnected@${move.id}`)).toBe(true)
    expect(errors.includes(`graph-not-in-order@${lonely.id}`)).toBe(true)
    expect(errors.includes(`graph-wire-type@${put.id}`)).toBe(true)
  })

  test("провод назад и два пути к узлу — ошибка; назад — только циклом", () => {
    const b = new GraphBuilder()
    const start = b.node("start")
    const a = b.node("wait")
    const c = b.node("wait")
    b.seq(start, a, c).exec(c, a)
    expect(codes(b.graph).includes(`graph-loop-back@${a.id}`)).toBe(true)
  })

  test("у каждого узла каталога есть разъёмы и код", () => {
    for (const [kind, spec] of pairs(NODES)) {
      const special = ["start", "if", "forever", "while", "repeat", "foreach", "break", "continue", "try", "param", "variable", "variable-get", "variable-set", "function", "return", "call"]
      if (!special.includes(kind)) expect(`${kind}: ${spec.code !== undefined}`).toBe(`${kind}: true`)
    }
  })
})

// ---------- Библиотеки из схем (20.1) ----------

/** Библиотека-схема «удвоить(x: number): number» без «Старта». */
function doubler(): Graph {
  const b = new GraphBuilder()
  const fn = b.node("function", { name: "удвоить", params: "x: number", returns: "number" })
  const mul = b.node("math", { op: "*", b: 2 })
  const ret = b.node("return")
  b.exec(fn, ret).data(fn, mul, "a", "x").data(mul, ret, "value")
  return b.layout()
}

/** Узел «Вызвать» функцию библиотеки: имя, библиотека и снимок подписи. */
function libraryCall(b: GraphBuilder, library: string, librarySource: string, name: string, values: Record<string, GraphValue | undefined> = {}): GraphNode {
  const fn = libraryFunctions(librarySource).find((f) => f.name === name)
  if (fn === undefined) error(`нет функции ${name}`)
  const node = b.node("call", { name, library, ...signatureValues(fn) })
  for (const [key, value] of pairs(values)) node.values[key] = value
  return node
}

describe("библиотеки из схем", () => {
  test("схема без «Старта» — библиотека: функции с export, код — библиотека", () => {
    const text = graphToSource(doubler(), "lib/Удвоение").source
    expect(contains(text, "export function удвоить(x: number): number {")).toBe(true)
    const compiled = compile(text, { name: "lib/Удвоение" })
    expect(compiled.ok).toBe(true)
    expect(compiled.library).toBe(true)
    // Со «Стартом» — обычная программа: функции не экспортируются.
    expect(contains(source(miner()), "export ")).toBe(false)
  })

  test("схема вызывает функцию схемы-библиотеки: import по относительному пути, исполняется", () => {
    const lib = graphToSource(doubler(), "lib/Удвоение").source
    const b = new GraphBuilder()
    const start = b.node("start")
    const call = libraryCall(b, "lib/Удвоение", lib, "удвоить", { x: 21 })
    const print = b.node("print")
    b.seq(start, call, print).data(call, print, "value", "result")
    const result = graphToSource(b.layout(), "Работа/Главная")
    expect(result.diagnostics.length).toBe(0)
    expect(contains(result.source, 'import { удвоить } from "../lib/Удвоение";')).toBe(true)
    // Строка импорта — на узле вызова: ошибка «нет такой библиотеки» покажется на нём.
    const importLine = result.source.split("\n").findIndex((l) => string.sub(l, 1, 6) === "import") + 1
    expect(result.lineNodes[importLine]).toBe(call.id)
    expect(outputOf(result.source, { name: "Работа/Главная", modules: { "lib/Удвоение": lib } })).toBe("42")
  })

  test("совпало имя со своей функцией — псевдоним", () => {
    const lib = graphToSource(doubler(), "Удвоение").source
    const b = new GraphBuilder()
    const start = b.node("start")
    const own = b.node("call", { name: "удвоить" })
    const call = libraryCall(b, "Удвоение", lib, "удвоить", { x: 5 })
    const print = b.node("print")
    const fn = b.node("function", { name: "удвоить", params: "", returns: "none" })
    b.seq(start, own, call, print).data(call, print, "value", "result")
    void fn
    const text = source(b.layout())
    expect(contains(text, 'import { удвоить as удвоить_2 } from "./Удвоение";')).toBe(true)
    expect(contains(text, "удвоить_2(5)")).toBe(true)
    expect(outputOf(text, { name: "тест", modules: { Удвоение: lib } })).toBe("10")
  })

  test("функция библиотеки-кода: аргумент «здание» приводится к классу параметра, необязательные в конце не передаются", () => {
    const lib = [
      "export function загрузить(печь: Furnace, сколько: number, что?: Item): number {",
      "  return сколько;",
      "}",
    ].join("\n")
    const b = new GraphBuilder()
    const start = b.node("start")
    const chest = b.node("chest-at", { marker: "печь" })
    const call = libraryCall(b, "lib/Печи", lib, "загрузить", { сколько: 3 })
    b.seq(start, chest, call).data(chest, call, "печь")
    const text = source(b.layout())
    expect(contains(text, "загрузить(r2! as Furnace, 3);")).toBe(true)
    const compiled = compile(text, { name: "тест", resolve: (n) => (n === "lib/Печи" ? { name: n, source: lib } : undefined) })
    expect(compiled.diagnostics.map((d) => d.code)).toEqual([])
  })

  test("нет функции у вызова — ошибка на узле", () => {
    const b = new GraphBuilder()
    const start = b.node("start")
    const call = b.node("call", { name: "нет" })
    b.seq(start, call)
    expect(codes(b.graph)).toEqual([`graph-no-function@${call.id}`])
  })
})
