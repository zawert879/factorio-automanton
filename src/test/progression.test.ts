// Внутриигровые тесты прогрессии (этап 8): модели Mk2/Mk3, зарядка, улучшения исследованиями,
// возможности API по исследованиям, наладка и строительство, сенсоры.
import { LuaForce, MapPosition } from "factorio:runtime"
import { currentAction, lastActionResult, startAction } from "../automaton/actions"
import { spend } from "../automaton/energy"
import { refreshForce, robotQuantum, robotTankCapacity, robotVision } from "../automaton/models"
import { findRobot, RobotRecord } from "../automaton/registry"
import { tankCapacity } from "../automaton/tank"
import { bodyAnimationName, CHARGING_STATION, MODELS, TECH, WORKER_MK2 } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, TestContext, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

function player(): LuaForce {
  return game.forces.player
}

function arena(left: number, top: number): void {
  const surface = nauvis()
  surface.request_to_generate_chunks({ x: left + 10, y: top + 10 }, 2)
  surface.force_generate_chunk_requests()
  for (const entity of surface.find_entities_filtered({ area: [[left, top], [left + 20, top + 20]] })) entity.destroy()
  const tiles = []
  for (let x = left; x < left + 20; x++) for (let y = top; y < top + 20; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
}

function place(position: MapPosition, model = MODELS[0]): RobotRecord {
  nauvis().create_entity({ name: model.placer, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: model.entity, position, radius: 0.5 })[0])!
}

function run(t: TestContext, robot: RobotRecord, name: string, source: string, maxTicks: number, then: (output: string, m: MachineRecord) => void): void {
  const result = publishProgram(name, source)
  if (!result.ok) error(describeDiagnostics(result.diagnostics).join("; "))
  const m = assignProgram(robot, result.program)
  waitUntil(t, `конца программы ${name}`, () => m.machine.status === "done" || m.machine.status === "error", maxTicks, () =>
    then(m.console.filter((line) => !line.startsWith("—")).join("|"), m),
  )
}

/** Исследовать на время теста и вернуть как было. */
function withResearch(techs: string[], body: () => void): void {
  const before = techs.map((tech) => player().technologies[tech].researched)
  for (const tech of techs) player().technologies[tech].researched = true
  refreshForce(player())
  try {
    body()
  } finally {
    techs.forEach((tech, i) => (player().technologies[tech].researched = before[i]))
    refreshForce(player())
  }
}

