// Словарь имён (24.1): категории справки F1 из прототипов — здания по классам программ (без убранного модом,
// без дронов и машин), предметы по группам, жидкости; что не открыто исследованием — недоступно.
import { available, nameCategories } from "../gui/dictionary"
import { describe, expect, test } from "./testing"

describe("словарь имён", () => {
  test("здания по классам, предметы, жидкости; убранного модом и служебного нет", () => {
    const categories = nameCategories()
    const names = (key: string) => (categories.find((c) => c.key === key)?.rows ?? []).map((r) => r.name)
    expect(names("class:Furnace").join(",")).toBe("stone-furnace,steel-furnace,electric-furnace")
    expect(names("class:Chest").includes("wooden-chest")).toBe(true)
    expect(names("class:Beacon").join(",")).toBe("beacon")
    expect(categories[categories.length - 1].key).toBe("fluids")
    expect(names("fluids").includes("water")).toBe(true)
    const all = new LuaSet<string>()
    for (const category of categories) for (const row of category.rows) all.add(`${category.key.startsWith("class:") ? "b" : "i"}:${row.name}`)
    expect(all.has("i:iron-plate")).toBe(true)
    // Убрано модом (конвейеры, дронстанция), машины, метки, дроны среди зданий, параметры чертежей — нет.
    for (const name of ["b:transport-belt", "i:transport-belt", "b:roboport", "b:automaton-worker-mk1", "b:automaton-marker", "b:construction-robot", "i:parameter-0", "i:blueprint"]) {
      expect(`${name}: ${all.has(name)}`).toBe(`${name}: false`)
    }
    expect(available(game.forces.player, "stone-furnace")).toBe(true)
    expect(available(game.forces.player, "iron-ore")).toBe(true)
  })
})
