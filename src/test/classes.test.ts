// Классы объектов игры (19.2): поиск зданий по классу в зоне и вокруг машины, instanceof, методы класса.
import { LuaSurface } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { tankOf } from "../automaton/tank"
import { COMBAT_MK1, TECH, WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describeDiagnostics } from "../program/commands"
import { entityHandle } from "../program/handles"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { createZone } from "../world/zones"
import { describe, expect, test, waitUntil } from "./testing"

/** Чистая площадка 20×20 из травы с машиной в углу. */
function site(x0: number, y0: number): { surface: LuaSurface; robot: RobotRecord } {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: x0 + 10, y: y0 + 10 }, 1)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[x0, y0], [x0 + 20, y0 + 20]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = x0; x < x0 + 20; x++) for (let y = y0; y < y0 + 20; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  const position = { x: x0 + 2.5, y: y0 + 2.5 }
  surface.create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return { surface, robot: findRobot(surface.find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])! }
}

function run(robot: RobotRecord, name: string, source: string): MachineRecord {
  const result = publishProgram(name, source)
  if (!result.ok) error(`не компилируется: ${describeDiagnostics(result.diagnostics).join("; ")}`)
  return assignProgram(robot, result.program)
}

const finished = (record: MachineRecord) => () => record.machine.status === "done" || record.machine.status === "error"

