// Кэши запросов (13.3): find по зоне сбрасывается постройкой и сносом в зоне, здание, удалённое без
// события, тоже не остаётся в ответе.
import { findRobot } from "../automaton/registry"
import { MODELS } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram } from "../program/machines"
import { publishProgram } from "../program/store"
import { createZone } from "../world/zones"
import { describe, expect, test, waitUntil } from "./testing"

describe("кэши", () => {
  test("find по зоне: постройка и снос видны сразу", (t) => {
    const surface = game.get_surface("nauvis")!
    const [left, top] = [-850, 600]
    surface.request_to_generate_chunks({ x: left + 10, y: top + 10 }, 1)
    surface.force_generate_chunk_requests()
    const area = { left_top: { x: left, y: top }, right_bottom: { x: left + 20, y: top + 20 } }
    for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
    const tiles = []
    for (let x = left; x < left + 20; x++) for (let y = top; y < top + 20; y++) tiles.push({ name: "grass-1", position: { x, y } })
    surface.set_tiles(tiles, true, true, true)
    createZone("кэш", surface, { left_top: { x: left + 5, y: top + 5 }, right_bottom: { x: left + 15, y: top + 15 } })
    const first = surface.create_entity({ name: "wooden-chest", position: { x: left + 7.5, y: top + 7.5 }, force: "player", raise_built: true })!
    surface.create_entity({ name: MODELS[0].placer, position: { x: left + 2.5, y: top + 2.5 }, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position: { x: left + 2.5, y: top + 2.5 }, radius: 0.5 })[0])!
    const result = publishProgram("test-cache", `for (let i = 0; i < 9; i++) { print(find("wooden-chest", zone("кэш")).length); wait(0.1) }`)
    if (!result.ok) error(describeDiagnostics(result.diagnostics).join("; "))
    const m = assignProgram(robot, result.program)
    let second: ReturnType<typeof surface.create_entity>
    t.after(20, () => {
      second = surface.create_entity({ name: "wooden-chest", position: { x: left + 9.5, y: top + 9.5 }, force: "player", raise_built: true })
    })
    // Удаление без события: кэш это заметит по недействительному зданию.
    t.after(40, () => first.destroy())
    waitUntil(t, "конца программы", () => m.machine.status === "done" || m.machine.status === "error", 200, () => {
      const counts = m.console.filter((line) => !line.startsWith("—"))
      const text = counts.join("")
      // Сначала 1, потом 2, потом снова 1 — без устаревших ответов кэша.
      const [matched] = string.match(text, "^1+2+1+$")
      expect(matched !== undefined ? "1→2→1" : text).toBe("1→2→1")
      second?.destroy()
      robot.entity.destroy()
    })
  })
})
