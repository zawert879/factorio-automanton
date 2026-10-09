// Заправка (0.6.0): машина заправляет соседнюю (refuel с целью), игрок — через слот топлива в окне машины;
// груз — руками в окне машины. Окно без игрока не открыть: проверяются функции, которые оно вызывает.
import { MapPosition } from "factorio:runtime"
import { currentAction, lastActionResult, startAction } from "../automaton/actions"
import { findRobot, RobotRecord } from "../automaton/registry"
import { cargoFromHand, fuelFromHand } from "../gui/machine"
import { MODELS } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { deleteProgram, findProgram, publish } from "../program/store"
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

function place(position: MapPosition, model = 0): RobotRecord {
  const spec = MODELS[model]
  nauvis().create_entity({ name: spec.placer, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: spec.entity, position, radius: 0.5 })[0])!
}

describe("заправка другой машины", () => {
  test("топливо из своего груза — в топливный слот соседа", (t) => {
    arena(-380, 0, 20)
    const from = place({ x: -375.5, y: 10.5 })
    const to = place({ x: -371.5, y: 10.5 })
    from.cargo.insert({ name: "coal", count: 30 })
    startAction(from, "refuel", { target: to.entity, item: "coal", count: 12 })
    waitUntil(t, "заправки", () => currentAction(from) === undefined, 120, () => {
      expect(lastActionResult(from)?.ok).toBe(true)
      expect(to.fuel.get_item_count("coal")).toBe(12)
      expect(from.cargo.get_item_count("coal")).toBe(18)
      expect(from.fuel.get_item_count("coal")).toBe(0)
      from.entity.destroy()
      to.entity.destroy()
    })
  })

  test("Mk2 (аккумулятор) и далёкая машина — ошибка", () => {
    arena(-380, 30, 40)
    const from = place({ x: -378.5, y: 40.5 })
    const battery = place({ x: -375.5, y: 40.5 }, 1)
    const far = place({ x: -350.5, y: 40.5 })
    from.cargo.insert({ name: "coal", count: 5 })
    startAction(from, "refuel", { target: battery.entity, item: "coal" })
    expect(lastActionResult(from)?.error).toBe("invalid-target")
    startAction(from, "refuel", { target: far.entity, item: "coal" })
    expect(lastActionResult(from)?.error).toBe("out-of-reach")
    for (const r of [from, battery, far]) r.entity.destroy()
  })

  test("программа-заправщик: видит топливо соседа и заправляет его", (t) => {
    arena(-380, 80, 20)
    const refueler = place({ x: -375.5, y: 90.5 })
    const empty = place({ x: -372.5, y: 90.5 })
    refueler.cargo.insert({ name: "coal", count: 20 })
    refueler.fuel.insert({ name: "coal", count: 5 })
    empty.energy = 0
    const old = findProgram("refuel/other")
    if (old !== undefined) deleteProgram(old.id)
    const published = publish({
      name: "refuel/other",
      source: `const r = scan.robots()[0]
print(r.fuel)
refuel("coal", r)
print(r.fuel > 0)
`,
    })
    if (!published.ok) error("программа не опубликована")
    assignProgram(refueler, published.program)
    const record = machineOf(refueler.id)
    waitUntil(t, "конца программы", () => record.machine.status !== "ready" && record.machine.status !== "waiting", 300, () => {
      expect(record.machine.status).toBe("done")
      expect(record.console.slice(1, 3)).toEqual(["0", "true"])
      expect(empty.fuel.get_item_count("coal")).toBe(20)
      refueler.entity.destroy()
      empty.entity.destroy()
      deleteProgram(findProgram("refuel/other")!.id)
    })
  })
})

describe("топливо и груз руками (окно машины)", () => {
  test("топливо из руки в слот и обратно; не топливо и другое топливо — сообщение", () => {
    arena(-380, 120, 10)
    const robot = place({ x: -375.5, y: 125.5 })
    const hands = game.create_inventory(1)
    const hand = hands[0]
    hand.set_stack({ name: "coal", count: 30 })
    expect(fuelFromHand(hand, robot)).toBe(undefined)
    expect(robot.fuel.get_item_count("coal")).toBe(30)
    expect(hand.valid_for_read).toBe(false)
    // Пустой рукой — забрать слот в руку.
    expect(fuelFromHand(hand, robot)).toBe(undefined)
    expect(hand.count).toBe(30)
    expect(robot.fuel.is_empty()).toBe(true)
    hand.set_stack({ name: "iron-plate", count: 5 })
    expect(fuelFromHand(hand, robot)).toEqual(["automaton-gui.not-fuel"])
    robot.fuel.insert({ name: "wood", count: 10 })
    hand.set_stack({ name: "coal", count: 5 })
    expect(fuelFromHand(hand, robot)).toEqual(["automaton-gui.fuel-other"])
    expect(hand.count).toBe(5)
    hands.destroy()
    robot.entity.destroy()
  })

  test("предмет из руки в груз; пустой рукой — весь предмет в инвентарь игрока", () => {
    arena(-380, 135, 10)
    const robot = place({ x: -375.5, y: 140.5 })
    const hands = game.create_inventory(1)
    const inventory = game.create_inventory(10)
    const hand = hands[0]
    hand.set_stack({ name: "iron-plate", count: 40 })
    expect(cargoFromHand(hand, robot, undefined, inventory)).toBe(undefined)
    expect(robot.cargo.get_item_count("iron-plate")).toBe(40)
    expect(hand.valid_for_read).toBe(false)
    expect(cargoFromHand(hand, robot, "iron-plate", inventory)).toBe(undefined)
    expect(inventory.get_item_count("iron-plate")).toBe(40)
    expect(robot.cargo.get_item_count("iron-plate")).toBe(0)
    hands.destroy()
    inventory.destroy()
    robot.entity.destroy()
  })
})
