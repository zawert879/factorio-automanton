// Библиотеки из схем (20.1): схема без «Старта» — библиотека; её функцию вызывают другая схема (узел «Вызвать»
// со снимком подписи, import в коде) и программа-код; схема вызывает функцию библиотеки-кода; при входе в мастерскую
// снимок подписи обновляется; переименование библиотеки правит узлы вызова в схеме и в мастерской.
import { findRobot } from "../automaton/registry"
import { GraphBuilder } from "../graph/builder"
import { graphToSource } from "../graph/codegen"
import { emptyGraph, Graph, GraphNode } from "../graph/model"
import { MODELS } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { deleteProgram, findProgram, publish } from "../program/store"
import { buildGraph, ensureWorkshop, workshopOf } from "../workshop/entities"
import { applyCall, callChoices, refreshLibraryCalls } from "../workshop/libraries"
import { publishWorkshop } from "../workshop/publish"
import { describe, expect, test, waitUntil } from "./testing"

const LIB = "gl/lib/Удвоение"
const MAIN = "gl/Главная"

/** Библиотека-схема: удвоить(x) = x * 2 (с extra — ещё и + y). */
function doubler(extra = false): Graph {
  const b = new GraphBuilder()
  const fn = b.node("function", { name: "удвоить", params: extra ? "x: number, y: number" : "x: number", returns: "number" })
  const mul = b.node("math", { op: "*", b: 2 })
  const ret = b.node("return")
  b.exec(fn, ret).data(fn, mul, "a", "x")
  if (extra) {
    const add = b.node("math", { op: "+" })
    b.data(mul, add, "a").data(fn, add, "b", "y").data(add, ret, "value")
  } else b.data(mul, ret, "value")
  return b.layout()
}

function publishGraph(name: string, graph: Graph, id?: number) {
  const source = graphToSource(graph, name)
  if (!source.ok) error(`схема ${name}: ${serpent.line(source.diagnostics)}`)
  const result = publish({ id, name, source: source.source, graph, graphLines: source.lineNodes })
  if (!result.ok) error(`${name} не опубликована: ${serpent.line(result.diagnostics)}`)
  return result.program
}

function cleanup(...names: string[]): void {
  for (const name of names) {
    const program = findProgram(name)
    if (program !== undefined) deleteProgram(program.id)
  }
}

/** Узел «Вызвать» в мастерской программы: функция выбрана из списка, как в окне узла. */
function callFrom(programId: number, b: GraphBuilder, library: string | undefined, name: string): GraphNode {
  const ws = workshopOf(programId)!
  const choice = callChoices(ws).find((c) => c.name === name && c.library === library)
  if (choice === undefined) error(`нет в списке: ${name} (${library})`)
  const node = b.node("call")
  applyCall(node.values, choice)
  return node
}

