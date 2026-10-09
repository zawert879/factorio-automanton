// Окно «Все машины» (18.6): что про машины команды показывается и какие фильтры их находят.
import { findRobot, RobotRecord } from "../automaton/registry"
import { fleetRows, passes } from "../gui/fleet"
import { MODELS } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { deleteProgram, findProgram, publish } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

function place(x: number, y: number): RobotRecord {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x, y }, 1)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[x - 2, y - 2], [x + 3, y + 3]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let tx = x - 2; tx < x + 3; tx++) for (let ty = y - 2; ty < y + 3; ty++) tiles.push({ name: "grass-1", position: { x: tx, y: ty } })
  surface.set_tiles(tiles, true, true, true)
  const position = { x: x + 0.5, y: y + 0.5 }
  surface.create_entity({ name: MODELS[0].placer, position, force: "player", raise_built: true })
  return findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position, radius: 0.5 })[0])!
}

describe("все машины", () => {
  test("ошибка, без топлива, стоит — и фильтры по ним", (t) => {
    for (const name of ["fl/ok", "fl/bad"]) {
      const p = findProgram(name)
      if (p !== undefined) deleteProgram(p.id)
    }
    const ok = publish({ name: "fl/ok", source: "while (true) wait(1)" })
    const bad = publish({ name: "fl/bad", source: 'throw new Error("сломалась")' })
    if (!ok.ok || !bad.ok) error("программы не опубликованы")
    const working = place(-660, 560)
    const broken = place(-656, 560)
    const idle = place(-652, 560)
    working.fuel.insert({ name: "coal", count: 20 })
    broken.fuel.insert({ name: "coal", count: 20 })
    assignProgram(working, ok.program)
    assignProgram(broken, bad.program)
    waitUntil(t, "ошибка программы fl/bad", () => machineOf(broken.id).machine.status === "error", 300, () => {
      const rows = fleetRows(game.forces.player)
      const row = (r: RobotRecord) => rows.find((x) => x.robot === r)!
      expect([row(working).program, row(broken).program, row(idle).program]).toEqual(["fl/ok", "fl/bad", undefined])
      expect([row(working).error, row(broken).error, row(idle).error]).toEqual([false, true, false])
      expect([row(working).noFuel, row(idle).noFuel]).toEqual([false, true])
      expect([row(working).idle, row(idle).idle]).toEqual([false, true])
      // Сортировка «состояние»: ошибка тяжелее всего.
      expect(row(broken).severity < row(idle).severity && row(idle).severity < row(working).severity).toBe(true)
      expect(passes(row(broken), "error") && !passes(row(working), "error") && passes(row(idle), "idle")).toBe(true)
      for (const r of [working, broken, idle]) r.entity.destroy({ raise_destroy: true })
      for (const name of ["fl/ok", "fl/bad"]) deleteProgram(findProgram(name)!.id)
    })
  })
})
