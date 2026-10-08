// Внутриигровые тесты летающих машин (этап 11): расчётный полёт, прибытие по таймеру, энергия,
// отмена посреди пути, ограничения модели, программа на летающей.
import { MapPosition } from "factorio:runtime"
import { FLY_JOULES_PER_TILE, robotPosition } from "../automaton/flight"
import { cancelMove, isMoving, lastMoveResult, moveRobot } from "../automaton/movement"
import { findRobot, RobotRecord } from "../automaton/registry"
import { FLYER_MK1, MODELS } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

const FLYER = MODELS.find((m) => m.entity === FLYER_MK1)!

function nauvis() {
  return game.get_surface("nauvis")!
}

function placeFlyer(position: MapPosition): RobotRecord {
  const surface = nauvis()
  surface.request_to_generate_chunks(position, 2)
  surface.force_generate_chunk_requests()
  surface.create_entity({ name: FLYER.placer, position, force: "player", raise_built: true })
  return findRobot(surface.find_entities_filtered({ name: FLYER.entity, position, radius: 0.5 })[0])!
}

describe("летающие машины", () => {
  test("летит по прямой: прибытие через расстояние / скорость, энергия за весь путь сразу", (t) => {
    const robot = placeFlyer({ x: -800.5, y: 500.5 })
    expect(robot.entity.type).toBe("simple-entity-with-owner")
    const energy = robot.energy
    moveRobot(robot, { position: { x: -770.5, y: 500.5 } }, { radius: 0 })
    expect(isMoving(robot)).toBe(true)
    expect(math.floor(energy - robot.energy + 0.5)).toBe(30 * FLY_JOULES_PER_TILE)
    // 30 клеток при 0.25 клетки за тик — 120 тиков.
    t.after(60, () => {
      // Игроков рядом нет: заместитель стоит на месте, а рассчитанная позиция — посередине пути.
      expect(robot.entity.position.x).toBe(-800.5)
      expect(math.floor(robotPosition(robot).x + 0.5)).toBe(-785)
      expect(robot.activity).toBe("run")
    })
    t.after(125, () => {
      expect(isMoving(robot)).toBe(false)
      expect(lastMoveResult(robot)).toBe("arrived")
      expect(robot.entity.position.x).toBe(-770.5)
      expect(robot.activity).toBe("idle")
      robot.entity.destroy()
    })
  })

  test("отмена посреди полёта — машина там, где её застали; без заряда не взлетает", (t) => {
    const robot = placeFlyer({ x: -800.5, y: 520.5 })
    moveRobot(robot, { position: { x: -760.5, y: 520.5 } }, { radius: 0 })
    t.after(40, () => {
      cancelMove(robot)
      expect(isMoving(robot)).toBe(false)
      expect(math.floor(robot.entity.position.x + 0.5)).toBe(-790)
      robot.energy = 0
      moveRobot(robot, { position: { x: -700.5, y: 520.5 } })
      t.after(2, () => {
        expect(lastMoveResult(robot)).toBe("no-fuel")
        expect(math.floor(robot.entity.position.x + 0.5)).toBe(-790)
        robot.entity.destroy()
      })
    })
  })

  test("программа: move, canReach, me.position; не добывает, бака нет", (t) => {
    const robot = placeFlyer({ x: -800.5, y: 540.5 })
    const result = publishProgram(
      "test-flyer",
      `print(me.model, canReach({ x: -780, y: 540 }), me.tank === null)
move({ x: -780.5, y: 540.5 })
print(Math.round(me.position.x)) // останавливается в 0.5 клетки от точки
try { mine("iron-ore") } catch (e) { print(e instanceof ActionError ? e.code : "?") }
try { pump("water") } catch (e) { print(e instanceof ActionError ? e.code : "?") }`,
    )
    if (!result.ok) error(describeDiagnostics(result.diagnostics).join("; "))
    const m = assignProgram(robot, result.program)
    waitUntil(t, "конца программы", () => m.machine.status === "done" || m.machine.status === "error", 300, () => {
      expect(m.console.filter((line) => !line.startsWith("—")).join("|")).toBe("flyer-mk1 true true|-781|invalid-target|invalid-target")
      robot.entity.destroy()
    })
  })
})
