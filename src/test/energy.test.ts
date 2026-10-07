// Внутриигровые тесты энергии машины Mk1.
import { MapPosition } from "factorio:runtime"
import { currentAction, lastActionResult, startAction } from "../automaton/actions"
import { MOVE_JOULES_PER_TILE, spend } from "../automaton/energy"
import { isMoving, lastMoveResult, moveRobot } from "../automaton/movement"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

function arena(left: number, top: number, width: number, height: number): void {
  const surface = nauvis()
  surface.request_to_generate_chunks({ x: left + width / 2, y: top + height / 2 }, 2)
  surface.force_generate_chunk_requests()
  for (const entity of surface.find_entities_filtered({ area: [[left, top], [left + width, top + height]] })) entity.destroy()
  const tiles = []
  for (let x = left; x < left + width; x++) for (let y = top; y < top + height; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
}

function place(position: MapPosition): RobotRecord {
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

describe("энергия", () => {
  test("тратит запас, потом жжёт топливо из слота, без топлива — отказ", () => {
    arena(-380, 0, 10, 10)
    const robot = place({ x: -375.5, y: 5.5 })
    robot.energy = 1000
    expect(spend(robot, 600)).toBe(true)
    expect(robot.energy).toBe(400)
    robot.fuel.insert({ name: "coal", count: 1 })
    expect(spend(robot, 1000)).toBe(true)
    expect(robot.fuel.get_item_count("coal")).toBe(0)
    expect(robot.energy).toBe(400 + 4_000_000 - 1000)
    expect(spend(robot, 10_000_000)).toBe(false)
    expect(robot.energy).toBe(0)
    robot.entity.destroy()
  })

  test("поездка без топлива обрывается «кончилось топливо»", (t) => {
    arena(-400, 20, 50, 20)
    const robot = place({ x: -395.5, y: 30.5 })
    robot.energy = 5 * MOVE_JOULES_PER_TILE // хватит примерно на 5 клеток
    const start = robot.entity.position
    moveRobot(robot, { position: { x: -360.5, y: 30.5 } })
    waitUntil(t, "остановки", () => !isMoving(robot), 900, () => {
      expect(lastMoveResult(robot)).toBe("no-fuel")
      const travelled = robot.entity.position.x - start.x
      expect(travelled > 3 && travelled < 9).toBe(true)
      expect(robot.activity).toBe("idle")
      robot.entity.destroy()
    })
  })

  test("с углём в слоте доезжает, уголь сжигается", (t) => {
    arena(-400, 50, 50, 20)
    const robot = place({ x: -395.5, y: 60.5 })
    robot.energy = 0
    robot.fuel.insert({ name: "coal", count: 3 })
    moveRobot(robot, { position: { x: -370.5, y: 60.5 } })
    waitUntil(t, "приезда", () => !isMoving(robot), 900, () => {
      expect(lastMoveResult(robot)).toBe("arrived")
      expect(robot.fuel.get_item_count("coal")).toBe(2)
      robot.entity.destroy()
    })
  })

  test("добыча без топлива останавливается", (t) => {
    arena(-400, 80, 20, 20)
    const ore = nauvis().create_entity({ name: "iron-ore", position: { x: -388.5, y: 90.5 }, amount: 100 })!
    const robot = place({ x: -390.5, y: 90.5 })
    robot.energy = 400_000 // единица железа — 2 с по 150 кВт = 300 кДж: хватит на одну
    startAction(robot, "mine", { item: "iron-ore", count: 5 })
    waitUntil(t, "остановки добычи", () => currentAction(robot) === undefined, 900, () => {
      expect(lastActionResult(robot)?.reason).toBe("no-fuel")
      expect(robot.cargo.get_item_count("iron-ore")).toBe(1)
      robot.entity.destroy()
      ore.destroy()
    })
  })

  test("заправка берёт лучшее топливо из груза, даже с пустым запасом", (t) => {
    arena(-400, 110, 10, 10)
    const robot = place({ x: -395.5, y: 115.5 })
    robot.energy = 0
    robot.cargo.insert({ name: "wood", count: 10 })
    robot.cargo.insert({ name: "coal", count: 10 })
    robot.cargo.insert({ name: "solid-fuel", count: 3 })
    startAction(robot, "refuel", {})
    waitUntil(t, "заправки", () => currentAction(robot) === undefined, 120, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(robot.fuel.get_item_count("solid-fuel")).toBe(3)
      expect(robot.cargo.get_item_count("solid-fuel")).toBe(0)
      expect(robot.cargo.get_item_count("coal")).toBe(10)
      robot.entity.destroy()
    })
  })
})
