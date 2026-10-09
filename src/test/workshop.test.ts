// Мастерская схем (15.4–15.6): схема ↔ здания на поверхности программы (узлы, разъёмы, провода), узел
// из призрака с тегом (палитра, вставка), публикация схемы и машина, которая исполняет собранный код.
import { GraphBuilder } from "../graph/builder"
import { Graph } from "../graph/model"
import { NODE_BODY_PREFIX, PIN_DATA, PIN_EXEC } from "../names"
import { findRobot } from "../automaton/registry"
import { MODELS } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { deleteProgram, findProgram, publish } from "../program/store"
import { buildGraph, ensureWorkshop, NODE_TAG, readGraph, removeNode, workshopOf } from "../workshop/entities"
import { publishWorkshop } from "../workshop/publish"
import { describe, expect, test, waitUntil } from "./testing"

/** Печать трёх чисел в цикле — схема для проверок. */
function counting(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const repeat = b.node("repeat", { count: 3 })
  const print = b.node("print")
  const add = b.node("math", { op: "+", b: 1 })
  b.exec(start, repeat).exec(repeat, print, "body").data(repeat, add, "a", "index").data(add, print, "value")
  return b.layout()
}

function freshProgram(name: string, graph: Graph) {
  const old = findProgram(name)
  if (old !== undefined) deleteProgram(old.id)
  const result = publish({ name, source: "// схема\n", graph })
  if (!result.ok) error("программа не опубликована")
  return result.program
}

describe("мастерская", () => {
  test("схема → здания → схема: узлы, значения и провода те же", () => {
    const graph = counting()
    const program = freshProgram("ws/count", graph)
    const ws = ensureWorkshop(program.id, program.force, graph)
    expect(ws.surface.get_tile(1, 1).name === "lab-dark-1" || ws.surface.get_tile(1, 1).name === "lab-dark-2").toBe(true)
    expect(ws.surface.count_entities_filtered({ name: [PIN_EXEC, PIN_DATA] }) > 0).toBe(true)
    const back = readGraph(ws)
    expect(back.problems.length).toBe(0)
    expect(back.graph.nodes.map((n) => `${n.id}:${n.kind}`)).toEqual(graph.nodes.map((n) => `${n.id}:${n.kind}`))
    expect(back.graph.nodes.map((n) => `${n.x},${n.y}`)).toEqual(graph.nodes.map((n) => `${n.x},${n.y}`))
    const wires = (g: Graph) => g.wires.map((w) => `${w.from}.${w.out}>${w.to}.${w.in}`).sort()
    expect(wires(back.graph)).toEqual(wires(graph))
    expect(back.graph.nodes[3].values.op).toBe("+")
  })

  test("удалить узел — разъёмы и провода уходят с ним", () => {
    const program = findProgram("ws/count")!
    const ws = workshopOf(program.id)!
    const before = ws.surface.count_entities_filtered({ name: [PIN_EXEC, PIN_DATA] })
    removeNode(ws, 3)
    const after = ws.surface.count_entities_filtered({ name: [PIN_EXEC, PIN_DATA] })
    expect(before - after).toBe(3)
    const back = readGraph(ws)
    expect(back.graph.wires.some((w) => w.to === 3 || w.from === 3)).toBe(false)
    buildGraph(ws, counting())
    expect(readGraph(ws).graph.wires.length).toBe(4)
  })

  test("призрак узла с тегом (палитра, вставка) оживает узлом с разъёмами", () => {
    const program = findProgram("ws/count")!
    const ws = workshopOf(program.id)!
    const ghost = ws.surface.create_entity({
      name: "entity-ghost",
      inner_name: `${NODE_BODY_PREFIX}4`,
      position: { x: 60, y: 40 },
      force: program.force,
      tags: { [NODE_TAG]: { kind: "say", values: { text: "привет" } } as never },
      raise_built: true,
    })
    expect(ghost === undefined || !ghost.valid).toBe(true)
    const node = readGraph(ws).graph.nodes.find((n) => n.kind === "say")
    expect(node?.values.text).toBe("привет")
    expect(ws.surface.count_entities_filtered({ area: [[56, 37], [64, 43]], name: [PIN_EXEC, PIN_DATA] })).toBe(4)
  })

  test("узел вне мастерской убирается", () => {
    const nauvis = game.get_surface("nauvis")!
    const body = nauvis.create_entity({ name: `${NODE_BODY_PREFIX}3`, position: { x: -900, y: -900 }, force: "player", raise_built: true })
    expect(body === undefined || !body.valid).toBe(true)
  })

  test("публикация из мастерской: код из схемы, машина его исполняет", (t) => {
    const program = findProgram("ws/count")!
    const ws = workshopOf(program.id)!
    buildGraph(ws, counting())
    const { build, result } = publishWorkshop(ws, program, "тест")
    expect(build.errors.length).toBe(0)
    expect(result?.ok).toBe(true)
    expect(program.graph?.nodes.length).toBe(4)
    expect(program.graphLines !== undefined).toBe(true)
    const surface = game.get_surface("nauvis")!
    const position = { x: -760.5, y: 700.5 }
    surface.request_to_generate_chunks(position, 1)
    surface.force_generate_chunk_requests()
    const tiles = []
    for (let x = -763; x < -757; x++) for (let y = 698; y < 704; y++) tiles.push({ name: "grass-1", position: { x, y } })
    surface.set_tiles(tiles, true, true, true)
    surface.create_entity({ name: MODELS[0].placer, position, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position, radius: 0.5 })[0])!
    assignProgram(robot, program)
    const record = machineOf(robot.id)
    waitUntil(t, "конца программы", () => record.machine.status === "done" || record.machine.status === "error", 300, () => {
      expect(record.machine.status).toBe("done")
      expect(record.console.slice(1, 4)).toEqual(["1", "2", "3"])
      robot.entity.destroy()
    })
  })

  test("ошибка схемы — на узле, публикации нет", () => {
    const program = findProgram("ws/count")!
    const ws = workshopOf(program.id)!
    const b = new GraphBuilder()
    const start = b.node("start")
    const say = b.node("say")
    b.exec(start, say)
    buildGraph(ws, b.layout())
    const version = program.version
    const { build } = publishWorkshop(ws, program, "тест")
    expect(build.errors.length > 0).toBe(true)
    expect(build.errors[0].node).toBe(say.id)
    expect(ws.nodes[say.id]?.error !== undefined).toBe(true)
    expect(program.version).toBe(version)
    deleteProgram(program.id)
    expect(workshopOf(program.id)).toBe(undefined)
  })
})
