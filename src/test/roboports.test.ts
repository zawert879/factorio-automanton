// Дронстанций нет (21.1): стоящие в сохранении сносятся при обновлении мода — дроны (и летающие в её сети)
// и содержимое в сундук на её месте; построенная из оставшегося предмета разбирается обратно.
import { onRoboportBuilt, removeRoboports } from "../world/roboports"
import { describe, expect, test, waitUntil } from "./testing"

const [X, Y] = [1200, -1200]

function clear(left: number, top: number, size: number): void {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: left + size / 2, y: top + size / 2 }, 2)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[left, top], [left + size, top + size]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = left; x < left + size; x++) for (let y = top; y < top + size; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
}

describe("дронстанций нет", () => {
  test("дронстанция из сохранения сносится: её дроны, летающие в её сети и ремкомплекты — в сундук на её месте", (t) => {
    clear(X - 20, Y - 20, 40)
    const surface = game.get_surface("nauvis")!
    const port = surface.create_entity({ name: "roboport", position: { x: X, y: Y }, force: "player" })!
    surface.create_entity({ name: "electric-energy-interface", position: { x: X + 4, y: Y }, force: "player" })
    surface.create_entity({ name: "medium-electric-pole", position: { x: X + 2, y: Y - 2 }, force: "player" })
    port.get_inventory(defines.inventory.roboport_robot)!.insert({ name: "construction-robot", count: 10 })
    port.get_inventory(defines.inventory.roboport_material)!.insert({ name: "repair-pack", count: 5 })
    const flying = surface.create_entity({ name: "construction-robot", position: { x: X + 3, y: Y + 3 }, force: "player" })!
    const position = port.position
    waitUntil(t, "летающий дрон в сети дронстанции", () => (port.logistic_network?.robots.length ?? 0) > 0, 300, () => {
      expect(removeRoboports()).toBe(1)
      expect(port.valid).toBe(false)
      expect(flying.valid).toBe(false)
      const chest = surface.find_entities_filtered({ name: "steel-chest", position, radius: 1 })[0]
      expect(chest !== undefined).toBe(true)
      const inventory = chest.get_inventory(defines.inventory.chest)!
      expect(inventory.get_item_count("construction-robot")).toBe(11)
      expect(inventory.get_item_count("repair-pack")).toBe(5)
      // Повторный запуск (следующее обновление мода) ничего не трогает.
      expect(removeRoboports()).toBe(0)
      chest.destroy()
    })
  })

  test("дронстанция, построенная дроном из оставшегося предмета, помечается к разборке", () => {
    clear(X - 20, Y + 30, 20)
    const surface = game.get_surface("nauvis")!
    const port = surface.create_entity({ name: "roboport", position: { x: X - 10, y: Y + 40 }, force: "player" })!
    onRoboportBuilt(port, undefined)
    expect(port.to_be_deconstructed()).toBe(true)
    port.destroy()
  })
})
