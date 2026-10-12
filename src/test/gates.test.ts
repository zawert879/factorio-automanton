// Ворота и стены: машина проходит в кольцо стен через ворота и открывает их; кольцо без ворот — пути нет;
// стену с проходом объезжает. Ворота, поставленные без события постройки, находит указатель при обновлении мода.
import { LuaEntity, LuaSurface, MapPosition } from "factorio:runtime"
import { initGates } from "../automaton/gates"
import { isMoving, lastMoveResult, moveRobot } from "../automaton/movement"
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describe, expect, test, waitUntil } from "./testing"

/** Чистая площадка 40×30 из травы. */
function site(x0: number, y0: number): LuaSurface {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: x0 + 20, y: y0 + 15 }, 2)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[x0, y0], [x0 + 40, y0 + 30]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = x0; x < x0 + 40; x++) for (let y = y0; y < y0 + 30; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  return surface
}

/** Кольцо стен x0+12..x0+37, y0+2..y0+27; ворота (если есть) — на левой стороне посередине. */
function ring(surface: LuaSurface, x0: number, y0: number, gate: "built" | "silent" | "none"): LuaEntity[] {
  const placed: LuaEntity[] = []
  for (let x = x0 + 12; x <= x0 + 37; x++) {
    for (let y = y0 + 2; y <= y0 + 27; y++) {
      const edge = x === x0 + 12 || x === x0 + 37 || y === y0 + 2 || y === y0 + 27
      if (!edge || (gate !== "none" && x === x0 + 12 && y === y0 + 15)) continue
      placed.push(surface.create_entity({ name: "stone-wall", position: { x: x + 0.5, y: y + 0.5 }, force: "player" })!)
    }
  }
  if (gate !== "none") {
    const position = { x: x0 + 12.5, y: y0 + 15.5 }
    placed.push(surface.create_entity({ name: "gate", position, direction: defines.direction.north, force: "player", raise_built: gate === "built" })!)
  }
  return placed
}

function place(surface: LuaSurface, position: MapPosition): RobotRecord {
  surface.create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(surface.find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

describe("ворота и стены", () => {
  test("цель за стеной с воротами: машина проходит, ворота открываются", (t) => {
    const x0 = -300
    const y0 = 1300
    const surface = site(x0, y0)
    const built = ring(surface, x0, y0, "built")
    const gate = built[built.length - 1]
    const robot = place(surface, { x: x0 + 4.5, y: y0 + 15.5 })
    moveRobot(robot, { position: { x: x0 + 25.5, y: y0 + 15.5 } })
    let opened = false
    waitUntil(
      t,
      "конца поездки",
      () => {
        if (gate.is_opened()) opened = true
        return !isMoving(robot)
      },
      1200,
      () => {
        expect(`${lastMoveResult(robot)} ${opened}`).toBe("arrived true")
        for (const e of built) e.destroy()
        robot.entity.destroy()
      },
    )
  })

  test("кольцо без ворот: пути нет, сквозь стену машина не идёт", (t) => {
    const x0 = -240
    const y0 = 1300
    const surface = site(x0, y0)
    const built = ring(surface, x0, y0, "none")
    const robot = place(surface, { x: x0 + 4.5, y: y0 + 15.5 })
    moveRobot(robot, { position: { x: x0 + 25.5, y: y0 + 15.5 } })
    waitUntil(t, "конца поездки", () => !isMoving(robot), 1500, () => {
      expect(`${lastMoveResult(robot)} ${robot.entity.position.x < x0 + 12}`).toBe("no-path true")
      for (const e of built) e.destroy()
      robot.entity.destroy()
    })
  })

  test("стена с проходом: машина объезжает", (t) => {
    const x0 = -180
    const y0 = 1300
    const surface = site(x0, y0)
    // Стена поперёк — от низа площадки (вдоль низа — ещё стена) до y0+4: проход только сверху.
    const built: LuaEntity[] = []
    for (let y = y0 + 4; y < y0 + 29; y++) built.push(surface.create_entity({ name: "stone-wall", position: { x: x0 + 20.5, y: y + 0.5 }, force: "player" })!)
    for (let x = x0; x < x0 + 40; x++) built.push(surface.create_entity({ name: "stone-wall", position: { x: x + 0.5, y: y0 + 29.5 }, force: "player" })!)
    const robot = place(surface, { x: x0 + 10.5, y: y0 + 15.5 })
    moveRobot(robot, { position: { x: x0 + 30.5, y: y0 + 15.5 } })
    let topmost = 99
    waitUntil(
      t,
      "конца поездки",
      () => {
        topmost = math.min(topmost, robot.entity.position.y - y0)
        return !isMoving(robot)
      },
      1500,
      () => {
        expect(`${lastMoveResult(robot)} ${topmost < 5}`).toBe("arrived true")
        for (const e of built) e.destroy()
        robot.entity.destroy()
      },
    )
  })

  test("ворота, поставленные без события постройки, находит указатель при обновлении мода", (t) => {
    const x0 = -120
    const y0 = 1300
    const surface = site(x0, y0)
    const built = ring(surface, x0, y0, "silent")
    const gate = built[built.length - 1]
    initGates()
    const robot = place(surface, { x: x0 + 4.5, y: y0 + 15.5 })
    moveRobot(robot, { position: { x: x0 + 25.5, y: y0 + 15.5 } })
    let opened = false
    waitUntil(
      t,
      "конца поездки",
      () => {
        if (gate.is_opened()) opened = true
        return !isMoving(robot)
      },
      1200,
      () => {
        expect(`${lastMoveResult(robot)} ${opened}`).toBe("arrived true")
        for (const e of built) e.destroy()
        robot.entity.destroy()
      },
    )
  })
})
