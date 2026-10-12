// Модули в зданиях (21.4): installModule / removeModule / modules; запрос чертежа (requests) у призрака и здания,
// поставленный машиной модуль встаёт в тот слот, который просит чертёж, и вычёркивается из запроса.
import { LuaSurface } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

const MARGIN = 12

/** Чистая площадка 30×30 из травы (и MARGIN вокруг) с заправленной машиной в углу (x0 + 2.5, y0 + 2.5). */
function site(x0: number, y0: number): { surface: LuaSurface; robot: RobotRecord } {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: x0 + 15, y: y0 + 15 }, 2)
  surface.force_generate_chunk_requests()
  const [left, top, right, bottom] = [x0 - MARGIN, y0 - MARGIN, x0 + 30, y0 + 30]
  for (const e of surface.find_entities_filtered({ area: [[left, top], [right, bottom]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = left; x < right; x++) for (let y = top; y < bottom; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  const position = { x: x0 + 2.5, y: y0 + 2.5 }
  surface.create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  const robot = findRobot(surface.find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
  robot.fuel.insert({ name: "coal", count: 20 })
  return { surface, robot }
}

function run(robot: RobotRecord, name: string, source: string): MachineRecord {
  const result = publishProgram(name, source)
  if (!result.ok) error(`не компилируется: ${describeDiagnostics(result.diagnostics).join("; ")}`)
  return assignProgram(robot, result.program)
}

const output = (record: MachineRecord) => record.console.filter((line) => !line.startsWith("—")).join("|")
const finished = (record: MachineRecord) => () => record.machine.status === "done" || record.machine.status === "error"

describe("модули в зданиях", () => {
  test("installModule ставит в свободные слоты, removeModule снимает; не модуль и здание без слотов — invalid-target", (t) => {
    const [x0, y0] = [1410, -1250]
    const { surface, robot } = site(x0, y0)
    surface.create_entity({ name: "assembling-machine-2", position: { x: x0 + 6.5, y: y0 + 2.5 }, force: "player" })
    surface.create_entity({ name: "stone-furnace", position: { x: x0 + 3, y: y0 + 7 }, force: "player" })
    robot.cargo.insert({ name: "speed-module", count: 3 })
    robot.cargo.insert({ name: "iron-plate", count: 3 })
    const m = run(
      robot,
      "test-modules-slots",
      `const a = scan.buildings({ kind: Assembler })[0]
print(a.installModule("speed-module", 3), a.modules().map((s) => s.name + ":" + s.count).join(","), me.cargo.count("speed-module"))
print(a.removeModule(), me.cargo.count("speed-module"), a.modules().length)
for (const f of [() => a.installModule("iron-plate"), () => scan.buildings({ kind: Furnace })[0].installModule("speed-module")]) {
  try { f() } catch (e) { print(e instanceof ActionError ? e.code : String(e)) }
}`,
    )
    waitUntil(t, "конца программы", finished(m), 600, () => {
      expect(output(m)).toBe("2 speed-module:2 1|2 3 0|invalid-target|invalid-target")
      robot.entity.destroy()
    })
  })

  test("чертёж просит модуль: requests у призрака и здания, installModule — в тот слот, запрос снимается", (t) => {
    const [x0, y0] = [1450, -1250]
    const { surface, robot } = site(x0, y0)
    robot.cargo.insert({ name: "assembling-machine-2", count: 1 })
    robot.cargo.insert({ name: "speed-module", count: 2 })
    const ghost = surface.create_entity({ name: "entity-ghost", inner_name: "assembling-machine-2", position: { x: x0 + 6.5, y: y0 + 2.5 }, force: "player" })!
    ghost.insert_plan = [{ id: { name: "speed-module" }, items: { in_inventory: [{ inventory: defines.inventory.assembling_machine_modules, stack: 1, count: 1 }] } }]
    const m = run(
      robot,
      "test-modules-request",
      `const g = scan.ghosts()[0]
const show = (list: ItemStack[]) => list.map((s) => s.name + ":" + s.count).join(",")
print(show(g.requests()))
const a = g.build() as Assembler
print(show(a.requests()), a.installModule("speed-module", 1), show(a.requests()), me.cargo.count("speed-module"))`,
    )
    waitUntil(t, "конца программы", finished(m), 600, () => {
      expect(output(m)).toBe("speed-module:1|speed-module:1 1  1")
      const assembler = surface.find_entities_filtered({ name: "assembling-machine-2", position: { x: x0 + 6.5, y: y0 + 2.5 }, radius: 0.5 })[0]
      const slots = assembler.get_module_inventory()!
      expect(slots[0].valid_for_read).toBe(false)
      expect(slots[1].valid_for_read && slots[1].name).toBe("speed-module")
      expect(assembler.item_request_proxy).toBe(undefined)
      robot.entity.destroy()
    })
  })
})