describe("классы объектов игры", () => {
  test("zone.find и scan.buildings по классу, instanceof, методы класса", (t) => {
    const { surface, robot } = site(-600, 900)
    const furnace = surface.create_entity({ name: "stone-furnace", position: { x: -594, y: 903 }, force: "player" })!
    furnace.insert({ name: "coal", count: 2 })
    const chest = surface.create_entity({ name: "iron-chest", position: { x: -591.5, y: 902.5 }, force: "player" })!
    chest.insert({ name: "iron-plate", count: 7 })
    const assembler = surface.create_entity({ name: "assembling-machine-1", position: { x: -594.5, y: 907.5 }, force: "player" })!
    const pole = surface.create_entity({ name: "small-electric-pole", position: { x: -590.5, y: 906.5 }, force: "player" })!
    createZone("классы", surface, { left_top: { x: -597, y: 900 }, right_bottom: { x: -589, y: 910 } })
    const m = run(
      robot,
      "test-classes",
      `const area = zone("классы")
print(area.find(Furnace).length, area.find(Chest).length, area.find(Assembler).length, area.find().length, area.find("small-electric-pole").length)
const f = area.find(Furnace)[0]
print(f instanceof Furnace, f instanceof Building, f instanceof Chest, f.fuel()?.count("coal"), f.output().count())
const c = scan.buildings({ kind: Chest })[0]
print(c.name, c.inventory().count("iron-plate"), c.count(), c instanceof Chest)
print(scan.buildings({ kind: Furnace }).length, scan.buildings({ kind: Chest, name: "wooden-chest" }).length, scan.buildings().length)
const pole = area.find("small-electric-pole")[0]
print(pole instanceof Building, pole instanceof Chest, area instanceof Zone, me instanceof Machine, me instanceof Robot)
try { area.find(Robot as any) } catch (e) { print(e.code) }`,
    )
    waitUntil(t, "конца программы", finished(m), 200, () => {
      expect(m.console.filter((line) => !line.startsWith("—")).join("|")).toBe(
        "1 1 1 4 1|true true false 2 0|iron-chest 7 7 true|1 0 4|true false true true false|invalid-target",
      )
      expect(entityHandle(assembler).__c).toBe("Assembler")
      for (const e of [furnace, chest, assembler, pole]) e.destroy()
      robot.entity.destroy()
    })
  })

  test("методы зданий и машин: insert, extract, setRecipe, fill, drain; другой машине — insert, refuel; исследования", (t) => {
    const { surface, robot } = site(-560, 900)
    const techs = game.forces.player.technologies
    const before = [techs[TECH.tuning].researched, techs[TECH.fluids].researched, techs[TECH.construction].researched]
    techs[TECH.tuning].researched = true
    techs[TECH.fluids].researched = true
    techs[TECH.construction].researched = false
    surface.create_entity({ name: WORKER_MK1_PLACER, position: { x: -558.5, y: 905.5 }, force: "player", raise_built: true })
    const helper = findRobot(surface.find_entities_filtered({ name: WORKER_MK1, position: { x: -558.5, y: 905.5 }, radius: 0.5 })[0])!
    const chest = surface.create_entity({ name: "iron-chest", position: { x: -554.5, y: 902.5 }, force: "player" })!
    chest.insert({ name: "iron-ore", count: 20 })
    const furnace = surface.create_entity({ name: "stone-furnace", position: { x: -552, y: 906 }, force: "player" })!
    const tank = surface.create_entity({ name: "storage-tank", position: { x: -554.5, y: 910.5 }, force: "player" })!
    const assembler = surface.create_entity({ name: "assembling-machine-1", position: { x: -550.5, y: 910.5 }, force: "player" })!
    createZone("методы", surface, { left_top: { x: -557, y: 900 }, right_bottom: { x: -548, y: 913 } })
    robot.cargo.insert({ name: "coal", count: 10 })
    tankOf(robot).fluid = "water"
    tankOf(robot).amount = 100
    const m = run(
      robot,
      "test-methods",
      `const area = zone("методы")
const chest = area.find(Chest)[0]
const furnace = area.find(Furnace)[0]
print(chest.extract("iron-ore", 10), me.cargo.count("iron-ore"))
print(furnace.insert("iron-ore", 4), furnace.insert("coal", 2), furnace.count("iron-ore"))
try { furnace.rotate() } catch (e) { print(e.code) }
const asm = area.find(Assembler)[0]
asm.setRecipe("iron-gear-wheel")
print(asm.recipe)
const helper = scan.robots()[0]
print(helper.insert("coal", 3))
helper.refuel("coal")
print(helper.energy.level > 0, me.cargo.count("coal"))
const tank = area.find(StorageTank)[0]
print(tank.fill(50), tank.drain("water", 20), Math.round(tank.fluid("water")))`,
    )
    waitUntil(t, "конца программы", finished(m), 900, () => {
      expect(m.console.filter((line) => !line.startsWith("—")).join("|")).toBe(
        "10 10|4 2 4|not-researched|iron-gear-wheel|3|true 0|50 20 30",
      )
      expect(helper.cargo.get_item_count("coal")).toBe(3)
      techs[TECH.tuning].researched = before[0]
      techs[TECH.fluids].researched = before[1]
      techs[TECH.construction].researched = before[2]
      for (const e of [chest, furnace, tank, assembler]) e.destroy()
      helper.entity.destroy()
      robot.entity.destroy()
    })
  })

  test("me: действия своей машины, энергия, бак; оружие — у боевой модели", (t) => {
    const { surface, robot } = site(-520, 900)
    const techs = game.forces.player.technologies
    const before = [techs[TECH.fluids].researched, techs[TECH.combat1].researched]
    techs[TECH.fluids].researched = true
    techs[TECH.combat1].researched = true
    robot.cargo.insert({ name: "coal", count: 5 })
    surface.create_entity({ name: `${COMBAT_MK1}-placer`, position: { x: -510.5, y: 910.5 }, force: "player", raise_built: true })
    const fighter = findRobot(surface.find_entities_filtered({ name: COMBAT_MK1, position: { x: -510.5, y: 910.5 }, radius: 0.5 })[0])!
    fighter.cargo.insert({ name: "firearm-magazine", count: 2 })
    const worker = run(
      robot,
      "test-me-worker",
      `const x0 = me.position.x
me.move({ x: x0 + 5, y: me.position.y })
print(Math.abs(me.position.x - (x0 + 5)) < 1.5)
me.energy.refuel("coal")
print(me.energy.level > 0, me.cargo.count("coal"))
print(me.tank !== null ? me.tank.capacity : -1, me.tank?.fluid ?? "пусто", me.weapon === null)
me.say("готово")`,
    )
    const combat = run(
      fighter,
      "test-me-fighter",
      `const weapon = me.weapon!
print(weapon.type, weapon.range, weapon.ammo === null, me.tank === null)
weapon.reload()
print(weapon.ammo!.name, weapon.ammo!.count)`,
    )
    waitUntil(t, "конца программ", () => finished(worker)() && finished(combat)(), 600, () => {
      expect(worker.console.filter((line) => !line.startsWith("—")).join("|")).toBe("true|true 0|1000 пусто true|say: готово")
      expect(combat.console.filter((line) => !line.startsWith("—")).join("|")).toBe("gun 15 true true|firearm-magazine 2")
      techs[TECH.fluids].researched = before[0]
      techs[TECH.combat1].researched = before[1]
      fighter.entity.destroy()
      robot.entity.destroy()
    })
  })

  test("radio: запрос и ответ, публикация подписчику, inbox", (t) => {
    const { surface, robot } = site(-480, 900)
    const techs = game.forces.player.technologies
    const before = techs[TECH.radio].researched
    techs[TECH.radio].researched = true
    surface.create_entity({ name: WORKER_MK1_PLACER, position: { x: -470.5, y: 910.5 }, force: "player", raise_built: true })
    const other = findRobot(surface.find_entities_filtered({ name: WORKER_MK1, position: { x: -470.5, y: 910.5 }, radius: 0.5 })[0])!
    const answering = run(
      other,
      "test-radio-b",
      `radio.subscribe(${robot.id}, "склад")
const m = radio.receive<number>("сколько", 10)!
m.reply(m.data * 2)
const news = radio.receive<string>("склад", 10)
print(news?.data, news?.from.id === ${robot.id})`,
    )
    const asking = run(
      robot,
      "test-radio-a",
      `wait(0.5)
const r = radio.request<number>(${other.id}, "сколько", 21, 10)
radio.publish("склад", "полон")
print(r, radio.inbox.count, radio.inbox.dropped)`,
    )
    waitUntil(t, "конца программ", () => finished(answering)() && finished(asking)(), 600, () => {
      expect(asking.console.filter((line) => !line.startsWith("—")).join("|")).toBe("42 0 0")
      expect(answering.console.filter((line) => !line.startsWith("—")).join("|")).toBe("полон true")
      techs[TECH.radio].researched = before
      other.entity.destroy()
      robot.entity.destroy()
    })
  })
})
