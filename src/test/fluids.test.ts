// Внутриигровые тесты жидкостей (этап 7): бак, pump / fill / drain, нефть, уран.
import { MapPosition } from "factorio:runtime"
import { currentAction, lastActionResult, startAction } from "../automaton/actions"
import { TANK_CAPACITY, tankOf } from "../automaton/tank"
import { replacePlacer } from "../automaton/placement"
import { findRobot, RobotRecord, tagFromStack, tagMinedRobot } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

/** Площадка из травы 20×20; water — полоса воды по восточному краю (x от left + 15). */
function arena(left: number, top: number, water = false): void {
  const surface = nauvis()
  surface.request_to_generate_chunks({ x: left + 10, y: top + 10 }, 2)
  surface.force_generate_chunk_requests()
  for (const entity of surface.find_entities_filtered({ area: [[left, top], [left + 20, top + 20]] })) entity.destroy()
  const tiles = []
  for (let x = left; x < left + 20; x++) {
    for (let y = top; y < top + 20; y++) tiles.push({ name: water && x >= left + 15 ? "water" : "grass-1", position: { x, y } })
  }
  surface.set_tiles(tiles, true, true, true)
}

function place(position: MapPosition): RobotRecord {
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

const idle = (robot: RobotRecord) => () => currentAction(robot) === undefined

describe("жидкости", () => {
  test("pump у берега набирает воду в бак; далеко от воды — no-resource", (t) => {
    arena(-300, 0, true)
    const robot = place({ x: -286.5, y: 10.5 })
    startAction(robot, "pump", { item: "water", count: 300 })
    expect(robot.activity).toBe("mine")
    waitUntil(t, "конца набора", idle(robot), 300, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(tankOf(robot).fluid).toBe("water")
      expect(math.floor(tankOf(robot).amount + 0.5)).toBe(300)
      expect(tankOf(robot).temperature).toBe(15)
      // Отъехать от воды нельзя мгновенно — переставим машину подальше.
      robot.entity.teleport({ x: -296.5, y: 10.5 })
      startAction(robot, "pump", { item: "water" })
      expect(lastActionResult(robot)?.error).toBe("no-resource")
      robot.entity.destroy()
    })
  })

  test("бак занят другой жидкостью — cargo-full; без количества — до полного бака", (t) => {
    arena(-300, 30, true)
    const robot = place({ x: -286.5, y: 40.5 })
    tankOf(robot).fluid = "crude-oil"
    tankOf(robot).amount = 10
    startAction(robot, "pump", { item: "water" })
    expect(lastActionResult(robot)?.error).toBe("cargo-full")
    tankOf(robot).fluid = undefined
    tankOf(robot).amount = 0
    startAction(robot, "pump", { item: "water" })
    waitUntil(t, "полного бака", idle(robot), 600, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(math.floor(tankOf(robot).amount + 0.5)).toBe(TANK_CAPACITY)
      robot.entity.destroy()
    })
  })

  test("fill заливает в резервуар, drain сливает обратно", (t) => {
    arena(-300, 60)
    const robot = place({ x: -295.5, y: 70.5 })
    const storageTank = nauvis().create_entity({ name: "storage-tank", position: { x: -290.5, y: 70.5 }, force: "player" })!
    tankOf(robot).fluid = "water"
    tankOf(robot).amount = 400
    startAction(robot, "fill", { target: storageTank })
    waitUntil(t, "конца заливки", idle(robot), 300, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(math.floor(storageTank.get_fluid_count("water") + 0.5)).toBe(400)
      expect(tankOf(robot).amount).toBe(0)
      expect(tankOf(robot).fluid).toBe(undefined)
      startAction(robot, "drain", { target: storageTank, item: "water", count: 150 })
      waitUntil(t, "конца слива", idle(robot), 300, () => {
        expect(lastActionResult(robot)?.ok).toBe(true)
        expect(math.floor(tankOf(robot).amount + 0.5)).toBe(150)
        expect(math.floor(storageTank.get_fluid_count("water") + 0.5)).toBe(250)
        // Слить то, чего в здании нет, — not-enough-items; залить в сундук — target-full.
        startAction(robot, "drain", { target: storageTank, item: "steam" })
        expect(lastActionResult(robot)?.error).toBe("cargo-full")
        const chest = nauvis().create_entity({ name: "wooden-chest", position: { x: -293.5, y: 73.5 }, force: "player" })!
        startAction(robot, "fill", { target: chest })
        expect(lastActionResult(robot)?.error).toBe("target-full")
        robot.entity.destroy()
        storageTank.destroy()
        chest.destroy()
      })
    })
  })

  test("горячий пар сохраняет температуру: drain из котла и fill в паровую машину", (t) => {
    arena(-300, 90)
    const robot = place({ x: -295.5, y: 100.5 })
    const engine = nauvis().create_entity({ name: "steam-engine", position: { x: -290.5, y: 100.5 }, force: "player" })!
    tankOf(robot).fluid = "steam"
    tankOf(robot).amount = 100
    tankOf(robot).temperature = 165
    startAction(robot, "fill", { target: engine, count: 50 })
    waitUntil(t, "конца заливки", idle(robot), 120, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(math.floor(engine.get_fluid_count("steam") + 0.5)).toBe(50)
      expect(engine.fluidbox[0]?.temperature).toBe(165)
      robot.entity.destroy()
      engine.destroy()
    })
  })

  test("нефть: цикл раз в секунду, продукт × выработка, запас падает до минимума", (t) => {
    arena(-300, 120)
    const field = nauvis().create_entity({ name: "crude-oil", position: { x: -290.5, y: 130.5 }, amount: 300000 })!
    const robot = place({ x: -292.5, y: 130.5 })
    // 100% выработки: 10 за цикл, запас −10 за цикл (второй цикл — уже 9.9997: выработка падает).
    startAction(robot, "pump", { item: "crude-oil", count: 19 })
    waitUntil(t, "двух циклов", idle(robot), 200, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(math.floor(tankOf(robot).amount + 0.5)).toBe(19)
      expect(field.amount).toBe(300000 - 20)
      // На минимуме (20%) — 2 за цикл, запас не падает ниже.
      field.amount = 60000
      startAction(robot, "pump", { item: "crude-oil", count: 2 })
      waitUntil(t, "цикла на минимуме", idle(robot), 120, () => {
        expect(math.floor(tankOf(robot).amount + 0.5)).toBe(21)
        expect(field.amount).toBe(60000)
        robot.entity.destroy()
        field.destroy()
      })
    })
  })

  test("уран: без кислоты в баке — not-enough-items, с кислотой — 1 кислоты на руду", (t) => {
    arena(-300, 150)
    const patch = nauvis().create_entity({ name: "uranium-ore", position: { x: -290.5, y: 160.5 }, amount: 100 })!
    const robot = place({ x: -292.5, y: 160.5 })
    startAction(robot, "mine", { item: "uranium-ore", count: 2 })
    expect(lastActionResult(robot)?.error).toBe("not-enough-items")
    tankOf(robot).fluid = "sulfuric-acid"
    tankOf(robot).amount = 5
    startAction(robot, "mine", { item: "uranium-ore", count: 2 })
    waitUntil(t, "конца добычи", idle(robot), 900, () => {
      expect(lastActionResult(robot)?.ok).toBe(true)
      expect(robot.cargo.get_item_count("uranium-ore")).toBe(2)
      expect(math.floor(tankOf(robot).amount + 0.5)).toBe(3)
      expect(patch.amount).toBe(98)
      robot.entity.destroy()
      patch.destroy()
    })
  })

  test("программа: pump, fill, drain, me.tank", (t) => {
    arena(-300, 180, true)
    const robot = place({ x: -286.5, y: 190.5 })
    const storageTank = nauvis().create_entity({ name: "storage-tank", position: { x: -290.5, y: 186.5 }, force: "player" })!
    const result = publishProgram(
      "test-fluids",
      `print(me.tank!.fluid, me.tank!.capacity)
pump("water", 200)
print(me.tank!.fluid, Math.round(me.tank!.amount))
const tank = scan.entities({ name: "storage-tank" })[0]
print(Math.round(fill(tank, 50)), Math.round(tank.fluid("water")))
try { drain(tank, "steam") } catch (e) { print(e instanceof ActionError ? e.code : "?") }`,
    )
    if (!result.ok) error(describeDiagnostics(result.diagnostics).join("; "))
    const m: MachineRecord = assignProgram(robot, result.program)
    waitUntil(t, "конца программы", () => m.machine.status === "done" || m.machine.status === "error", 600, () => {
      expect(m.console.filter((line) => !line.startsWith("—")).join("|")).toBe("undefined 1000|water 200|50 50|cargo-full")
      robot.entity.destroy()
      storageTank.destroy()
    })
  })

  test("бак уезжает с машиной в предмет и возвращается при установке", () => {
    arena(-300, 210)
    const robot = place({ x: -290.5, y: 220.5 })
    tankOf(robot).fluid = "crude-oil"
    tankOf(robot).amount = 123
    const buffer = game.create_inventory(5)
    buffer.insert({ name: WORKER_MK1, count: 1 })
    tagMinedRobot(robot.entity, buffer)
    robot.entity.destroy()
    const [stack] = buffer.find_item_stack(WORKER_MK1)
    const tag = tagFromStack(stack)!
    replacePlacer(nauvis().create_entity({ name: WORKER_MK1_PLACER, position: { x: -290.5, y: 220.5 }, force: "player" })!, tag)
    const again = findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position: { x: -290.5, y: 220.5 }, radius: 0.5 })[0])!
    expect(tankOf(again).fluid).toBe("crude-oil")
    expect(tankOf(again).amount).toBe(123)
    again.entity.destroy()
    buffer.destroy()
  })
})
