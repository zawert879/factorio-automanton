// Миграции storage (13.6): со старой версии схемы выполняются шаги до текущей, данные дополняются.
import { findRobot } from "../automaton/registry"
import { MODELS } from "../names"
import { migrate, SCHEMA_VERSION } from "../migrations"
import { describe, expect, test } from "./testing"

describe("миграции", () => {
  test("со схемы 1: у машины появляются модель и бак, версия — текущая", () => {
    const surface = game.get_surface("nauvis")!
    surface.request_to_generate_chunks({ x: -900, y: 650 }, 1)
    surface.force_generate_chunk_requests()
    surface.set_tiles([{ name: "grass-1", position: { x: -900, y: 650 } }])
    surface.create_entity({ name: MODELS[0].placer, position: { x: -899.5, y: 650.5 }, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position: { x: -899.5, y: 650.5 }, radius: 0.5 })[0])!
    // Как в сохранении старой версии: полей ещё нет.
    const old = robot as unknown as Record<string, unknown>
    old.model = undefined
    old.tank = undefined
    storage.schemaVersion = 1
    expect(migrate().join(",")).toBe("2")
    expect(robot.model).toBe(MODELS[0].entity)
    expect(robot.tank.amount).toBe(0)
    expect(storage.schemaVersion).toBe(SCHEMA_VERSION)
    // Повторно — ничего не делает.
    expect(migrate().length).toBe(0)
    robot.entity.destroy()
  })
})
