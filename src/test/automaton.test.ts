// Внутриигровые тесты прототипа рабочего автоматона и его установки.
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test } from "./testing"

describe("автоматон: прототип", () => {
  test("предмет ставит заглушку, рецепт открыт с начала игры", () => {
    expect(prototypes.item[WORKER_MK1].place_result?.name).toBe(WORKER_MK1_PLACER)
    expect(game.forces["player"].recipes[WORKER_MK1].enabled).toBe(true)
  })

  test("отладочная команда /am-give зарегистрирована", () => {
    expect(commands.commands["am-give"] !== undefined).toBe(true)
  })

  test("юнит на стороне игрока подбирается обратно в предмет", () => {
    const products = prototypes.entity[WORKER_MK1].mineable_properties.products ?? []
    expect(products.length).toBe(1)
    expect(products[0].name).toBe(WORKER_MK1)
  })
})

describe("автоматон: установка", () => {
  test("заглушка сразу заменяется на юнит, и он стоит на месте", (t) => {
    const surface = game.get_surface("nauvis")!
    const position = surface.find_non_colliding_position(WORKER_MK1, { x: 0, y: 0 }, 30, 0.5)!
    const placer = surface.create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })

    // Обработчик заменил заглушку ещё внутри create_entity — ссылки на неё нет или она мёртвая.
    expect(placer === undefined || !placer.valid).toBe(true)
    const workers = surface.find_entities_filtered({ name: WORKER_MK1, position, radius: 1 })
    expect(workers.length).toBe(1)
    const worker = workers[0]
    expect(worker.force.name).toBe("player")
    const start = worker.position

    t.after(300, () => {
      expect(worker.valid).toBe(true)
      expect(math.abs(worker.position.x - start.x) < 0.1 && math.abs(worker.position.y - start.y) < 0.1).toBe(true)
      expect(worker.health).toBe(worker.max_health)
      worker.destroy()
    })
  })

  test("если юнит не встаёт, предмет не пропадает", () => {
    const surface = game.get_surface("nauvis")!
    // Своя лужа 3×3 в известном месте: ближайшая суша рядом, тест не зависит от генерации карты.
    const tiles = []
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) tiles.push({ name: "water", position: { x: 20 + dx, y: 20 + dy } })
    }
    surface.set_tiles(tiles, true, true)
    // Заглушку ставим скриптом прямо в воду: юнит туда не встанет.
    const position = { x: 20.5, y: 20.5 }
    surface.create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
    expect(surface.find_entities_filtered({ name: WORKER_MK1, position, radius: 1 }).length).toBe(0)
    const spilled = surface.find_entities_filtered({ type: "item-entity", position, radius: 3 })
    expect(spilled.some((e) => e.stack.name === WORKER_MK1)).toBe(true)
    for (const e of spilled) e.destroy()
  })
})
