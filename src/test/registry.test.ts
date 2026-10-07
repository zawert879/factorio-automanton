// Внутриигровые тесты реестра машин: id, имена, подписи, подбор и возврат, гибель, подхват старых машин.
import { LuaEntity, MapPosition } from "factorio:runtime"
import { replacePlacer } from "../automaton/placement"
import { adoptUnregisteredRobots, findRobot, RobotTag, tagFromStack, tagMinedRobot } from "../automaton/registry"
import { ROBOT_TAG, WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

function freePosition(near: MapPosition): MapPosition {
  return nauvis().find_non_colliding_position(WORKER_MK1, near, 30, 0.5)!
}

function workerAt(position: MapPosition): LuaEntity {
  return nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0]
}

/** Поставить машину так, как это делает игра: заглушка + событие постройки. */
function placeWorker(near: MapPosition): LuaEntity {
  const position = freePosition(near)
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return workerAt(position)
}

/** Поставить машину из предмета с тегом (как on_built_entity при постройке игроком). */
function placeWorkerWithTag(near: MapPosition, tag: RobotTag | undefined): LuaEntity {
  const position = freePosition(near)
  replacePlacer(nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player" })!, tag)
  return workerAt(position)
}

describe("реестр машин", () => {
  test("поставленная машина получает id, имя AM-<id> и подпись в режиме Alt", () => {
    const worker = placeWorker({ x: 30, y: -30 })
    const record = findRobot(worker)!
    expect(record.name).toBe(`AM-${record.id}`)
    expect(record.entity === worker).toBe(true)
    expect(record.label.valid).toBe(true)
    expect(record.label.text).toBe(record.name)
    expect(record.label.only_in_alt_mode).toBe(true)
    worker.destroy()
  })

  test("id растут и не повторяются", () => {
    const a = placeWorker({ x: 30, y: -30 })
    const b = placeWorker({ x: 33, y: -30 })
    expect(findRobot(b)!.id > findRobot(a)!.id).toBe(true)
    a.destroy()
    b.destroy()
  })

  test("погибшая машина снимается с учёта вместе с подписью", (t) => {
    const worker = placeWorker({ x: 30, y: -30 })
    const { id, label } = findRobot(worker)!
    worker.die()
    t.after(2, () => {
      expect(storage.robots.byId[id]).toBe(undefined)
      expect(label.valid).toBe(false)
    })
  })

  test("подобранная машина уносит id и имя в предмет и возвращается с ними", () => {
    const worker = placeWorker({ x: 30, y: -40 })
    const record = findRobot(worker)!
    const id = record.id
    record.name = "Вася"
    // Как в событии подбора: предмет уже в буфере, сущность ещё жива.
    const buffer = game.create_inventory(1)
    buffer.insert({ name: WORKER_MK1, count: 1 })
    tagMinedRobot(worker, buffer)
    worker.destroy()
    expect(storage.robots.byId[id]).toBe(undefined)
    const [stack] = buffer.find_item_stack(WORKER_MK1)
    const tag = tagFromStack(stack)!
    expect(tag.id).toBe(id)
    expect(tag.name).toBe("Вася")
    expect(stack!.label).toBe("Вася")

    const again = placeWorkerWithTag({ x: 30, y: -40 }, tag)
    expect(findRobot(again)!.id).toBe(id)
    expect(findRobot(again)!.name).toBe("Вася")
    expect(findRobot(again)!.label.text).toBe("Вася")
    again.destroy()
    buffer.destroy()
  })

  test("если id из предмета уже занят, машина получает новый, имя сохраняется", () => {
    const original = placeWorker({ x: 30, y: -50 })
    const id = findRobot(original)!.id
    const twin = placeWorkerWithTag({ x: 33, y: -50 }, { id, name: "Двойник" })
    expect(findRobot(twin)!.id === id).toBe(false)
    expect(findRobot(twin)!.name).toBe("Двойник")
    original.destroy()
    twin.destroy()
  })

  test("машина без записи (поставлена до реестра) подхватывается при обновлении мода", () => {
    const unit = nauvis().create_entity({ name: WORKER_MK1, position: freePosition({ x: 30, y: -60 }), force: "player" })!
    expect(findRobot(unit)).toBe(undefined)
    adoptUnregisteredRobots()
    expect(findRobot(unit) !== undefined).toBe(true)
    unit.destroy()
  })

  test("если машина не встаёт, предмет высыпается с её тегом", () => {
    const tiles = []
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) tiles.push({ name: "water", position: { x: -20 + dx, y: 20 + dy } })
    }
    nauvis().set_tiles(tiles, true, true)
    const position = { x: -19.5, y: 20.5 }
    replacePlacer(nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player" })!, { id: 999, name: "Утопленник" })
    const spilled = nauvis().find_entities_filtered({ type: "item-entity", position, radius: 4 })
    const item = spilled.find((e) => e.stack?.name === WORKER_MK1)
    expect((item?.stack?.tags[ROBOT_TAG] as RobotTag | undefined)?.name).toBe("Утопленник")
    for (const e of spilled) e.destroy()
  })
})
