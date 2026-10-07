// Внутриигровые тесты системы действий: шаги по таймерам, отмена, досягаемость, разворот к цели.
import { MapPosition } from "factorio:runtime"
import { cancelAction, currentAction, distanceToEntity, face, lastActionResult, startAction } from "../automaton/actions"
import { isMoving, moveRobot } from "../automaton/movement"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

function place(near: MapPosition): RobotRecord {
  const position = nauvis().find_non_colliding_position(WORKER_MK1, near, 30, 0.5)!
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

describe("система действий", () => {
  test("ожидание длится заданное время и заканчивается успехом", (t) => {
    const robot = place({ x: -80, y: 60 })
    const started = game.tick
    startAction(robot, "wait", { seconds: 2 })
    expect(currentAction(robot)?.kind).toBe("wait")
    waitUntil(t, "конца ожидания", () => currentAction(robot) === undefined, 300, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(game.tick - started >= 120).toBe(true)
      robot.entity.destroy()
    })
  })

  test("новое действие отменяет текущее, у отменённого — ошибка cancelled", () => {
    const robot = place({ x: -80, y: 60 })
    startAction(robot, "wait", { seconds: 10 })
    cancelAction(robot)
    expect(currentAction(robot)).toBe(undefined)
    expect(lastActionResult(robot)?.error).toBe("cancelled")
    robot.entity.destroy()
  })

  test("действие останавливает поездку", () => {
    const robot = place({ x: -80, y: 70 })
    moveRobot(robot, { position: { x: -40, y: 70 } })
    expect(isMoving(robot)).toBe(true)
    startAction(robot, "wait", { seconds: 1 })
    expect(isMoving(robot)).toBe(false)
    robot.entity.destroy()
  })

  test("расстояние до здания меряется до его края", () => {
    const chest = nauvis().create_entity({ name: "wooden-chest", position: { x: -79.5, y: 90.5 }, force: "player" })!
    expect(distanceToEntity({ x: -79.5, y: 90.5 }, chest)).toBe(0)
    const d = distanceToEntity({ x: -74.5, y: 90.5 }, chest)
    expect(d > 4 && d < 5).toBe(true)
    chest.destroy()
  })

  test("машина поворачивается лицом к цели", () => {
    const robot = place({ x: -80, y: 100 })
    const { x, y } = robot.entity.position
    face(robot, { x: x + 5, y }, "idle")
    expect(robot.direction).toBe(2)
    face(robot, { x, y: y + 5 }, "mine")
    expect(robot.direction).toBe(4)
    expect(robot.activity).toBe("mine")
    robot.entity.destroy()
  })
})
