// Классы объектов игры (19.2): поиск зданий по классу в зоне и вокруг машины, instanceof, методы класса.
import { LuaSurface } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
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
})
