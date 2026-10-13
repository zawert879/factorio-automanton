// Броня (22.4): me.armor.equip / unequip из груза; броня и оружие вместе — один вариант; сетка снаряжения
// переезжает с бронёй (окно машины); сопротивления брони работают (кислота); у летающих брони нет; погибшая
// машина роняет броню.
import { LuaSurface } from "factorio:runtime"
import { setArmor, setWeapon } from "../automaton/gear"
import { findRobot, RobotRecord } from "../automaton/registry"
import { gearOf } from "../automaton/variants"
import { armorFromHand } from "../gui/machine"
import { MODELS, variantName } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

const WORKER = MODELS.find((m) => m.id === "worker-mk1")!
const COMBAT = MODELS.find((m) => m.id === "combat-mk1")!
const FLYER = MODELS.find((m) => m.id === "flyer-mk1")!

function site(x0: number, y0: number): LuaSurface {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: x0 + 15, y: y0 + 15 }, 2)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[x0 - 12, y0 - 12], [x0 + 30, y0 + 30]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = x0 - 12; x < x0 + 30; x++) for (let y = y0 - 12; y < y0 + 30; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  return surface
}

function place(surface: LuaSurface, model: (typeof MODELS)[number], x: number, y: number): RobotRecord {
  surface.create_entity({ name: model.placer, position: { x, y }, force: "player", raise_built: true })
  const robot = findRobot(surface.find_entities_filtered({ name: model.entity, position: { x, y }, radius: 0.5 })[0])!
  robot.fuel.insert({ name: "coal", count: 20 })
  return robot
}

function run(robot: RobotRecord, name: string, source: string): MachineRecord {
  const result = publishProgram(name, source)
  if (!result.ok) error(`не компилируется: ${describeDiagnostics(result.diagnostics).join("; ")}`)
  return assignProgram(robot, result.program)
}

const output = (record: MachineRecord) => record.console.filter((line) => !line.startsWith("—")).join("|")
const finished = (record: MachineRecord) => () => record.machine.status === "done" || record.machine.status === "error"

describe("броня", () => {
  test("рабочий: надеть, сменить и снять из груза; у летающего брони нет", (t) => {
    const [x0, y0] = [1810, -1250]
    const surface = site(x0, y0)
    const robot = place(surface, WORKER, x0 + 2.5, y0 + 2.5)
    robot.cargo.insert({ name: "heavy-armor", count: 1 })
    robot.cargo.insert({ name: "light-armor", count: 1 })
    const flyer = place(surface, FLYER, x0 + 8.5, y0 + 2.5)
    const m = run(
      robot,
      "test-armor-equip",
      `const a = me.armor!
print(a.item)
a.equip("heavy-armor")
print(a.item, me.cargo.count("heavy-armor"))
a.equip("light-armor")
print(a.item, me.cargo.count("heavy-armor"), me.cargo.count("light-armor"))
a.unequip()
print(a.item, me.cargo.count("light-armor"))`,
    )
    const f = run(flyer, "test-armor-flyer", `print(me.armor === null)`)
    waitUntil(t, "конца программ", () => finished(m)() && finished(f)(), 900, () => {
      expect(output(m)).toBe("undefined|heavy-armor 0|light-armor 1 0|undefined 1")
      expect(output(f)).toBe("true")
      expect(robot.entity.name).toBe(WORKER.entity)
      robot.entity.destroy()
      flyer.entity.destroy()
    })
  })

  test("броня и оружие вместе; кислоту броня режет; сетка снаряжения переезжает с бронёй; погибшая машина роняет броню", () => {
    const [x0, y0] = [1850, -1250]
    const surface = site(x0, y0)
    const combat = place(surface, COMBAT, x0 + 2.5, y0 + 2.5)
    const sink = game.create_inventory(5)
    const give = (stack: Parameters<Parameters<typeof setArmor>[2]>[0]) => sink.insert(stack)
    expect(setWeapon(combat, "shotgun", give)).toBe(true)
    const hand = game.create_inventory(1)[0]
    hand.set_stack({ name: "heavy-armor" })
    expect(setArmor(combat, hand, give)).toBe(true)
    expect(combat.entity.name).toBe(variantName(COMBAT.entity, "shotgun", "heavy-armor"))
    expect(setWeapon(combat, undefined, give)).toBe(true)
    expect(combat.entity.name).toBe(variantName(COMBAT.entity, undefined, "heavy-armor"))
    // Кислота: у модели защиты нет, тяжёлая броня — 40%.
    const before = combat.entity.health!
    combat.entity.damage(50, "enemy", "acid")
    expect(math.floor(before - combat.entity.health! + 0.5)).toBe(30)

    // Модульная броня со щитом в сетке — из руки в окне машины и обратно.
    const worker = place(surface, WORKER, x0 + 8.5, y0 + 2.5)
    const modular = game.create_inventory(1)[0]
    modular.set_stack({ name: "modular-armor" })
    modular.grid!.put({ name: "energy-shield-equipment" })
    const force = game.forces.player
    expect(armorFromHand(modular, worker, give, force)).toBe(undefined)
    expect(modular.valid_for_read).toBe(false)
    expect(gearOf(worker).armor).toBe("modular-armor")
    expect(worker.armor![0].grid!.get_contents().length).toBe(1)
    expect(armorFromHand(modular, worker, give, force)).toBe(undefined)
    expect(gearOf(worker).armor).toBe(undefined)
    const [back] = sink.find_item_stack("modular-armor")
    expect(back !== undefined && back.grid!.get_contents()[0]?.name).toBe("energy-shield-equipment")

    // Погибла — броня на землю.
    const position = combat.entity.position
    combat.entity.die()
    const dropped = surface.find_entities_filtered({ name: "item-on-ground", position, radius: 3 }).map((e) => e.stack.name)
    expect(dropped.includes("heavy-armor")).toBe(true)
    worker.entity.destroy()
  })
})
