// Готовность этапа 9: стартовые программы «Оркестратор» и «Рабочий» — оркестратор раздаёт трём рабочим
// печи, рабочие копают руду и кормят печи, табло «штаб» показывает занятость.
import { MapPosition } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { DISPLAYS, MODELS } from "../names"
import { assignProgram } from "../program/machines"
import { findProgram } from "../program/store"
import { renameDisplay } from "../world/displays"
import { createZone } from "../world/zones"
import { describe, expect, test, waitUntil } from "./testing"

describe("пример: оркестратор и рабочие", () => {
  test("три рабочих регистрируются, кормят три печи, табло обновляется", (t) => {
    const surface = game.get_surface("nauvis")!
    const [left, top] = [-680, 320]
    surface.request_to_generate_chunks({ x: left + 20, y: top + 15 }, 2)
    surface.force_generate_chunk_requests()
    const area = { left_top: { x: left, y: top }, right_bottom: { x: left + 40, y: top + 30 } }
    for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
    const tiles = []
    for (let x = left; x < left + 40; x++) for (let y = top; y < top + 30; y++) tiles.push({ name: "grass-1", position: { x, y } })
    surface.set_tiles(tiles, true, true, true)

    // Плавильня: три печи в зоне, табло рядом.
    const furnaces = [0, 3, 6].map((dx) => surface.create_entity({ name: "stone-furnace", position: { x: left + 26 + dx, y: top + 6 }, force: "player" })!)
    createZone("плавильня", surface, { left_top: { x: left + 24, y: top + 3 }, right_bottom: { x: left + 36, y: top + 10 } })
    const screen = surface.create_entity({ name: DISPLAYS[1].name, position: { x: left + 30, y: top + 14 }, force: "player", raise_built: true })!
    const display = storage.displays.byId[screen.unit_number!]!
    renameDisplay(display, "штаб")
    // Поле: руда 6×6 и зона на нём.
    for (let x = left + 4; x < left + 10; x++) for (let y = top + 20; y < top + 26; y++) surface.create_entity({ name: "iron-ore", position: { x: x + 0.5, y: y + 0.5 }, amount: 1000 })
    createZone("поле", surface, { left_top: { x: left + 4, y: top + 20 }, right_bottom: { x: left + 10, y: top + 26 } })

    const place = (position: MapPosition): RobotRecord => {
      surface.create_entity({ name: MODELS[0].placer, position, force: "player", raise_built: true })
      return findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position, radius: 0.5 })[0])!
    }
    const boss = place({ x: left + 30.5, y: top + 9.5 })
    const workers = [0, 2, 4].map((dx) => place({ x: left + 12.5 + dx, y: top + 16.5 }))
    for (const robot of [boss, ...workers]) robot.fuel.insert({ name: "coal", count: 20 })

    const orchestrator = findProgram("Оркестратор", "player")!
    const worker = findProgram("Рабочий", "player")!
    assignProgram(boss, orchestrator)
    for (const robot of workers) {
      assignProgram(robot, worker)
      storage.machines[robot.id]!.args = { field: "поле", amount: 3 }
    }

    const fed = () => furnaces.every((f) => f.get_item_count("iron-ore") >= 3)
    waitUntil(t, "руды во всех печах", fed, 3600, () => {
      expect(storage.machines[boss.id]!.machine.status).toBe("waiting")
      for (const robot of workers) expect(storage.machines[robot.id]!.machine.status === "error").toBe(false)
      // Табло: заголовок, шапка таблицы (2) и по две ячейки на рабочего.
      const texts = display.shown.filter((s) => string.sub(s.key, 1, 2) === "t|").length
      expect(texts).toBe(1 + 2 + 3 * 2)
      for (const robot of [boss, ...workers]) robot.entity.destroy()
      for (const f of furnaces) f.destroy()
      screen.destroy()
    })
  })
})
