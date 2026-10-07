// Внутриигровые тесты демо-кода: проверяют мод на настоящем API игры.
import { describe, expect, test } from "./testing"

describe("демо", () => {
  test("команда /automaton зарегистрирована", () => {
    expect(commands.commands["automaton"] !== undefined).toBe(true)
  })

  test("storage инициализирован в on_init", () => {
    expect(storage.commandUses).toBe(0)
  })

  test("на карте можно поставить и убрать здание", () => {
    const surface = game.get_surface("nauvis")!
    const furnace = surface.create_entity({ name: "stone-furnace", position: { x: 0, y: 0 }, force: "player" })
    expect(furnace?.valid).toBe(true)
    furnace!.destroy()
    expect(surface.find_entities_filtered({ name: "stone-furnace" }).length).toBe(0)
  })
})
