// Перенос и удаление узлов (23.1): узел переезжает на сдвиг рамки вместе с проводами и подписями; на занятое
// другим узлом место — нет. Мышью (инструмент «Перенос», Delete) — npm run test:sim.
import { GraphBuilder } from "../graph/builder"
import { Graph } from "../graph/model"
import { deleteProgram, findProgram, publish } from "../program/store"
import { ensureWorkshop, moveNode, readGraph } from "../workshop/entities"
import { dragOffset } from "../workshop/move"
import { describe, expect, test } from "./testing"

function graph(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const print = b.node("print")
  b.exec(start, print)
  return b.layout()
}

describe("перенос узлов", () => {
  test("узел переезжает с проводами и подписями; на место другого узла — нет", () => {
    const old = findProgram("ws/move")
    if (old !== undefined) deleteProgram(old.id)
    const result = publish({ name: "ws/move", source: "// схема\n", graph: graph() })
    if (!result.ok) error("программа не опубликована")
    const ws = ensureWorkshop(result.program.id, result.program.force, graph())
    const before = readGraph(ws).graph
    const [first, second] = [before.nodes[0], before.nodes[1]]
    expect(moveNode(ws, second.id, 7, 3)).toBe(true)
    const after = readGraph(ws)
    const moved = after.graph.nodes.find((n) => n.id === second.id)!
    expect(`${moved.x - second.x},${moved.y - second.y}`).toBe("7,3")
    expect(after.problems.length).toBe(0)
    const wires = (g: Graph) => g.wires.map((w) => `${w.from}.${w.out}>${w.to}.${w.in}`).sort()
    expect(wires(after.graph)).toEqual(wires(before))
    // Подписи прицеплены к телу — едут с ним.
    const title = ws.nodes[second.id]!.renders[0]
    expect((title.left_top as { entity?: unknown }).entity === ws.nodes[second.id]!.body).toBe(true)
    // На место первого узла — нельзя, узел остаётся.
    expect(moveNode(ws, second.id, first.x - moved.x, first.y - moved.y)).toBe(false)
    const stayed = readGraph(ws).graph.nodes.find((n) => n.id === second.id)!
    expect(`${stayed.x},${stayed.y}`).toBe(`${moved.x},${moved.y}`)
  })

  test("сдвиг рамки: от начала до угла напротив, по клеткам", () => {
    const start = { x: 10.2, y: 5.4 }
    const area = { left_top: { x: 10.2, y: 2.1 }, right_bottom: { x: 13.6, y: 5.4 } }
    expect(dragOffset(start, area)).toEqual({ dx: 3, dy: -3 })
  })
})
