// Внутриигровые тесты боя (этап 10): боевая модель, reload, attack, patrol, guard, me.weapon.
import { LuaForce, MapPosition } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { COMBAT_MK1, MODELS, TECH } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { findProgram } from "../program/store"
import { markerOf, renameMarker } from "../world/markers"
import { createZone } from "../world/zones"
import { describe, expect, test, TestContext, waitUntil } from "./testing"

const COMBAT = MODELS.find((m) => m.entity === COMBAT_MK1)!

function nauvis() {
  return game.get_surface("nauvis")!
}

function player(): LuaForce {
  return game.forces.player
}

function arena(left: number, top: number): void {
  const surface = nauvis()
  surface.request_to_generate_chunks({ x: left + 15, y: top + 15 }, 2)
  surface.force_generate_chunk_requests()
  const area = { left_top: { x: left, y: top }, right_bottom: { x: left + 30, y: top + 30 } }
  for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = left; x < left + 30; x++) for (let y = top; y < top + 30; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
}

function placeCombat(position: MapPosition): RobotRecord {
  nauvis().create_entity({ name: COMBAT.placer, position, force: "player", raise_built: true })
  const robot = findRobot(nauvis().find_entities_filtered({ name: COMBAT.entity, position, radius: 0.5 })[0])!
  robot.fuel.insert({ name: "coal", count: 10 })
  return robot
}

function run(t: TestContext, robot: RobotRecord, name: string, source: string, maxTicks: number, then: (output: string, m: MachineRecord) => void): void {
  const result = publishProgram(name, source)
  if (!result.ok) error(describeDiagnostics(result.diagnostics).join("; "))
  const m = assignProgram(robot, result.program)
  waitUntil(t, `конца программы ${name}`, () => m.machine.status === "done" || m.machine.status === "error", maxTicks, () =>
    then(m.console.filter((line) => !line.startsWith("—")).join("|"), m),
  )
}

