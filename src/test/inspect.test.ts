// Внутриигровые тесты чтения состояния зданий.
import { MapPosition } from "factorio:runtime"
import { entityFluid, entityItemCount, entityProgress, entityRecipe, entityStatus } from "../automaton/inspect"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

function build(name: string, position: MapPosition) {
  return nauvis().create_entity({ name, position, force: "player" })!
}

describe("состояние зданий", () => {
  test("печь: без топлива — no-fuel; с топливом и рудой — работает, прогресс растёт, рецепт iron-plate", (t) => {
    const furnace = build("stone-furnace", { x: -350.5, y: 10.5 })
    furnace.insert({ name: "iron-ore", count: 10 })
    t.after(5, () => {
      expect(entityStatus(furnace)).toBe("no-fuel")
      furnace.insert({ name: "coal", count: 5 })
      waitUntil(t, "начала плавки", () => entityProgress(furnace) > 0, 300, () => {
        expect(entityStatus(furnace)).toBe("working")
        expect(entityRecipe(furnace)).toBe("iron-plate")
        expect(entityItemCount(furnace, "coal") > 0).toBe(true)
        furnace.destroy()
      })
    })
  })

  test("сборщик без электричества — no-power (у движка этот статус главнее «нет рецепта»); рецепт читается", (t) => {
    const assembler = build("assembling-machine-1", { x: -350.5, y: 30.5 })
    t.after(5, () => {
      expect(entityStatus(assembler)).toBe("no-power")
      expect(entityRecipe(assembler)).toBe(undefined)
      assembler.set_recipe("iron-gear-wheel")
      assembler.insert({ name: "iron-plate", count: 10 })
      t.after(5, () => {
        expect(entityRecipe(assembler)).toBe("iron-gear-wheel")
        expect(entityStatus(assembler)).toBe("no-power")
        assembler.destroy()
      })
    })
  })

  test("сундук без статуса — idle; жидкость в резервуаре", () => {
    const chest = build("wooden-chest", { x: -350.5, y: 50.5 })
    expect(entityStatus(chest)).toBe("idle")
    expect(entityProgress(chest)).toBe(0)
    const tank = build("storage-tank", { x: -350.5, y: 60.5 })
    tank.insert_fluid({ name: "water", amount: 1000 })
    expect(entityFluid(tank)).toBe(1000)
    expect(entityFluid(tank, "water")).toBe(1000)
    expect(entityFluid(tank, "crude-oil")).toBe(0)
    chest.destroy()
    tank.destroy()
  })
})
