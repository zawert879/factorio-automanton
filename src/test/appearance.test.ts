// Внутриигровые тесты тела машины: анимация-накладка по занятию и направлению.
import { MapPosition } from "factorio:runtime"
import { directionOf } from "../automaton/appearance"
import { isMoving, moveRobot } from "../automaton/movement"
import { adoptUnregisteredRobots, findRobot, RobotRecord } from "../automaton/registry"
import { bodyAnimationName, WORKER_MK1, WORKER_MK1_PLACER } from "../names"
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
  for (let x = left; x < left + width; x++) {
    for (let y = top; y < top + height; y++) tiles.push({ name: "grass-1", position: { x, y } })
  }
  surface.set_tiles(tiles, true, true, true)
}

function placeRobot(position: MapPosition): RobotRecord {
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

describe("тело машины", () => {
  test("направление анимации по ориентации: север 0, восток 2, юг 4, запад 6", () => {
    expect(directionOf(0)).toBe(0)
    expect(directionOf(0.25)).toBe(2)
    expect(directionOf(0.5)).toBe(4)
    expect(directionOf(0.75)).toBe(6)
    expect(directionOf(0.99)).toBe(0)
  })

  test("поставленная машина стоит с анимацией простоя", () => {
    arena(260, 0, 40, 20)
    const robot = placeRobot({ x: 265.5, y: 10.5 })
    expect(robot.body.valid).toBe(true)
    expect(robot.activity).toBe("idle")
    expect(robot.body.animation).toBe(bodyAnimationName(WORKER_MK1, "idle", robot.direction))
    robot.entity.destroy()
  })

  test("едет на восток — бег на восток, приехала — простой лицом на восток", (t) => {
    arena(260, 30, 40, 20)
    const robot = placeRobot({ x: 265.5, y: 40.5 })
    moveRobot(robot, { position: { x: 290.5, y: 40.5 } })
    t.after(60, () => {
      expect(robot.activity).toBe("run")
      expect(robot.body.animation).toBe(bodyAnimationName(WORKER_MK1, "run", 2))
      waitUntil(t, "приезда", () => !isMoving(robot), 900, () => {
        expect(robot.body.animation).toBe(bodyAnimationName(WORKER_MK1, "idle", 2))
        robot.entity.destroy()
      })
    })
  })

  test("едет на север — бег на север", (t) => {
    arena(260, 60, 20, 40)
    const robot = placeRobot({ x: 270.5, y: 95.5 })
    moveRobot(robot, { position: { x: 270.5, y: 65.5 } })
    t.after(60, () => {
      expect(robot.body.animation).toBe(bodyAnimationName(WORKER_MK1, "run", 0))
      robot.entity.destroy()
    })
  })

  test("гибель машины убирает тело", (t) => {
    arena(260, 110, 20, 20)
    const robot = placeRobot({ x: 270.5, y: 120.5 })
    const body = robot.body
    robot.entity.die()
    t.after(2, () => expect(body.valid).toBe(false))
  })

  test("запись без тела (старая версия мода) получает тело при обновлении мода", () => {
    arena(260, 140, 20, 20)
    const robot = placeRobot({ x: 270.5, y: 150.5 })
    robot.body.destroy()
    adoptUnregisteredRobots()
    expect(robot.body.valid).toBe(true)
    expect(robot.body.animation).toBe(bodyAnimationName(WORKER_MK1, "idle", robot.direction))
    robot.entity.destroy()
  })
})
