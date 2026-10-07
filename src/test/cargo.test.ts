// Внутриигровые тесты груза, топлива и запаса энергии машины.
import { MapPosition } from "factorio:runtime"
import { replacePlacer } from "../automaton/placement"
import { adoptUnregisteredRobots, CARGO_SLOTS, findRobot, RobotRecord, START_ENERGY, tagFromStack, tagMinedRobot } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

function place(near: MapPosition): RobotRecord {
  const position = nauvis().find_non_colliding_position(WORKER_MK1, near, 30, 0.5)!
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

describe("груз и топливо", () => {
  test("новая машина: пустой груз на 10 слотов, топливный слот, стартовый запас энергии", () => {
    const robot = place({ x: -60, y: 60 })
    expect(robot.cargo.length).toBe(CARGO_SLOTS)
    expect(robot.cargo.is_empty()).toBe(true)
    expect(robot.fuel.length).toBe(1)
    expect(robot.energy).toBe(START_ENERGY)
    robot.entity.destroy()
  })

  test("при подборе груз и топливо уходят игроку, запас энергии — в предмет", () => {
    const robot = place({ x: -60, y: 60 })
    robot.cargo.insert({ name: "iron-ore", count: 120 })
    robot.fuel.insert({ name: "coal", count: 5 })
    robot.energy = 12345
    const buffer = game.create_inventory(20)
    buffer.insert({ name: WORKER_MK1, count: 1 })
    tagMinedRobot(robot.entity, buffer)
    robot.entity.destroy()
    expect(buffer.get_item_count("iron-ore")).toBe(120)
    expect(buffer.get_item_count("coal")).toBe(5)
    const [stack] = buffer.find_item_stack(WORKER_MK1)
    const tag = tagFromStack(stack)!
    expect(tag.energy).toBe(12345)

    const position = nauvis().find_non_colliding_position(WORKER_MK1, { x: -60, y: 60 }, 30, 0.5)!
    replacePlacer(nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player" })!, tag)
    const again = findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
    expect(again.energy).toBe(12345)
    expect(again.cargo.is_empty()).toBe(true)
    again.entity.destroy()
    buffer.destroy()
  })

  test("если инвентарь игрока полон, лишний груз высыпается рядом", () => {
    const robot = place({ x: -60, y: 70 })
    robot.cargo.insert({ name: "iron-ore", count: 100 })
    const position = robot.entity.position
    const buffer = game.create_inventory(1)
    buffer.insert({ name: WORKER_MK1, count: 1 })
    tagMinedRobot(robot.entity, buffer)
    robot.entity.destroy()
    const spilled = nauvis().find_entities_filtered({ type: "item-entity", position, radius: 5 })
    let ore = 0
    for (const item of spilled) if (item.stack?.name === "iron-ore") ore += item.stack.count
    expect(ore).toBe(100)
    for (const item of spilled) item.destroy()
    buffer.destroy()
  })

  test("погибшая машина высыпает груз и топливо на землю", () => {
    const robot = place({ x: -60, y: 80 })
    robot.cargo.insert({ name: "copper-ore", count: 30 })
    robot.fuel.insert({ name: "coal", count: 2 })
    const position = robot.entity.position
    robot.entity.die()
    const spilled = nauvis().find_entities_filtered({ type: "item-entity", position, radius: 5 })
    let copper = 0
    let coal = 0
    for (const item of spilled) {
      if (item.stack?.name === "copper-ore") copper += item.stack.count
      if (item.stack?.name === "coal") coal += item.stack.count
    }
    expect(copper).toBe(30)
    expect(coal).toBe(2)
    for (const item of spilled) item.destroy()
  })

  test("запись прежней версии без груза получает его при обновлении мода", () => {
    const robot = place({ x: -60, y: 90 })
    robot.cargo.destroy()
    adoptUnregisteredRobots()
    expect(robot.cargo.valid).toBe(true)
    expect(robot.cargo.length).toBe(CARGO_SLOTS)
    robot.entity.destroy()
  })
})
