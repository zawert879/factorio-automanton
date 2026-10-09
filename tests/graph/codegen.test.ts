// Схема → TypeScript (15.3): код собирается компилятором мода с проверкой типов; ошибки схемы — на узлах.
import { describe, expect, test } from "../../src/test/testing"
import { compile } from "../../src/lang/codegen"
import { GraphBuilder } from "../../src/graph/builder"
import { graphToSource } from "../../src/graph/codegen"
import { Graph } from "../../src/graph/model"
import { NODES } from "../../src/graph/nodes"
import "../lang/api-stubs"
import { run } from "../lang/harness"

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
