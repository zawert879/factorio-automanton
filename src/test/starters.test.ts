// Стартовые программы в деле: «Перевозчик» везёт уголь со склада в печи зоны (keep) и плиты — в сундук.
import { findRobot } from "../automaton/registry"
import { lib } from "../lang/runtime/library"
import { MARKER, MODELS } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { findProgram } from "../program/store"
import { markerOf, renameMarker } from "../world/markers"
import { createZone } from "../world/zones"
import { describe, expect, test, waitUntil } from "./testing"

describe("стартовые программы", () => {
  test("Перевозчик: уголь со склада в печь до keep, руду в печь, плиты в сундук", (t) => {
    const surface = game.get_surface("nauvis")!
    const [left, top] = [-950, 700]
    surface.request_to_generate_chunks({ x: left + 15, y: top + 15 }, 1)
    surface.force_generate_chunk_requests()
    const area = { left_top: { x: left, y: top }, right_bottom: { x: left + 30, y: top + 30 } }
    for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
    const tiles = []
    for (let x = left; x < left + 30; x++) for (let y = top; y < top + 30; y++) tiles.push({ name: "grass-1", position: { x, y } })
    surface.set_tiles(tiles, true, true, true)
    const place = (name: string, x: number, y: number) => surface.create_entity({ name, position: { x: left + x, y: top + y }, force: "player", raise_built: true })!
    const coal = place("wooden-chest", 3.5, 3.5)
    coal.insert({ name: "coal", count: 100 })
    renameMarker(markerOf(place(MARKER, 5.5, 3.5))!, "т-уголь")
    const ore = place("wooden-chest", 3.5, 8.5)
    ore.insert({ name: "iron-ore", count: 50 })
    renameMarker(markerOf(place(MARKER, 5.5, 8.5))!, "т-руда")
    const plates = place("wooden-chest", 3.5, 13.5)
    renameMarker(markerOf(place(MARKER, 5.5, 13.5))!, "т-плиты")
    const furnace = place("stone-furnace", 20, 8)
    createZone("т-печи", surface, { left_top: { x: left + 18, y: top + 6 }, right_bottom: { x: left + 22, y: top + 10 } })
    surface.create_entity({ name: MODELS[0].placer, position: { x: left + 10.5, y: top + 10.5 }, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position: { x: left + 10.5, y: top + 10.5 }, radius: 0.5 })[0])!
    robot.fuel.insert({ name: "coal", count: 20 })
    const [, args] = pcall(
      lib.JSON.parse,
      `{"coal": "т-уголь", "routes": [
        {"item": "coal", "from": {"marker": "т-уголь"}, "to": {"zone": "т-печи"}, "keep": 5, "batch": 10},
        {"item": "iron-ore", "from": {"marker": "т-руда"}, "to": {"zone": "т-печи"}, "keep": 10, "batch": 20},
        {"item": "iron-plate", "from": {"zone": "т-печи"}, "to": {"marker": "т-плиты"}}
      ]}`,
    )
    machineOf(robot.id).args = args
    const m = assignProgram(robot, findProgram("Перевозчик", "player")!)
    waitUntil(t, "плит в сундуке", () => plates.get_item_count("iron-plate") >= 3, 3600, () => {
      expect(m.machine.status).toBe("waiting")
      // В печи — топливо, сколько попросили (keep 5; часть уже сгорела).
      expect(furnace.get_inventory(defines.inventory.fuel)!.get_item_count("coal") <= 5).toBe(true)
      robot.entity.destroy()
      for (const e of [coal, ore, plates, furnace]) e.destroy()
    })
  })
})
