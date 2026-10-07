// Внутриигровые тесты движения: поездки к точке и к зданию, объезд стены, «пути нет», очередь приказов.
import { LuaEntity, MapPosition } from "factorio:runtime"
import { isMoving, lastMoveResult, moveRobot } from "../automaton/movement"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

/** Ровная пустая площадка: трава, без деревьев, камней и прочего. Тест не зависит от генерации карты. */
function arena(left: number, top: number, width: number, height: number): void {
  const surface = nauvis()
  surface.request_to_generate_chunks({ x: left + width / 2, y: top + height / 2 }, math.ceil(math.max(width, height) / 64) + 1)
  surface.force_generate_chunk_requests()
  const area = { left_top: { x: left, y: top }, right_bottom: { x: left + width, y: top + height } }
  for (const entity of surface.find_entities_filtered({ area })) entity.destroy()
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

function wall(from: MapPosition, to: MapPosition): void {
  for (let x = from.x; x <= to.x; x++) {
    for (let y = from.y; y <= to.y; y++) nauvis().create_entity({ name: "stone-wall", position: { x, y }, force: "player" })
  }
}

function distance(a: MapPosition, b: MapPosition): number {
  return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function cleanup(entities: LuaEntity[]): void {
  for (const e of entities) if (e.valid) e.destroy()
}

describe("движение", () => {
  test("едет к точке на открытой местности", (t) => {
    arena(200, 0, 50, 20)
    const robot = placeRobot({ x: 205.5, y: 10.5 })
    const target = { x: 235.5, y: 10.5 }
    moveRobot(robot, { position: target })
    expect(isMoving(robot)).toBe(true)
    waitUntil(t, "приезда", () => !isMoving(robot), 1200, () => {
      expect(lastMoveResult(robot)).toBe("arrived")
      expect(distance(robot.entity.position, target) < 2).toBe(true)
      cleanup([robot.entity])
    })
  })

  test("объезжает стену, а не ломится напрямик", (t) => {
    arena(200, 30, 50, 24)
    wall({ x: 220, y: 30 }, { x: 220, y: 47 }) // стена во всю высоту, кроме прохода снизу
    const robot = placeRobot({ x: 210.5, y: 35.5 })
    const target = { x: 230.5, y: 35.5 }
    moveRobot(robot, { position: target })
    waitUntil(t, "приезда в обход", () => !isMoving(robot), 1800, () => {
      expect(lastMoveResult(robot)).toBe("arrived")
      expect(distance(robot.entity.position, target) < 2).toBe(true)
      cleanup([robot.entity, ...nauvis().find_entities_filtered({ name: "stone-wall" })])
    })
  })

  test("сообщает, что пути нет, если цель замурована", (t) => {
    arena(200, 60, 50, 20)
    wall({ x: 236, y: 66 }, { x: 242, y: 66 })
    wall({ x: 236, y: 72 }, { x: 242, y: 72 })
    wall({ x: 236, y: 67 }, { x: 236, y: 71 })
    wall({ x: 242, y: 67 }, { x: 242, y: 71 })
    const robot = placeRobot({ x: 205.5, y: 69.5 })
    moveRobot(robot, { position: { x: 239.5, y: 69.5 } })
    waitUntil(t, "отказа", () => !isMoving(robot), 1800, () => {
      expect(lastMoveResult(robot)).toBe("no-path")
      cleanup([robot.entity, ...nauvis().find_entities_filtered({ name: "stone-wall" })])
    })
  })

  test("едет к зданию", (t) => {
    arena(200, 90, 50, 20)
    const chest = nauvis().create_entity({ name: "iron-chest", position: { x: 235.5, y: 100.5 }, force: "player" })!
    const robot = placeRobot({ x: 205.5, y: 100.5 })
    moveRobot(robot, { entity: chest })
    waitUntil(t, "приезда к сундуку", () => !isMoving(robot), 1200, () => {
      expect(lastMoveResult(robot)).toBe("arrived")
      expect(distance(robot.entity.position, chest.position) < 3).toBe(true)
      cleanup([robot.entity, chest])
    })
  })

  test("новый приказ заменяет прежний", (t) => {
    arena(200, 120, 50, 20)
    const robot = placeRobot({ x: 225.5, y: 130.5 })
    moveRobot(robot, { position: { x: 205.5, y: 130.5 } })
    t.after(30, () => {
      const target = { x: 245.5, y: 130.5 }
      moveRobot(robot, { position: target })
      waitUntil(t, "приезда к новой цели", () => !isMoving(robot), 1500, () => {
        expect(lastMoveResult(robot)).toBe("arrived")
        expect(distance(robot.entity.position, target) < 2).toBe(true)
        cleanup([robot.entity])
      })
    })
  })

  test("приказы отдаются движку не больше 20 за тик", (t) => {
    arena(200, 150, 40, 20)
    const robots: RobotRecord[] = []
    for (let i = 0; i < 30; i++) robots.push(placeRobot({ x: 202.5 + (i % 10) * 3, y: 152.5 + math.floor(i / 10) * 3 }))
    for (const robot of robots) moveRobot(robot, { position: { x: 220.5, y: 165.5 } })
    expect(storage.movement.queue.length).toBe(30)
    t.after(1, () => {
      expect(storage.movement.queue.length).toBe(10)
      t.after(1, () => {
        expect(storage.movement.queue.length).toBe(0)
        cleanup(robots.map((r) => r.entity))
      })
    })
  })

  test("встречные потоки через проход в 2 клетки: доезжают все", (t) => {
    arena(300, 0, 80, 30)
    for (let y = 0; y < 30; y++) {
      if (y !== 14 && y !== 15) nauvis().create_entity({ name: "stone-wall", position: { x: 340, y }, force: "player" })
    }
    const robots: RobotRecord[] = []
    for (let i = 0; i < 20; i++) {
      const y = 3.5 + math.floor(i / 5) * 6
      const left = placeRobot({ x: 305.5 + (i % 5) * 3, y })
      const right = placeRobot({ x: 360.5 + (i % 5) * 3, y })
      moveRobot(left, { position: { x: left.entity.position.x + 55, y } })
      moveRobot(right, { position: { x: right.entity.position.x - 55, y } })
      robots.push(left, right)
    }
    waitUntil(t, "проезда всех", () => robots.every((r) => !isMoving(r)), 3600, () => {
      expect(robots.filter((r) => lastMoveResult(r) === "arrived").length).toBe(40)
      cleanup([...robots.map((r) => r.entity), ...nauvis().find_entities_filtered({ name: "stone-wall" })])
    })
  })
})
