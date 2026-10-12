// Постройка по призракам (21.3): scan.ghosts видит призраки зданий своей команды (не машин), ghost.build ставит
// здание из груза таким, как в чертеже (поворот, рецепт, провода); zone.find и scan.buildings призраков не видят.
import { LuaSurface } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { MARKER, MODELS, TECH, WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describeDiagnostics } from "../program/commands"
import { publishExamples } from "../program/examples"
import { assignProgram, MachineRecord, machineOf } from "../program/machines"
import { findProgram, publishProgram } from "../program/store"
import { markerOf, renameMarker } from "../world/markers"
import { createZone } from "../world/zones"
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

function ghost(surface: LuaSurface, name: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return surface.create_entity({ name: "entity-ghost", inner_name: name, position: { x, y }, force: "player", ...extra })!
}

/** Включить «Строительство» на время теста; вернуть, как было. */
function withConstruction(): () => void {
  const tech = game.forces.player.technologies[TECH.construction]
  const before = tech.researched
  tech.researched = true
  return () => (tech.researched = before)
}

describe("постройка по призракам", () => {
  test("scan.ghosts: класс Ghost, что встанет и чем строить; машины, scan.buildings и zone.find их не видят", (t) => {
    const [x0, y0] = [1250, -1250]
    const { surface, robot } = site(x0, y0)
    ghost(surface, "stone-furnace", x0 + 6, y0 + 3)
    ghost(surface, "boiler", x0 + 7, y0 + 8.5, { direction: defines.direction.east })
    ghost(surface, MODELS[0].placer, x0 + 3.5, y0 + 6.5)
    createZone("призраки-тест", surface, { left_top: { x: x0, y: y0 }, right_bottom: { x: x0 + 12, y: y0 + 12 } })
    const m = run(
      robot,
      "test-ghosts-scan",
      `const g = scan.ghosts()
print(g.length, g[0] instanceof Ghost, g[0].name, g[0].item, g[1].name, g[1].direction)
print(scan.ghosts({ name: "boiler" }).length, scan.buildings().length, zone("призраки-тест").find().length)`,
    )
    waitUntil(t, "конца программы", finished(m), 300, () => {
      expect(output(m)).toBe("2 true stone-furnace stone-furnace boiler east|1 0 0")
      robot.entity.destroy()
    })
  })

  test("ghost.build: здание из груза с поворотом, рецептом и проводами чертежа; без предмета — not-enough-items", (t) => {
    const restore = withConstruction()
    const [x0, y0] = [1290, -1250]
    const { surface, robot } = site(x0, y0)
    robot.cargo.insert({ name: "assembling-machine-1", count: 1 })
    robot.cargo.insert({ name: "small-electric-pole", count: 2 })
    robot.cargo.insert({ name: "boiler", count: 1 })
    const assembler = ghost(surface, "assembling-machine-1", x0 + 6.5, y0 + 2.5)
    assembler.set_recipe("iron-gear-wheel")
    ghost(surface, "boiler", x0 + 7, y0 + 7.5, { direction: defines.direction.east })
    const a = ghost(surface, "small-electric-pole", x0 + 2.5, y0 + 5.5)
    const b = ghost(surface, "small-electric-pole", x0 + 4.5, y0 + 5.5)
    a.get_wire_connector(defines.wire_connector_id.circuit_red, true)!.connect_to(b.get_wire_connector(defines.wire_connector_id.circuit_red, true)!)
    ghost(surface, "stone-furnace", x0 + 9, y0 + 6)
    const m = run(
      robot,
      "test-ghosts-build",
      `let built = 0
for (const g of scan.ghosts()) {
  if (me.cargo.count(g.item) === 0) {
    try { g.build() } catch (e) { print(g.name, e instanceof ActionError ? e.code : "?") }
    continue
  }
  const b = g.build()
  if (b instanceof Building && !g.valid) built++
}
print(built, me.cargo.count("assembling-machine-1"), me.cargo.count("small-electric-pole"), me.cargo.count("boiler"), scan.ghosts().length)`,
    )
    waitUntil(t, "конца программы", finished(m), 900, () => {
      restore()
      expect(output(m)).toBe("stone-furnace not-enough-items|4 0 0 0 1")
      const machine = surface.find_entities_filtered({ name: "assembling-machine-1", position: { x: x0 + 6.5, y: y0 + 2.5 }, radius: 0.5 })[0]
      expect(machine.get_recipe()[0]?.name).toBe("iron-gear-wheel")
      const boiler = surface.find_entities_filtered({ name: "boiler", area: [[x0 + 5, y0 + 6], [x0 + 9, y0 + 9]] })[0]
      expect(boiler.direction).toBe(defines.direction.east)
      const poles = surface.find_entities_filtered({ name: "small-electric-pole", area: [[x0 + 2, y0 + 5], [x0 + 5, y0 + 6]] })
      expect(poles.length).toBe(2)
      const red = poles[0].get_wire_connector(defines.wire_connector_id.circuit_red, true)!
      expect(red.connections.some((c) => c.target.owner === poles[1])).toBe(true)
      robot.entity.destroy()
    })
  })

  test("ghost.build без «Строительства» — ошибка исследования; далеко — out-of-reach", (t) => {
    const tech = game.forces.player.technologies[TECH.construction]
    const before = tech.researched
    tech.researched = false
    const [x0, y0] = [1330, -1250]
    const { surface, robot } = site(x0, y0)
    robot.cargo.insert({ name: "stone-furnace", count: 2 })
    ghost(surface, "stone-furnace", x0 + 4, y0 + 4)
    const m = run(robot, "test-ghosts-research", `try { scan.ghosts()[0].build() } catch (e) { print(e instanceof ActionError ? e.code : String(e)) }`)
    waitUntil(t, "конца первой программы", finished(m), 300, () => {
      tech.researched = true
      // Призрак увидела рядом, потом отъехала (у Mk1 зрение и досягаемость одинаковые — 10 клеток).
      const far = site(x0, y0 + 60)
      far.robot.cargo.insert({ name: "stone-furnace", count: 2 })
      ghost(far.surface, "stone-furnace", x0 + 4, y0 + 64)
      const m2 = run(
        far.robot,
        "test-ghosts-far",
        `const g = scan.ghosts()[0]
me.move({ x: ${x0 + 20.5}, y: ${y0 + 80.5} })
try { g.build() } catch (e) { print(e instanceof ActionError ? e.code : String(e)) }`,
      )
      waitUntil(t, "конца второй программы", finished(m2), 1800, () => {
        tech.researched = before
        expect(output(m)).toBe("not-researched")
        expect(output(m2)).toBe("out-of-reach")
        robot.entity.destroy()
        far.robot.entity.destroy()
      })
    })
  })

  test("пример «Строитель»: берёт предметы на складе и строит призраки у метки", (t) => {
    const [x0, y0] = [1370, -1250]
    const { surface, robot } = site(x0, y0)
    const flag = (name: string, x: number, y: number) => {
      const entity = surface.create_entity({ name: MARKER, position: { x, y }, force: "player", raise_built: true })!
      renameMarker(markerOf(entity)!, name)
    }
    flag("склад-строитель", x0 + 4, y0 + 25)
    const chest = surface.create_entity({ name: "wooden-chest", position: { x: x0 + 5.5, y: y0 + 25.5 }, force: "player" })!
    chest.insert({ name: "stone-furnace", count: 5 })
    chest.insert({ name: "small-electric-pole", count: 5 })
    flag("стройка-строитель", x0 + 15, y0 + 10)
    ghost(surface, "stone-furnace", x0 + 12, y0 + 8)
    ghost(surface, "stone-furnace", x0 + 14, y0 + 8)
    ghost(surface, "small-electric-pole", x0 + 17.5, y0 + 11.5)
    publishExamples("player", ["Строитель"])
    machineOf(robot.id).args = { site: "стройка-строитель", depot: "склад-строитель" }
    assignProgram(robot, findProgram("Строитель")!)
    const area: [[number, number], [number, number]] = [[x0 + 8, y0 + 4], [x0 + 22, y0 + 16]]
    waitUntil(t, "все призраки построены", () => surface.find_entities_filtered({ type: "entity-ghost", area }).length === 0, 3600, () => {
      expect(surface.find_entities_filtered({ name: "stone-furnace", area }).length).toBe(2)
      expect(surface.find_entities_filtered({ name: "small-electric-pole", area }).length).toBe(1)
      expect(chest.get_item_count("stone-furnace")).toBe(3)
      robot.entity.destroy()
    })
  })

  test("scan.marked: помеченные к сносу здание, дерево и скала; deconstruct и me.mine их убирают, непомеченное — нет", (t) => {
    const [x0, y0] = [1490, -1250]
    const { surface, robot } = site(x0, y0)
    surface.create_entity({ name: "wooden-chest", position: { x: x0 + 5.5, y: y0 + 2.5 }, force: "player" })!.order_deconstruction("player")
    surface.create_entity({ name: "wooden-chest", position: { x: x0 + 5.5, y: y0 + 5.5 }, force: "player" })
    surface.create_entity({ name: "tree-01", position: { x: x0 + 3.5, y: y0 + 6.5 } })!.order_deconstruction("player")
    surface.create_entity({ name: "tree-01", position: { x: x0 + 9.5, y: y0 + 2.5 } })
    surface.create_entity({ name: "big-rock", position: { x: x0 + 8, y: y0 + 8 } })!.order_deconstruction("player")
    const m = run(
      robot,
      "test-marked",
      `const list = scan.marked()
print(list.length, list.filter((x) => x instanceof Tree).length, list.filter((x) => x instanceof Rock).length)
for (const target of list) {
  me.move(target, { radius: 2 })
  if (target instanceof Tree || target instanceof Rock) me.mine(target)
  else target.deconstruct()
}
print(scan.marked().length, scan.buildings().length, scan.trees().length, scan.rocks().length)`,
    )
    waitUntil(t, "конца программы", finished(m), 2400, () => {
      expect(output(m)).toBe("3 1 1|0 1 1 0")
      robot.entity.destroy()
    })
  })
})
