// Внутриигровые тесты добычи.
import { MapPosition } from "factorio:runtime"
import { currentAction, lastActionResult, startAction } from "../automaton/actions"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

/** Ровная площадка без ресурсов и сущностей. */
function arena(left: number, top: number, size: number): void {
  const surface = nauvis()
  surface.request_to_generate_chunks({ x: left + size / 2, y: top + size / 2 }, 2)
  surface.force_generate_chunk_requests()
  for (const entity of surface.find_entities_filtered({ area: [[left, top], [left + size, top + size]] })) entity.destroy()
  const tiles = []
  for (let x = left; x < left + size; x++) for (let y = top; y < top + size; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
}

function place(position: MapPosition): RobotRecord {
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

function ore(name: string, position: MapPosition, amount: number) {
  return nauvis().create_entity({ name, position, amount })!
}

describe("добыча", () => {
  test("выкапывает сколько просили, руда — в груз, запас месторождения уменьшается", (t) => {
    arena(-200, 0, 20)
    const patch = ore("iron-ore", { x: -189.5, y: 10.5 }, 100)
    const robot = place({ x: -191.5, y: 10.5 })
    startAction(robot, "mine", { item: "iron-ore", count: 3 })
    expect(robot.activity).toBe("mine")
    expect(robot.direction).toBe(2) // руда на востоке
    waitUntil(t, "конца добычи", () => currentAction(robot) === undefined, 900, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(lastActionResult(robot)?.count).toBe(3)
      expect(robot.cargo.get_item_count("iron-ore")).toBe(3)
      expect(patch.amount).toBe(97)
      expect(robot.activity).toBe("idle")
      robot.entity.destroy()
      patch.destroy()
    })
  })

  test("кончилась клетка — переходит на соседнюю; кончились все — «нечего добывать»", (t) => {
    arena(-200, 30, 20)
    ore("copper-ore", { x: -189.5, y: 40.5 }, 1)
    ore("copper-ore", { x: -189.5, y: 41.5 }, 1)
    const robot = place({ x: -191.5, y: 40.5 })
    startAction(robot, "mine", { item: "copper-ore", count: 5 })
    waitUntil(t, "конца добычи", () => currentAction(robot) === undefined, 1500, () => {
      expect(lastActionResult(robot)?.error).toBe("no-resource")
      expect(lastActionResult(robot)?.count).toBe(2)
      expect(robot.cargo.get_item_count("copper-ore")).toBe(2)
      expect(nauvis().find_entities_filtered({ name: "copper-ore", area: [[-200, 30], [-180, 50]] }).length).toBe(0)
      robot.entity.destroy()
    })
  })

  test("полный груз — ошибка cargo-full", () => {
    arena(-200, 60, 20)
    const patch = ore("stone", { x: -189.5, y: 70.5 }, 100)
    const robot = place({ x: -191.5, y: 70.5 })
    for (let i = 0; i < robot.cargo.length; i++) robot.cargo.insert({ name: "wood", count: 100 })
    startAction(robot, "mine", { item: "stone" })
    expect(lastActionResult(robot)?.error).toBe("cargo-full")
    robot.entity.destroy()
    patch.destroy()
  })

  test("месторождение далеко — «нечего добывать», указанная цель далеко — «далеко»", () => {
    arena(-200, 90, 20)
    const patch = ore("coal", { x: -185.5, y: 100.5 }, 100)
    const robot = place({ x: -195.5, y: 100.5 })
    startAction(robot, "mine", { item: "coal" })
    expect(lastActionResult(robot)?.error).toBe("no-resource")
    startAction(robot, "mine", { target: patch })
    expect(lastActionResult(robot)?.error).toBe("out-of-reach")
    robot.entity.destroy()
    patch.destroy()
  })
})
