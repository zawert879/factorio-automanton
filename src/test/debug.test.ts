// Отладка машины (18.8): точка остановки ставит машину на паузу на строке, «Шаг» — до следующей строки,
// продолжение — до конца; переменные верхнего уровня читаются из кадра; точки — только у этой машины.
import { findRobot, RobotRecord } from "../automaton/registry"
import { MODELS } from "../names"
import { assignProgram, machineOf, wake } from "../program/machines"
import { stepMachine } from "../program/scheduler"
import { deleteProgram, findProgram, publish } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

function place(x: number, y: number): RobotRecord {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x, y }, 1)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[x - 2, y - 2], [x + 3, y + 3]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let tx = x - 2; tx < x + 3; tx++) for (let ty = y - 2; ty < y + 3; ty++) tiles.push({ name: "grass-1", position: { x: tx, y: ty } })
  surface.set_tiles(tiles, true, true, true)
  const position = { x: x + 0.5, y: y + 0.5 }
  surface.create_entity({ name: MODELS[0].placer, position, force: "player", raise_built: true })
  return findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position, radius: 0.5 })[0])!
}

const SOURCE = `let a = 1
a = a + 1
a = a * 10
const b = a + 5
wait(1)
`

describe("отладка машины", () => {
  test("точка, шаг, продолжение; переменные; другая машина не встаёт", (t) => {
    const old = findProgram("dbg/seq")
    if (old !== undefined) deleteProgram(old.id)
    const published = publish({ name: "dbg/seq", source: SOURCE })
    if (!published.ok) error("программа не опубликована")
    const program = published.program
    expect(program.breakable).toEqual([1, 2, 3, 4, 5])
    const robot = place(-740, 660)
    const other = place(-736, 660)
    for (const r of [robot, other]) r.fuel.insert({ name: "coal", count: 10 })
    const record = machineOf(robot.id)
    record.breakpoints = { 3: true }
    assignProgram(robot, program)
    assignProgram(other, program)
    const value = (name: string) => {
      const v = program.variables!.find((x) => x.name === name)!
      return (record.machine.frame as Record<number, unknown>)[v.slot]
    }
    waitUntil(t, "остановка на строке 3", () => record.stopLine === 3, 120, () => {
      expect(record.paused).toBe(true)
      expect(value("a")).toBe(2)
      // Точка — только у этой машины: вторая дошла до wait и ждёт.
      expect(machineOf(other.id).paused).toBe(undefined)
      expect(machineOf(other.id).machine.status).toBe("waiting")
      stepMachine(record)
      expect(record.stopLine).toBe(4)
      expect(value("a")).toBe(20)
      record.paused = undefined
      record.stopLine = undefined
      wake(robot.id)
      waitUntil(t, "конец программы", () => record.machine.status === "done", 300, () => {
        expect(record.stopLine).toBe(undefined)
        for (const r of [robot, other]) r.entity.destroy({ raise_destroy: true })
        deleteProgram(findProgram("dbg/seq")!.id)
      })
    })
  })
})
