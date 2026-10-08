// Библиотека программ и отладка (этап 5): переименование, занятое имя, удаление и карантин
// останавливают машины, пауза и шаг, текущая строка программы.
import { findRobot, RobotRecord } from "../automaton/registry"
import { pausedLine } from "../lang/runtime"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { assignProgram, machineOf, wake } from "../program/machines"
import { stepMachine } from "../program/scheduler"
import { deleteProgram, loadedProgram, noteLimitError, publish, QUARANTINE_ERRORS } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

function robotAt(x: number, y: number): RobotRecord {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x, y }, 1)
  surface.force_generate_chunk_requests()
  const position = surface.find_non_colliding_position(WORKER_MK1, { x, y }, 20, 0.5)!
  surface.create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(surface.find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

function published(name: string, source: string, id?: number) {
  const result = publish({ name, source, id })
  if (!result.ok) error(`не опубликована: ${result.diagnostics[0].code}`)
  return result.program
}

describe("библиотека программ", () => {
  test("переименование по id, занятое имя, история версий", () => {
    const a = published("lib-a", `print(1)`)
    const b = published("lib-b", `print(2)`)
    const renamed = published("lib-a2", `print(3)`, a.id)
    expect(renamed.id).toBe(a.id)
    expect(renamed.name).toBe("lib-a2")
    expect(renamed.history.length).toBe(2)
    const taken = publish({ name: "lib-b", source: `print(4)`, id: a.id })
    expect(taken.ok).toBe(false)
    if (!taken.ok) expect(taken.diagnostics[0].code).toBe("program-name-taken")
    deleteProgram(a.id)
    deleteProgram(b.id)
  })

  test("удаление программы останавливает её машины", (t) => {
    const robot = robotAt(-1200, 100)
    const program = published("lib-loop", `while (true) wait(1)`)
    const record = assignProgram(robot, program)
    waitUntil(t, "запуска", () => record.machine.status === "waiting", 60, () => {
      deleteProgram(program.id)
      expect(record.machine.status).toBe("done")
      expect(record.programId).toBe(undefined)
      robot.entity.destroy()
    })
  })

  test("карантин после постоянных ошибок лимитов; новая версия снимает его", () => {
    const robot = robotAt(-1230, 100)
    const program = published("lib-quarantine", `while (true) wait(1)`)
    const record = assignProgram(robot, program)
    for (let i = 0; i < QUARANTINE_ERRORS - 1; i++) expect(noteLimitError(program)).toBe(false)
    expect(noteLimitError(program)).toBe(true)
    expect(program.quarantined).toBe(true)
    expect(record.machine.status).toBe("done")
    published("lib-quarantine", `while (true) wait(2)`)
    expect(program.quarantined).toBe(undefined)
    expect(record.machine.status).toBe("ready")
    deleteProgram(program.id)
    robot.entity.destroy()
  })

  test("пауза, шаг и текущая строка", (t) => {
    const robot = robotAt(-1260, 100)
    const program = published("lib-step", `let n = 0\nwhile (true) {\n  n++\n  if (n > 1000000) wait(1)\n}`)
    const record = assignProgram(robot, program)
    record.paused = true
    t.after(5, () => {
      expect(record.machine.status).toBe("ready")
      expect(record.machine.frame).toBe(undefined)
      // Первый шаг останавливается на входе в программу (строка 1), второй — на витке цикла.
      stepMachine(record)
      stepMachine(record)
      const loaded = loadedProgram(program)
      expect(type(loaded)).toBe("table")
      if (typeof loaded !== "string") expect(pausedLine(loaded, record.machine)).toBe(2)
      record.paused = undefined
      wake(robot.id)
      deleteProgram(program.id)
      robot.entity.destroy()
    })
  })
})

void machineOf
