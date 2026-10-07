// Внутриигровые тесты: подобрать, выбросить, передать, починить.
import { MapPosition } from "factorio:runtime"
import { currentAction, lastActionResult, startAction } from "../automaton/actions"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

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

function groundCount(position: MapPosition, radius: number, item: string): number {
  let count = 0
  for (const e of nauvis().find_entities_filtered({ type: "item-entity", position, radius })) {
    if (e.stack?.name === item) count += e.stack.count
  }
  return count
}

describe("подобрать и выбросить", () => {
  test("подбирает лежащее вплотную, дальнее не трогает", (t) => {
    arena(-320, 0, 20)
    const robot = place({ x: -310.5, y: 10.5 })
    nauvis().spill_item_stack({ position: robot.entity.position, stack: { name: "iron-plate", count: 30 } })
    nauvis().spill_item_stack({ position: { x: -305.5, y: 10.5 }, stack: { name: "iron-plate", count: 7 } })
    startAction(robot, "pickup", { item: "iron-plate" })
    waitUntil(t, "подбора", () => currentAction(robot) === undefined, 600, () => {
      expect(robot.cargo.get_item_count("iron-plate")).toBe(30)
      expect(groundCount({ x: -305.5, y: 10.5 }, 1, "iron-plate")).toBe(7)
      for (const e of nauvis().find_entities_filtered({ type: "item-entity", area: [[-320, 0], [-300, 20]] })) e.destroy()
      robot.entity.destroy()
    })
  })

  test("выбрасывает из груза на землю рядом", (t) => {
    arena(-320, 30, 20)
    const robot = place({ x: -310.5, y: 40.5 })
    robot.cargo.insert({ name: "stone", count: 25 })
    startAction(robot, "drop", { item: "stone", count: 10 })
    waitUntil(t, "выброса", () => currentAction(robot) === undefined, 120, () => {
      expect(lastActionResult(robot)?.count).toBe(10)
      expect(robot.cargo.get_item_count("stone")).toBe(15)
      expect(groundCount(robot.entity.position, 3, "stone")).toBe(10)
      for (const e of nauvis().find_entities_filtered({ type: "item-entity", area: [[-320, 30], [-300, 50]] })) e.destroy()
      robot.entity.destroy()
    })
  })
})

describe("передать", () => {
  test("передаёт другой машине рядом в её груз", (t) => {
    arena(-320, 60, 20)
    const from = place({ x: -315.5, y: 70.5 })
    const to = place({ x: -310.5, y: 70.5 })
    from.cargo.insert({ name: "coal", count: 40 })
    startAction(from, "give", { target: to.entity, item: "coal", count: 15 })
    waitUntil(t, "передачи", () => currentAction(from) === undefined, 120, () => {
      expect(lastActionResult(from)?.count).toBe(15)
      expect(from.cargo.get_item_count("coal")).toBe(25)
      expect(to.cargo.get_item_count("coal")).toBe(15)
      from.entity.destroy()
      to.entity.destroy()
    })
  })

  test("не машине или далёкой машине — ошибка", () => {
    arena(-320, 90, 30)
    const from = place({ x: -318.5, y: 100.5 })
    const far = place({ x: -295.5, y: 100.5 })
    const chest = nauvis().create_entity({ name: "wooden-chest", position: { x: -316.5, y: 100.5 }, force: "player" })!
    from.cargo.insert({ name: "coal", count: 5 })
    startAction(from, "give", { target: chest, item: "coal" })
    expect(lastActionResult(from)?.error).toBe("invalid-target")
    startAction(from, "give", { target: far.entity, item: "coal" })
    expect(lastActionResult(from)?.error).toBe("out-of-reach")
    from.entity.destroy()
    far.entity.destroy()
    chest.destroy()
  })
})

describe("починить", () => {
  test("чинит здание ремкомплектом из груза, прочность ремкомплекта тратится", (t) => {
    arena(-320, 130, 20)
    const robot = place({ x: -315.5, y: 140.5 })
    const wall = nauvis().create_entity({ name: "stone-wall", position: { x: -310.5, y: 140.5 }, force: "player" })!
    wall.health = wall.max_health - 100
    robot.cargo.insert({ name: "repair-pack", count: 2 })
    startAction(robot, "repair", { target: wall })
    waitUntil(t, "починки", () => currentAction(robot) === undefined, 600, () => {
      expect(wall.health).toBe(wall.max_health)
      expect(lastActionResult(robot)?.count).toBe(100)
      const [pack] = robot.cargo.find_item_stack("repair-pack")
      expect(pack !== undefined && pack.durability! < pack.prototype.get_durability()!).toBe(true)
      robot.entity.destroy()
      wall.destroy()
    })
  })

  test("чинит другую машину; без ремкомплекта — ошибка", (t) => {
    arena(-320, 160, 20)
    const medic = place({ x: -315.5, y: 170.5 })
    const patient = place({ x: -310.5, y: 170.5 })
    patient.entity.health = 50
    startAction(medic, "repair", { target: patient.entity })
    expect(lastActionResult(medic)?.error).toBe("not-enough-items")
    medic.cargo.insert({ name: "repair-pack", count: 1 })
    startAction(medic, "repair", { target: patient.entity })
    waitUntil(t, "починки машины", () => currentAction(medic) === undefined, 600, () => {
      expect(patient.entity.health).toBe(patient.entity.max_health)
      medic.entity.destroy()
      patient.entity.destroy()
    })
  })
})
