// Внутриигровые тесты «положить» и «взять»: правильные слоты у разных зданий, досягаемость, неполный результат.
import { LuaEntity, MapPosition } from "factorio:runtime"
import { currentAction, lastActionResult, startAction } from "../automaton/actions"
import { findRobot, RobotRecord } from "../automaton/registry"
import { TRANSFER_TICKS } from "../automaton/transfer"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, TestContext, waitUntil } from "./testing"

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

function building(name: string, position: MapPosition, recipe?: string): LuaEntity {
  const entity = nauvis().create_entity({ name, position, force: "player" })!
  if (recipe !== undefined) entity.set_recipe(recipe)
  return entity
}

/** Положить предмет в здание и проверить, в какой слот он попал. */
function putInto(
  t: TestContext,
  name: string,
  item: string,
  count: number,
  slot: defines.inventory,
  recipe?: string,
): void {
  arena(-260, 0, 20)
  const robot = place({ x: -255.5, y: 10.5 })
  const target = building(name, { x: -250.5, y: 10.5 }, recipe)
  robot.cargo.insert({ name: item, count })
  startAction(robot, "put", { target, item, count })
  waitUntil(t, "перекладки", () => currentAction(robot) === undefined, 120, () => {
    expect(lastActionResult(robot)?.ok).toBe(true)
    expect(lastActionResult(robot)?.count).toBe(count)
    expect(target.get_inventory(slot)!.get_item_count(item)).toBe(count)
    expect(robot.cargo.get_item_count(item)).toBe(0)
    robot.entity.destroy()
    target.destroy()
  })
}

describe("положить", () => {
  test("руда в печь — во вход", (t) => putInto(t, "stone-furnace", "iron-ore", 10, defines.inventory.furnace_source))
  test("уголь в печь — в топливо", (t) => putInto(t, "stone-furnace", "coal", 5, defines.inventory.fuel))
  test("пластины в сборщик шестерёнок — во вход", (t) =>
    putInto(t, "assembling-machine-1", "iron-plate", 10, defines.inventory.assembling_machine_input, "iron-gear-wheel"))
  test("наука в лабораторию — во вход лаборатории", (t) =>
    putInto(t, "lab", "automation-science-pack", 5, defines.inventory.lab_input))
  test("патроны в турель — в патроны", (t) => putInto(t, "gun-turret", "firearm-magazine", 10, defines.inventory.turret_ammo))
  test("уголь в котёл — в топливо", (t) => putInto(t, "boiler", "coal", 5, defines.inventory.fuel))
  test("что угодно в сундук", (t) => putInto(t, "iron-chest", "stone", 30, defines.inventory.chest))

  test("не влезает — кладёт сколько влезло, успех с причиной target-full", (t) => {
    arena(-260, 30, 20)
    const robot = place({ x: -255.5, y: 40.5 })
    const furnace = building("stone-furnace", { x: -250.5, y: 40.5 })
    // Вход печи вмещает чуть больше стопки (в 2.0 — 54 руды при стопке 50): точное число не проверяем.
    robot.cargo.insert({ name: "iron-ore", count: 200 })
    startAction(robot, "put", { target: furnace, item: "iron-ore" })
    waitUntil(t, "перекладки", () => currentAction(robot) === undefined, 120, () => {
      const result = lastActionResult(robot)!
      const inFurnace = furnace.get_inventory(defines.inventory.furnace_source)!.get_item_count("iron-ore")
      expect(result.ok).toBe(true)
      expect(result.reason).toBe("target-full")
      expect(result.count).toBe(inFurnace)
      expect(inFurnace > 0 && inFurnace < 200).toBe(true)
      expect(robot.cargo.get_item_count("iron-ore") + inFurnace).toBe(200)
      robot.entity.destroy()
      furnace.destroy()
    })
  })

  test("здание дальше 10 клеток — ошибка out-of-reach сразу", () => {
    arena(-260, 60, 30)
    const robot = place({ x: -258.5, y: 70.5 })
    const chest = building("iron-chest", { x: -240.5, y: 70.5 })
    robot.cargo.insert({ name: "stone", count: 10 })
    startAction(robot, "put", { target: chest, item: "stone" })
    expect(lastActionResult(robot)?.error).toBe("out-of-reach")
    expect(robot.cargo.get_item_count("stone")).toBe(10)
    robot.entity.destroy()
    chest.destroy()
  })
})

describe("взять", () => {
  test("пластины из печи — из выхода, перекладка занимает полсекунды", (t) => {
    arena(-260, 100, 20)
    const robot = place({ x: -255.5, y: 110.5 })
    const furnace = building("stone-furnace", { x: -250.5, y: 110.5 })
    furnace.get_inventory(defines.inventory.furnace_result)!.insert({ name: "iron-plate", count: 20 })
    const started = game.tick
    startAction(robot, "take", { target: furnace, item: "iron-plate", count: 15 })
    waitUntil(t, "перекладки", () => currentAction(robot) === undefined, 120, () => {
      expect(game.tick - started >= TRANSFER_TICKS).toBe(true)
      expect(lastActionResult(robot)?.count).toBe(15)
      expect(robot.cargo.get_item_count("iron-plate")).toBe(15)
      expect(furnace.get_inventory(defines.inventory.furnace_result)!.get_item_count("iron-plate")).toBe(5)
      robot.entity.destroy()
      furnace.destroy()
    })
  })

  test("из сундука без числа — всё, что есть", (t) => {
    arena(-260, 130, 20)
    const robot = place({ x: -255.5, y: 140.5 })
    const chest = building("wooden-chest", { x: -250.5, y: 140.5 })
    chest.insert({ name: "copper-plate", count: 70 })
    startAction(robot, "take", { target: chest, item: "copper-plate" })
    waitUntil(t, "перекладки", () => currentAction(robot) === undefined, 120, () => {
      expect(robot.cargo.get_item_count("copper-plate")).toBe(70)
      expect(chest.get_item_count("copper-plate")).toBe(0)
      robot.entity.destroy()
      chest.destroy()
    })
  })

  test("груз полон — ошибка cargo-full, ничего не пропадает", (t) => {
    arena(-260, 160, 20)
    const robot = place({ x: -255.5, y: 170.5 })
    const chest = building("wooden-chest", { x: -250.5, y: 170.5 })
    chest.insert({ name: "copper-plate", count: 30 })
    for (let i = 0; i < robot.cargo.length; i++) robot.cargo.insert({ name: "wood", count: 100 })
    startAction(robot, "take", { target: chest, item: "copper-plate" })
    waitUntil(t, "перекладки", () => currentAction(robot) === undefined, 120, () => {
      expect(lastActionResult(robot)?.error).toBe("cargo-full")
      expect(chest.get_item_count("copper-plate")).toBe(30)
      robot.entity.destroy()
      chest.destroy()
    })
  })
})