describe("прогрессия", () => {
  test("Mk2: своя сущность, груз 20, скорость, аккумулятор, анимация в своих цветах", () => {
    arena(-400, 0)
    const robot = place({ x: -390.5, y: 10.5 }, MODELS[1])
    expect(robot.model).toBe(WORKER_MK2)
    expect(robot.cargo.length).toBe(20)
    expect(math.floor(robot.entity.speed! * 1000 + 0.5)).toBe(140)
    expect(robot.energy).toBe(MODELS[1].battery!)
    expect(robot.body.animation).toBe(bodyAnimationName(WORKER_MK2, "idle", robot.direction))
    expect(tankCapacity(robot)).toBe(2000)
    expect(robotQuantum(robot)).toBe(100)
    robot.entity.destroy()
  })

  test("Mk2 не жжёт топливо и не заправляется; Mk1 не заряжается", () => {
    arena(-400, 30)
    const mk2 = place({ x: -390.5, y: 40.5 }, MODELS[1])
    mk2.fuel.insert({ name: "coal", count: 5 })
    mk2.energy = 100
    expect(spend(mk2, 1000)).toBe(false)
    expect(mk2.fuel.get_item_count("coal")).toBe(5)
    startAction(mk2, "refuel", {})
    expect(lastActionResult(mk2)?.error).toBe("invalid-target")
    const mk1 = place({ x: -385.5, y: 40.5 })
    startAction(mk1, "charge", {})
    expect(lastActionResult(mk1)?.error).toBe("invalid-target")
    mk1.entity.destroy()
    mk2.entity.destroy()
  })

  test("charge: доезжает до ближайшей станции и заряжается из её буфера", (t) => {
    arena(-400, 60)
    const station = nauvis().create_entity({ name: CHARGING_STATION, position: { x: -385, y: 70 }, force: "player" })!
    station.energy = 20_000_000
    const robot = place({ x: -394.5, y: 70.5 }, MODELS[1])
    // Запас на дорогу (с пустым аккумулятором машина не доедет — её надо принести к станции).
    robot.energy = 1_000_000
    startAction(robot, "charge", {})
    waitUntil(t, "конца зарядки", () => currentAction(robot) === undefined, 900, () => {
      expect(lastActionResult(robot)?.error ?? "ok").toBe("ok")
      expect(math.floor(robot.energy + 0.5)).toBe(MODELS[1].battery!)
      // Станция отдала, сколько не хватало (минус потраченное на дорогу).
      expect(station.energy < 12_000_000 && station.energy > 10_000_000).toBe(true)
      robot.entity.destroy()
      station.destroy()
    })
  })

  test("улучшения: груз, скорость, бак, квант растут с исследованием и откатываются", () => {
    arena(-400, 90)
    const robot = place({ x: -390.5, y: 100.5 })
    const techs = ["automaton-cargo-1", "automaton-speed-1", "automaton-tank-1", "automaton-processor-1"]
    withResearch(techs, () => {
      expect(robot.cargo.length).toBe(15)
      expect(math.floor(robot.entity.speed! * 1000 + 0.5)).toBe(115)
      expect(robotTankCapacity(robot)).toBe(1500)
      expect(robotQuantum(robot)).toBe(75)
      // Новая машина сразу с улучшениями.
      const fresh = place({ x: -385.5, y: 100.5 })
      expect(fresh.cargo.length).toBe(15)
      fresh.entity.destroy()
    })
    expect(math.floor(robot.entity.speed! * 1000 + 0.5)).toBe(100)
    expect(robotQuantum(robot)).toBe(50)
    // Груз не сжимается обратно: лишнее не выбрасываем.
    expect(robot.cargo.length).toBe(15)
    robot.entity.destroy()
  })

  test("сенсоры: радиус зрения 10 → 16 → 24 → 32", () => {
    arena(-400, 120)
    const robot = place({ x: -390.5, y: 130.5 })
    expect(robotVision(robot)).toBe(10)
    withResearch([TECH.sensors1], () => expect(robotVision(robot)).toBe(16))
    withResearch([TECH.sensors1, TECH.sensors2, TECH.sensors3], () => expect(robotVision(robot)).toBe(32))
    expect(robotVision(robot)).toBe(10)
    robot.entity.destroy()
  })

  test("без исследования — not-researched: pump, scan.enemies; me.tank === null", (t) => {
    arena(-400, 150)
    const robot = place({ x: -390.5, y: 160.5 })
    player().technologies[TECH.fluids].researched = false
    run(
      t,
      robot,
      "test-gate",
      `print(me.tank === null)
try { pump("water") } catch (e) { print(e instanceof ActionError ? e.code : "?") }
try { scan.enemies() } catch (e) { print(e instanceof ActionError ? e.code : "?") }`,
      120,
      (output) => {
        player().technologies[TECH.fluids].researched = true
        expect(output).toBe("true|not-researched|not-researched")
        robot.entity.destroy()
      },
    )
  })

  test("setRecipe: рецепт сборщика; чужой рецепт — invalid-target", (t) => {
    arena(-400, 180)
    const robot = place({ x: -394.5, y: 190.5 })
    const assembler = nauvis().create_entity({ name: "assembling-machine-1", position: { x: -390.5, y: 190.5 }, force: "player" })!
    run(
      t,
      robot,
      "test-recipe",
      `const m = scan.entities({ name: "assembling-machine-1" })[0]
setRecipe(m, "iron-gear-wheel")
print(m.recipe)
try { setRecipe(m, "crude-oil-barrel-nonexistent") } catch (e) { print(e instanceof ActionError ? e.code : "?") }`,
      300,
      (output) => {
        expect(output).toBe("iron-gear-wheel|invalid-target")
        const [recipe] = assembler.get_recipe()
        expect(recipe?.name).toBe("iron-gear-wheel")
        robot.entity.destroy()
        assembler.destroy()
      },
    )
  })

  test("build, rotate, deconstruct: здание из груза и обратно", (t) => {
    arena(-400, 210)
    const robot = place({ x: -394.5, y: 220.5 })
    robot.cargo.insert({ name: "wooden-chest", count: 1 })
    robot.cargo.insert({ name: "boiler", count: 1 })
    run(
      t,
      robot,
      "test-build",
      `const chest = build("wooden-chest", { x: -390.5, y: 220.5 })
print(chest.name, me.cargo.count("wooden-chest"))
const boiler = build("boiler", { x: -390, y: 224.5 }, "north")
rotate(boiler)
deconstruct(chest)
print(chest.valid, me.cargo.count("wooden-chest"))
try { build("wooden-chest", { x: -381.5, y: 220.5 }) } catch (e) { print(e instanceof ActionError ? e.code : "?") }`,
      600,
      (output) => {
        expect(output).toBe("wooden-chest 0|false 1|out-of-reach")
        const boiler = nauvis().find_entities_filtered({ name: "boiler", area: [[-400, 210], [-380, 230]] })[0]
        // Повёрнут (куда именно поворачивается котёл — решает игра).
        expect(boiler !== undefined && boiler.direction !== defines.direction.north).toBe(true)
        boiler?.destroy()
        robot.entity.destroy()
      },
    )
  })
})
