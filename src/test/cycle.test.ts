// Сквозной тест этапа 2: добыть руду → отвезти в печь → положить руду и уголь → забрать пластины.
import { currentAction, lastActionResult, startAction } from "../automaton/actions"
import { isMoving, lastMoveResult, moveRobot } from "../automaton/movement"
import { findRobot } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, waitUntil } from "./testing"

describe("цикл этапа 2", () => {
  test("добыть → отвезти в печь → забрать слитки", (t) => {
    const s = game.get_surface("nauvis")!
    s.request_to_generate_chunks({ x: -450, y: 20 }, 2)
    s.force_generate_chunk_requests()
    for (const e of s.find_entities_filtered({ area: [[-470, 0], [-430, 40]] })) e.destroy()
    const tiles = []
    for (let x = -470; x < -430; x++) for (let y = 0; y < 40; y++) tiles.push({ name: "grass-1", position: { x, y } })
    s.set_tiles(tiles, true, true, true)
    for (let dy = 0; dy < 3; dy++) s.create_entity({ name: "iron-ore", position: { x: -465.5, y: 20.5 + dy }, amount: 100 })
    const furnace = s.create_entity({ name: "stone-furnace", position: { x: -440, y: 21 }, force: "player" })!
    s.create_entity({ name: WORKER_MK1_PLACER, position: { x: -463.5, y: 21.5 }, force: "player", raise_built: true })
    const robot = findRobot(s.find_entities_filtered({ name: WORKER_MK1, position: { x: -463.5, y: 21.5 }, radius: 0.5 })[0])!
    robot.cargo.insert({ name: "coal", count: 5 })

    startAction(robot, "mine", { item: "iron-ore", count: 4 })
    waitUntil(t, "добычи", () => currentAction(robot) === undefined, 1500, () => {
      expect(robot.cargo.get_item_count("iron-ore")).toBe(4)
      moveRobot(robot, { entity: furnace })
      waitUntil(t, "приезда к печи", () => !isMoving(robot), 900, () => {
        expect(lastMoveResult(robot)).toBe("arrived")
        startAction(robot, "put", { target: furnace, item: "coal", count: 2 })
        waitUntil(t, "топлива в печи", () => currentAction(robot) === undefined, 120, () => {
          startAction(robot, "put", { target: furnace, item: "iron-ore" })
          waitUntil(t, "руды в печи", () => currentAction(robot) === undefined, 120, () => {
            expect(lastActionResult(robot)?.count).toBe(4)
            // Каменная печь плавит пластину за 3.2 с: четыре — около 13 с.
            waitUntil(t, "плавки", () => furnace.get_item_count("iron-plate") >= 4, 1200, () => {
              startAction(robot, "take", { target: furnace, item: "iron-plate" })
              waitUntil(t, "пластин в грузе", () => currentAction(robot) === undefined, 120, () => {
                expect(robot.cargo.get_item_count("iron-plate")).toBe(4)
                robot.entity.destroy()
                furnace.destroy()
              })
            })
          })
        })
      })
    })
  })
})