describe("библиотеки из схем", () => {
  test("схема без «Старта» публикуется библиотекой", () => {
    cleanup(MAIN, "gl/Код", "gl/Печи-схема", LIB, `${LIB}2`, "gl/lib/Печи")
    const lib = publishGraph(LIB, doubler())
    expect(lib.library).toBe(true)
  })

  test("схема вызывает функцию библиотеки-схемы: import в коде, машина исполняет", (t) => {
    const main = publishGraph(MAIN, emptyGraph())
    const ws = ensureWorkshop(main.id, main.force, main.graph)
    expect(callChoices(ws).some((c) => c.library === LIB && c.name === "удвоить")).toBe(true)
    const b = new GraphBuilder()
    const start = b.node("start")
    const call = callFrom(main.id, b, LIB, "удвоить")
    call.values.x = 21
    const print = b.node("print")
    b.seq(start, call, print).data(call, print, "value", "result")
    buildGraph(ws, b.layout())
    const { build, result } = publishWorkshop(ws, main, "тест")
    expect(build.errors.length).toBe(0)
    expect(result?.ok).toBe(true)
    expect(main.dependencies).toEqual([LIB])
    expect(string.find(main.source, 'import { удвоить } from "./lib/Удвоение";', 1, true)[0] !== undefined).toBe(true)

    const surface = game.get_surface("nauvis")!
    const position = { x: -700.5, y: 760.5 }
    surface.request_to_generate_chunks(position, 1)
    surface.force_generate_chunk_requests()
    for (const e of surface.find_entities_filtered({ area: [[-704, 757], [-696, 765]] })) if (e.type !== "character") e.destroy()
    const tiles = []
    for (let x = -703; x < -697; x++) for (let y = 758; y < 764; y++) tiles.push({ name: "grass-1", position: { x, y } })
    surface.set_tiles(tiles, true, true, true)
    surface.create_entity({ name: MODELS[0].placer, position, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position, radius: 0.5 })[0])!
    assignProgram(robot, main)
    const record = machineOf(robot.id)
    waitUntil(t, "конца программы", () => record.machine.status === "done" || record.machine.status === "error", 300, () => {
      expect(record.machine.status).toBe("done")
      expect(record.console.includes("42")).toBe(true)
      robot.entity.destroy()
    })
  })

  test("программа-код вызывает функцию библиотеки-схемы", () => {
    const result = publish({ name: "gl/Код", source: 'import { удвоить } from "./lib/Удвоение";\nprint(удвоить(4));\n' })
    expect(result.ok).toBe(true)
  })

  test("схема вызывает функцию библиотеки-кода: здание приводится к классу параметра; функции с параметром-функцией нет в списке", () => {
    const lib = [
      "export function загрузить(печь: Furnace, сколько: number): number {",
      "  return сколько;",
      "}",
      "export function attempt(action: () => number): number {",
      "  return action();",
      "}",
    ].join("\n")
    expect(publish({ name: "gl/lib/Печи", source: lib }).ok).toBe(true)
    const main = publishGraph("gl/Печи-схема", emptyGraph())
    const ws = ensureWorkshop(main.id, main.force, main.graph)
    const names = callChoices(ws)
      .filter((c) => c.library === "gl/lib/Печи")
      .map((c) => c.name)
    expect(names).toEqual(["загрузить"])
    const b = new GraphBuilder()
    const start = b.node("start")
    const chest = b.node("chest-at", { marker: "печь" })
    const call = callFrom(main.id, b, "gl/lib/Печи", "загрузить")
    call.values.сколько = 3
    b.seq(start, chest, call).data(chest, call, "печь")
    buildGraph(ws, b.layout())
    const { build, result } = publishWorkshop(ws, main, "тест")
    expect(build.errors.length).toBe(0)
    expect(result?.ok).toBe(true)
    expect(string.find(main.source, "as Furnace", 1, true)[0] !== undefined).toBe(true)
  })

  test("библиотеку изменили — при входе в мастерскую снимок подписи и разъёмы вызова обновляются", () => {
    const lib = findProgram(LIB)!
    publishGraph(LIB, doubler(true), lib.id)
    const main = findProgram(MAIN)!
    // Код схемы вызывает удвоить с одним аргументом — с новой версией не собирается, работает прежняя сборка.
    expect(main.stale?.module).toBe(LIB)
    const ws = workshopOf(main.id)!
    let call: number | undefined
    for (const [id, node] of pairs(ws.nodes)) if (node.kind === "call") call = id
    expect(ws.nodes[call!]!.pins["in:y"]).toBe(undefined)
    refreshLibraryCalls(ws)
    expect(ws.nodes[call!]!.values.params).toBe("x: number, y: number")
    expect(ws.nodes[call!]!.pins["in:y"] !== undefined).toBe(true)
    ws.nodes[call!]!.values.y = 1
    const { build, result } = publishWorkshop(ws, main, "тест")
    expect(build.errors.length).toBe(0)
    expect(result?.ok).toBe(true)
    expect(main.stale).toBe(undefined)
  })

  test("переименование библиотеки правит узлы вызова в схеме и в мастерской и путь импорта", () => {
    const lib = findProgram(LIB)!
    publishGraph(`${LIB}2`, lib.graph!, lib.id)
    const main = findProgram(MAIN)!
    const calls = main.graph!.nodes.filter((n) => n.kind === "call")
    expect(calls.map((n) => n.values.library)).toEqual([`${LIB}2`])
    const ws = workshopOf(main.id)!
    for (const [, node] of pairs(ws.nodes)) if (node.kind === "call") expect(node.values.library).toBe(`${LIB}2`)
    expect(string.find(main.source, '"./lib/Удвоение2"', 1, true)[0] !== undefined).toBe(true)
    // Собранная заново из схемы — тот же импорт.
    expect(graphToSource(main.graph!, main.name).source).toBe(main.source)
    // Используемую библиотеку удалить нельзя.
    expect(deleteProgram(lib.id).ok).toBe(false)
    cleanup(MAIN, "gl/Код", "gl/Печи-схема", `${LIB}2`, "gl/lib/Печи")
    expect(findProgram(`${LIB}2`)).toBe(undefined)
  })
})