describe("бой", () => {
  test("боевая модель: оружейный слот, reload из груза, me.weapon; у рабочего оружия нет", (t) => {
    arena(-720, 360)
    const robot = placeCombat({ x: -710.5, y: 370.5 })
    expect(robot.weapon?.length).toBe(1)
    robot.cargo.insert({ name: "firearm-magazine", count: 5 })
    robot.cargo.insert({ name: "piercing-rounds-magazine", count: 3 })
    run(
      t,
      robot,
      "test-reload",
      `print(me.weapon!.type, me.weapon!.ammo === null, me.weapon!.range)
reload()
print(me.weapon!.ammo!.name, me.weapon!.ammo!.count, me.cargo.count("piercing-rounds-magazine"))
reload("firearm-magazine")
print(me.weapon!.ammo!.name, me.cargo.count("piercing-rounds-magazine"), me.cargo.count("firearm-magazine"))`,
      200,
      (output) => {
        expect(output).toBe("gun true 15|piercing-rounds-magazine 3 0|firearm-magazine 3 0")
        robot.entity.destroy()
      },
    )
  })

  test("attack: убивает кусаку, тратит патроны; без патронов — no-ammo", (t) => {
    arena(-720, 400)
    const robot = placeCombat({ x: -712.5, y: 410.5 })
    player().technologies[TECH.sensors2].researched = true
    const biter = nauvis().create_entity({ name: "small-biter", position: { x: -702.5, y: 410.5 }, force: "enemy" })!
    biter.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
    robot.weapon!.insert({ name: "firearm-magazine", count: 2 })
    run(
      t,
      robot,
      "test-attack",
      `const enemy = scan.enemies()[0]
print(attack(enemy), enemy.valid)`,
      600,
      (output) => {
        player().technologies[TECH.sensors2].researched = false
        expect(output).toBe("true false")
        // Кусаке (15 здоровья, подлечивается) хватает 3–4 выстрелов по 5 из первого магазина (10 зарядов).
        const left = robot.weapon![0].ammo
        expect(left >= 5 && left <= 7).toBe(true)
        robot.weapon!.clear()
        const target = nauvis().create_entity({ name: "small-biter", position: { x: -705.5, y: 415.5 }, force: "enemy" })!
        target.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
        player().technologies[TECH.sensors2].researched = true
        run(t, robot, "test-no-ammo", `try { attack(scan.enemies()[0]) } catch (e) { print(e instanceof ActionError ? e.code : "?") }`, 120, (second) => {
          player().technologies[TECH.sensors2].researched = false
          // Консоль машины хранит и строки прошлой программы — нужна последняя.
          const lines = second.split("|")
          expect(lines[lines.length - 1]).toBe("no-ammo")
          target.destroy()
          robot.entity.destroy()
        })
      },
    )
  })

  test("patrol: объезжает посты, until останавливает", (t) => {
    arena(-720, 440)
    const robot = placeCombat({ x: -715.5, y: 445.5 })
    robot.weapon!.insert({ name: "firearm-magazine", count: 5 })
    const posts = [
      { x: -712.5, y: 445.5, name: "пост-а" },
      { x: -700.5, y: 455.5, name: "пост-б" },
    ].map((p) => {
      const entity = nauvis().create_entity({ name: "automaton-marker", position: p, force: "player", raise_built: true })!
      renameMarker(markerOf(entity)!, p.name)
      return entity
    })
    run(
      t,
      robot,
      "test-patrol",
      `let reachedB = false
patrol([marker("пост-а"), marker("пост-б")], () => {
  if (me.distance(marker("пост-б")) < 3) reachedB = true
  return reachedB && me.distance(marker("пост-а")) < 3
})
print("круг")`,
      1200,
      (output) => {
        expect(output).toBe("круг")
        robot.entity.destroy()
        for (const post of posts) post.destroy()
      },
    )
  })

  test("guard: отбивается от врага у поста, пока until не вернёт true", (t) => {
    arena(-720, 480)
    const robot = placeCombat({ x: -705.5, y: 495.5 })
    player().technologies[TECH.sensors2].researched = true
    robot.weapon!.insert({ name: "firearm-magazine", count: 5 })
    const biter = nauvis().create_entity({ name: "small-biter", position: { x: -695.5, y: 495.5 }, force: "enemy" })!
    biter.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
    run(t, robot, "test-guard", `guard(me.position, { radius: 15, until: () => scan.enemies().length === 0 })\nprint("чисто")`, 900, (output) => {
      player().technologies[TECH.sensors2].researched = false
      expect(output).toBe("чисто")
      expect(biter.valid).toBe(false)
      robot.entity.destroy()
    })
  })

  test("пример «Патруль»: едет в арсенал за патронами, перезаряжается, объезжает посты", (t) => {
    arena(-760, 360)
    const surface = nauvis()
    const robot = placeCombat({ x: -755.5, y: 365.5 })
    robot.weapon!.insert({ name: "firearm-magazine", count: 5 })
    const chest = surface.create_entity({ name: "wooden-chest", position: { x: -740.5, y: 365.5 }, force: "player" })!
    chest.insert({ name: "firearm-magazine", count: 100 })
    createZone("арсенал", surface, { left_top: { x: -742, y: 364 }, right_bottom: { x: -739, y: 367 } })
    const posts = [
      { x: -745.5, y: 380.5, name: "пост-1" },
      { x: -755.5, y: 385.5, name: "пост-2" },
    ].map((p) => {
      const entity = surface.create_entity({ name: "automaton-marker", position: p, force: "player", raise_built: true })!
      renameMarker(markerOf(entity)!, p.name)
      return entity
    })
    assignProgram(robot, findProgram("Патруль", "player")!)
    // Параметры — значения программы: массив — таблица с __n (так их делает окно машины из JSON).
    storage.machines[robot.id]!.args = { posts: { __n: 2, 1: "пост-1", 2: "пост-2" } }
    let visited = false
    const done = () => {
      if (robot.entity.valid && posts.some((p) => math.abs(p.position.x - robot.entity.position.x) < 3 && math.abs(p.position.y - robot.entity.position.y) < 3)) visited = true
      return visited && (robot.weapon![0].valid_for_read ? robot.weapon![0].count : 0) >= 50
    }
    waitUntil(t, "патроны и пост", done, 2400, () => {
      expect(chest.get_item_count("firearm-magazine")).toBe(50)
      expect(storage.machines[robot.id]!.machine.status).toBe("waiting")
      robot.entity.destroy()
      chest.destroy()
      for (const post of posts) post.destroy()
    })
  })
})
