// Миграции storage (13.6): со старой версии схемы выполняются шаги до текущей, данные дополняются.
import { findRobot } from "../automaton/registry"
import { MODELS } from "../names"
import { migrate, SCHEMA_VERSION } from "../migrations"
import { entityHandle } from "../program/handles"
import { assignProgram } from "../program/machines"
import { deleteProgram, publishProgram } from "../program/store"
import { describe, expect, test } from "./testing"

describe("миграции", () => {
  test("со схемы 1: у машины появляются модель и бак, версия — текущая", () => {
    const surface = game.get_surface("nauvis")!
    surface.request_to_generate_chunks({ x: -900, y: 650 }, 1)
    surface.force_generate_chunk_requests()
    // Своя чистая площадка: на разных картах здесь бывают деревья и вода (машина встала бы рядом).
    for (const e of surface.find_entities_filtered({ area: [[-903, 647], [-897, 653]] })) if (e.type !== "character") e.destroy()
    const tiles = []
    for (let x = -902; x < -897; x++) for (let y = 648; y < 653; y++) tiles.push({ name: "grass-1", position: { x, y } })
    surface.set_tiles(tiles, true, true, true)
    surface.create_entity({ name: MODELS[0].placer, position: { x: -899.5, y: 650.5 }, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position: { x: -899.5, y: 650.5 }, radius: 0.5 })[0])!
    // Как в сохранении старой версии: полей ещё нет.
    const old = robot as unknown as Record<string, unknown>
    old.model = undefined
    old.tank = undefined
    storage.schemaVersion = 1
    expect(migrate().join(",")).toBe("2,3,4")
    expect(robot.model).toBe(MODELS[0].entity)
    expect(robot.tank.amount).toBe(0)
    expect(storage.schemaVersion).toBe(SCHEMA_VERSION)
    // Повторно — ничего не делает.
    expect(migrate().length).toBe(0)
    robot.entity.destroy()
  })

  test("со схемы 2: у обёрток зданий появляется класс", () => {
    const surface = game.get_surface("nauvis")!
    const furnace = surface.create_entity({ name: "stone-furnace", position: { x: -905, y: 650 }, force: "player" })!
    const handle = entityHandle(furnace)
    handle.__c = undefined
    storage.schemaVersion = 2
    expect(migrate().join(",")).toBe("3,4")
    expect(handle.__c).toBe("Furnace")
    furnace.destroy()
  })

  test("со схемы 3: программы собираются заново — на прежнем API не собираются, их машины стоят", () => {
    const surface = game.get_surface("nauvis")!
    surface.request_to_generate_chunks({ x: -910, y: 660 }, 1)
    surface.force_generate_chunk_requests()
    // Своя чистая площадка: на разных картах здесь бывают деревья и вода.
    for (const e of surface.find_entities_filtered({ area: [[-913, 657], [-907, 663]] })) if (e.type !== "character") e.destroy()
    const tiles = []
    for (let x = -913; x < -907; x++) for (let y = 657; y < 663; y++) tiles.push({ name: "grass-1", position: { x, y } })
    surface.set_tiles(tiles, true, true, true)
    surface.create_entity({ name: MODELS[0].placer, position: { x: -909.5, y: 660.5 }, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position: { x: -909.5, y: 660.5 }, radius: 0.5 })[0])!
    const fresh = publishProgram("test-update-new", `while (true) { me.say("ok"); wait(5) }`)
    const old = publishProgram("test-update-old", `while (true) { wait(5) }`)
    if (!fresh.ok || !old.ok) error("не опубликованы")
    // Как в сохранении 0.7.0: текст на прежнем API (компилятор тогда его собирал).
    old.program.source = `while (true) { move({ x: 1, y: 2 }); wait(5) }`
    const record = assignProgram(robot, old.program)
    const freshVersion = fresh.program.version
    storage.schemaVersion = 3
    expect(migrate().join(",")).toBe("4")
    expect(fresh.program.version).toBe(freshVersion + 1)
    expect(fresh.program.outdated).toBe(undefined)
    expect(old.program.outdated?.[0].code).toBe("api-moved")
    expect(record.machine.status).toBe("error")
    // Исправили и опубликовали — машина работает.
    const fixed = publishProgram("test-update-old", `while (true) { me.move({ x: -909.5, y: 660.5 }); wait(5) }`)
    expect(fixed.ok && fixed.program.outdated === undefined).toBe(true)
    expect(record.machine.status === "ready" || record.machine.status === "waiting").toBe(true)
    deleteProgram(fresh.program.id)
    robot.entity.destroy()
    deleteProgram(old.program.id)
  })
})
