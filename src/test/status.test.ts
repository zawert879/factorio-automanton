// Внутриигровые тесты статуса над машиной: значок проблемы и облачко.
import { MapPosition } from "factorio:runtime"
import { startAction } from "../automaton/actions"
import { isMoving, moveRobot } from "../automaton/movement"
import { findRobot, RobotRecord } from "../automaton/registry"
import { problemFor, say } from "../automaton/status"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

function place(position: MapPosition): RobotRecord {
  const free = nauvis().find_non_colliding_position(WORKER_MK1, position, 20, 0.5)!
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position: free, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position: free, radius: 0.5 })[0])!
}

describe("статус над машиной", () => {
  test("коды ошибок → значки", () => {
    expect(problemFor("no-fuel")).toBe("fuel")
    expect(problemFor("stuck")).toBe("no-path")
    expect(problemFor("target-full")).toBe("full")
    expect(problemFor("out-of-reach")).toBe("warning")
    expect(problemFor("internal-error")).toBe("danger")
    expect(problemFor("cancelled")).toBe(undefined)
  })

  test("кончилось топливо — значок топлива; заправка и новая поездка его снимают", (t) => {
    const robot = place({ x: -420, y: 0 })
    robot.energy = 0
    moveRobot(robot, { position: { x: -410, y: 0 } })
    waitUntil(t, "отказа", () => !isMoving(robot), 300, () => {
      expect(robot.problem?.valid).toBe(true)
      expect(robot.problem!.sprite).toBe("utility/fuel_icon")
      robot.cargo.insert({ name: "coal", count: 2 })
      startAction(robot, "refuel", {})
      expect(robot.problem).toBe(undefined)
      robot.entity.destroy()
    })
  })

  test("ошибка действия — значок; облачко живёт заданное время", () => {
    const robot = place({ x: -420, y: 20 })
    startAction(robot, "put", { item: "coal" })
    expect(robot.problem?.sprite).toBe("utility/warning_icon")
    say(robot, "Привет!", 2)
    expect(robot.bubble?.valid).toBe(true)
    expect(robot.bubble!.text).toBe("Привет!")
    expect(robot.bubble!.time_to_live).toBe(120)
    robot.entity.destroy()
  })
})
