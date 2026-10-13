// Варианты машин (22.1): прототипы модели с оружием игрока и бронёй (дальность — как у оружия, сопротивления —
// модели и брони вместе); подмена сущности посреди поездки по программе сохраняет запись, груз, здоровье,
// программу и внешний вид, машина доезжает.
import { LuaSurface } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { gearOf, swapGear } from "../automaton/variants"
import { MODELS, ROBOT_ENTITIES, variantName } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

const COMBAT = MODELS.find((m) => m.id === "combat-mk1")!
const WORKER = MODELS.find((m) => m.id === "worker-mk1")!
const FLYER = MODELS.find((m) => m.id === "flyer-mk1")!

function site(x0: number, y0: number): LuaSurface {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: x0 + 15, y: y0 + 15 }, 2)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[x0 - 12, y0 - 12], [x0 + 40, y0 + 30]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = x0 - 12; x < x0 + 40; x++) for (let y = y0 - 12; y < y0 + 30; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  return surface
}

function place(surface: LuaSurface, placer: string, entity: string, x: number, y: number): RobotRecord {
  surface.create_entity({ name: placer, position: { x, y }, force: "player", raise_built: true })
  return findRobot(surface.find_entities_filtered({ name: entity, position: { x, y }, radius: 0.5 })[0])!
}

function run(robot: RobotRecord, name: string, source: string): MachineRecord {
  const result = publishProgram(name, source)
  if (!result.ok) error(`не компилируется: ${describeDiagnostics(result.diagnostics).join("; ")}`)
  return assignProgram(robot, result.program)
}

describe("варианты машин", () => {
  test("прототипы: оружие — дальность оружия игрока, броня — сопротивления вместе с моделью; лишних вариантов нет", () => {
    const shotgun = prototypes.entity[variantName(COMBAT.entity, "shotgun")]!
    expect(shotgun.attack_parameters!.range).toBe(prototypes.item["shotgun"]!.attack_parameters!.range)
    const rockets = prototypes.entity[variantName(COMBAT.entity, "rocket-launcher", "heavy-armor")]!
    expect(rockets.attack_parameters!.range).toBe(36)
    // Модель: физический −2 и 20%; тяжёлая броня: −6 и 30% → −8 и 1 − 0.8 · 0.7 = 44%; кислота — только броня, 40%.
    const physical = rockets.resistances!["physical"]!
    expect(`${physical.decrease} ${math.floor(physical.percent * 100 + 0.5)}`).toBe("8 44")
    expect(math.floor(rockets.resistances!["acid"]!.percent * 100 + 0.5)).toBe(40)
    expect(prototypes.entity[variantName(WORKER.entity, undefined, "power-armor")] !== undefined).toBe(true)
    expect(prototypes.entity[variantName(WORKER.entity, "shotgun")] === undefined).toBe(true)
    expect(prototypes.entity[variantName(FLYER.entity, undefined, "light-armor")] === undefined).toBe(true)
    for (const name of ROBOT_ENTITIES) expect(`${name}: ${prototypes.entity[name] !== undefined}`).toBe(`${name}: true`)
  })

  test("подмена посреди поездки: запись, груз, здоровье, подпись, тело и значок оружия — те же, машина доезжает", (t) => {
    const [x0, y0] = [1610, -1250]
    const surface = site(x0, y0)
    const robot = place(surface, COMBAT.placer, COMBAT.entity, x0 + 2.5, y0 + 2.5)
    robot.cargo.insert({ name: "coal", count: 7 })
    robot.entity.health = 200
    const id = robot.id
    const old = robot.entity
    const m = run(robot, "test-variants-move", `me.move({ x: ${x0 + 25.5}, y: ${y0 + 2.5} }, { radius: 1 })\nprint("на месте")`)
    t.after(40, () => {
      expect(swapGear(robot, "shotgun", "heavy-armor")).toBe(true)
      expect(old.valid).toBe(false)
      expect(robot.entity.name).toBe(variantName(COMBAT.entity, "shotgun", "heavy-armor"))
      expect(findRobot(robot.entity)?.id).toBe(id)
      expect(robot.model).toBe(COMBAT.entity)
      expect(math.floor(robot.entity.health! + 0.5)).toBe(200)
      expect(robot.cargo.get_item_count("coal")).toBe(7)
      expect((robot.label.target as { entity?: unknown }).entity === robot.entity).toBe(true)
      expect((robot.body.target as { entity?: unknown }).entity === robot.entity).toBe(true)
      expect(robot.gun?.valid && robot.gun.sprite).toBe("item/shotgun")
      expect(gearOf(robot).armor).toBe("heavy-armor")
      waitUntil(t, "доезда после подмены", () => m.machine.status === "done" || m.machine.status === "error", 1800, () => {
        expect(m.console.filter((l) => !l.startsWith("—")).join("|")).toBe("на месте")
        expect(robot.entity.position.x > x0 + 23).toBe(true)
        // Снять снаряжение — снова модель.
        expect(swapGear(robot, undefined, undefined)).toBe(true)
        expect(robot.entity.name).toBe(COMBAT.entity)
        expect(robot.gun?.valid && robot.gun.sprite).toBe("item/submachine-gun")
        robot.entity.destroy()
      })
    })
  })
})
