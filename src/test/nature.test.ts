// Деревья и скалы (21.2): scan.trees / scan.rocks, me.mine("wood") рубит ближайшее дерево, me.mine(tree) — именно
// это дерево или скалу целиком, к ним можно ехать; по предмету руда важнее скалы.
import { LuaSurface } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

/** Отступ площадки: машина в углу видит на 10 клеток — за краем не должно быть деревьев с генерации карты. */
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

describe("деревья и скалы", () => {
  test("scan.trees и scan.rocks: классы Tree и Rock, что дают; в scan.buildings их нет", (t) => {
    const [x0, y0] = [1250, -1300]
    const { surface, robot } = site(x0, y0)
    surface.create_entity({ name: "tree-01", position: { x: x0 + 6.5, y: y0 + 2.5 } })
    surface.create_entity({ name: "huge-rock", position: { x: x0 + 8, y: y0 + 8 } })
    surface.create_entity({ name: "wooden-chest", position: { x: x0 + 4.5, y: y0 + 4.5 }, force: "player" })
    const m = run(
      robot,
      "test-nature-scan",
      `const t = scan.trees()
const r = scan.rocks()
print(t.length, t[0] instanceof Tree, t[0].name, t[0].products.join(","), t[0].inSight)
print(r.length, r[0] instanceof Rock, r[0].name, r[0].products.join(","))
print(scan.buildings().length, scan.buildings()[0].name)`,
    )
    waitUntil(t, "конца программы", finished(m), 300, () => {
      expect(output(m)).toBe("1 true tree-01 wood true|1 true huge-rock stone,coal|1 wooden-chest")
      robot.entity.destroy()
    })
  })

  test("me.mine(\"wood\") рубит дерево рядом; к скале — me.move, me.mine(rock) разбивает её целиком", (t) => {
    const [x0, y0] = [1290, -1300]
    const { surface, robot } = site(x0, y0)
    surface.create_entity({ name: "tree-01", position: { x: x0 + 4.5, y: y0 + 2.5 } })
    const rock = surface.create_entity({ name: "huge-rock", position: { x: x0 + 9, y: y0 + 8 } })!
    const m = run(
      robot,
      "test-nature-mine",
      `const n = me.mine("wood")
print(n, me.cargo.count("wood"), scan.trees().length)
const rock = scan.rocks()[0]
me.move(rock, { radius: 2 })
const got = me.mine(rock)
print(got === me.cargo.count("stone") + me.cargo.count("coal"), got > 0, rock.valid, scan.rocks().length)`,
    )
    waitUntil(t, "конца программы", finished(m), 3000, () => {
      expect(output(m)).toBe("4 4 0|true true false 0")
      expect(m.machine.status).toBe("done")
      expect(rock.valid).toBe(false)
      robot.entity.destroy()
    })
  })

  test("по предмету руда важнее скалы; скала без руды — разбивается; далёкое дерево — out-of-reach", (t) => {
    const [x0, y0] = [1330, -1300]
    const { surface, robot } = site(x0, y0)
    // Скала ближе, уголь чуть дальше — но в досягаемости.
    const rock = surface.create_entity({ name: "huge-rock", position: { x: x0 + 4, y: y0 + 1 } })!
    surface.create_entity({ name: "coal", position: { x: x0 + 2.5, y: y0 + 4.5 }, amount: 50 })
    // Дерево в поле зрения (10 клеток), но не в досягаемости добычи (2.7).
    surface.create_entity({ name: "tree-01", position: { x: x0 + 9.5, y: y0 + 2.5 } })
    const m = run(
      robot,
      "test-nature-priority",
      `print(me.mine("coal", 3), me.cargo.count("stone"), scan.rocks().length)
print(me.mine("stone") > 0, scan.rocks().length)
try { me.mine(scan.trees()[0]) } catch (e) { print(e instanceof ActionError ? e.code : "?") }`,
    )
    waitUntil(t, "конца программы", finished(m), 3000, () => {
      expect(output(m)).toBe("3 0 1|true 0|out-of-reach")
      expect(rock.valid).toBe(false)
      robot.entity.destroy()
    })
  })
})
