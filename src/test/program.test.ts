// Программы машин в игре (этап 4): публикация, запуск, API, планировщик, сквозной сценарий 4.10.
import { LuaSurface } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { MARKER, WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord, machineOf } from "../program/machines"
import { publishProgram } from "../program/store"
import { markerOf, renameMarker } from "../world/markers"
import { createZone } from "../world/zones"
import { describe, expect, test, waitUntil } from "./testing"

/** Чистая площадка 30×30 из травы с машиной в углу (x0 + 2, y0 + 2). */
function site(x0: number, y0: number): { surface: LuaSurface; robot: RobotRecord } {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: x0 + 15, y: y0 + 15 }, 2)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[x0, y0], [x0 + 30, y0 + 30]] })) {
    if (e.type !== "character") e.destroy()
  }
  const tiles = []
  for (let x = x0; x < x0 + 30; x++) for (let y = y0; y < y0 + 30; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  const position = { x: x0 + 2.5, y: y0 + 2.5 }
  surface.create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  const robot = findRobot(surface.find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
  return { surface, robot }
}

function run(robot: RobotRecord, name: string, source: string): MachineRecord {
  const result = publishProgram(name, source)
  if (!result.ok) error(`не компилируется: ${describeDiagnostics(result.diagnostics).join("; ")}`)
  return assignProgram(robot, result.program)
}

function output(record: MachineRecord): string {
  return record.console.filter((line) => !line.startsWith("—")).join("|")
}

const finished = (record: MachineRecord) => () => record.machine.status === "done" || record.machine.status === "error"

describe("программы машин", () => {
  test("print, me, состояние", (t) => {
    const { robot } = site(-600, 100)
    robot.cargo.insert({ name: "coal", count: 3 })
    const m = run(robot, "test-me", `print("hi", typeof me.id, me.cargo.count("coal"), me.cargo.isEmpty(), me.model)\nme.label = "тест"`)
    waitUntil(t, "конца программы", finished(m), 120, () => {
      expect(output(m)).toBe("hi number 3 false worker-mk1")
      expect(m.machine.status).toBe("done")
      expect(m.label).toBe("тест")
      robot.entity.destroy()
    })
  })

  test("wait и time: программа ждёт секунду, не тратя квант", (t) => {
    const { robot } = site(-640, 100)
    const m = run(robot, "test-wait", `const t0 = time.tick\nwait(1)\nprint(time.tick - t0 >= 60, time.tick - t0 < 70)`)
    waitUntil(t, "конца программы", finished(m), 200, () => {
      expect(output(m)).toBe("true true")
      robot.entity.destroy()
    })
  })

  test("move: программа продолжается после приезда", (t) => {
    const { robot } = site(-680, 100)
    const x = robot.entity.position.x + 8
    const m = run(robot, "test-move", `move({ x: ${x}, y: me.position.y })\nprint("arrived", Math.abs(me.position.x - ${x}) < 1.5)`)
    waitUntil(t, "конца программы", finished(m), 600, () => {
      expect(output(m)).toBe("arrived true")
      robot.entity.destroy()
    })
  })

  test("ошибки: ActionError ловится, необработанная — строка и статус error", (t) => {
    const { robot } = site(-720, 100)
    const m = run(robot, "test-errors", `try { mine("iron-ore", 1) } catch (e) { print(e instanceof ActionError, e.code) }\nconst o: any = undefined\nprint(o.x)`)
    waitUntil(t, "конца программы", finished(m), 200, () => {
      expect(m.machine.status).toBe("error")
      expect(output(m)).toBe("true no-resource|Ошибка (строка 3): TypeError: Cannot read properties of undefined (reading 'x')")
      robot.entity.destroy()
    })
  })

  test("зоны, find и видимость: далёкое здание — только неизменное", (t) => {
    const { surface, robot } = site(-760, 100)
    const furnace = surface.create_entity({ name: "stone-furnace", position: { x: -735, y: 125 }, force: "player" })!
    createZone("далеко", surface, { left_top: { x: -740, y: 120 }, right_bottom: { x: -730, y: 130 } })
    const m = run(
      robot,
      "test-sight",
      `const f = find("stone-furnace", zone("далеко"))[0]\nprint(f.name, f.inSight, f.valid)\ntry { print(f.status) } catch (e) { print(e.code) }`,
    )
    waitUntil(t, "конца программы", finished(m), 200, () => {
      expect(output(m)).toBe("stone-furnace false true|out-of-sight")
      furnace.destroy()
      robot.entity.destroy()
    })
  })

  test("метки по имени и scan.entities в поле зрения", (t) => {
    const { surface, robot } = site(-800, 100)
    const flag = surface.create_entity({ name: MARKER, position: { x: -790, y: 103 }, force: "player", raise_built: true })!
    renameMarker(markerOf(flag)!, "склад")
    const chest = surface.create_entity({ name: "iron-chest", position: { x: -795, y: 104 }, force: "player" })!
    chest.insert({ name: "iron-plate", count: 7 })
    const m = run(
      robot,
      "test-marker",
      `const p = marker("склад").position\nprint(p.x, p.y)\nconst c = scan.entities({ name: "iron-chest" })[0]\nprint(c.name, c.count("iron-plate"), c.status)`,
    )
    waitUntil(t, "конца программы", finished(m), 200, () => {
      expect(output(m)).toBe("-789.5 103.5|iron-chest 7 idle")
      flag.destroy()
      chest.destroy()
      robot.entity.destroy()
    })
  })

  test("память переживает перезапуск при новой версии программы", (t) => {
    const { robot } = site(-840, 100)
    const source = `const n = (me.memory.get<number>("runs") ?? 0) + 1\nme.memory.set("runs", n)\nprint("run", n)`
    const m = run(robot, "test-memory", source)
    waitUntil(t, "первого запуска", finished(m), 100, () => {
      run(robot, "test-memory", source + "\n")
      waitUntil(t, "второго запуска", () => output(m) === "run 1|run 2", 100, () => {
        robot.entity.destroy()
      })
    })
  })

  test("бесконечный цикл одной машины не мешает другой", (t) => {
    const a = site(-880, 100).robot
    const b = site(-920, 100).robot
    const busy = run(a, "test-busy", `let n = 0\nwhile (true) n++`)
    const quick = run(b, "test-quick", `print("ok")`)
    waitUntil(t, "второй машины", finished(quick), 60, () => {
      expect(output(quick)).toBe("ok")
      expect(busy.machine.status).toBe("ready")
      a.entity.destroy()
      b.entity.destroy()
    })
  })
})

describe("программы машин: поиск пути и зрение", () => {
  test("canReach: до точки на траве — да, до точки посреди озера — нет", (t) => {
    const { surface, robot } = site(-1000, 100)
    const water = []
    for (let x = -985; x < -975; x++) for (let y = 110; y < 120; y++) water.push({ name: "deepwater", position: { x, y } })
    surface.set_tiles(water, true, true, true)
    const m = run(robot, "test-reach", `print(canReach({ x: -990, y: 104 }), canReach({ x: -980, y: 115 }))`)
    waitUntil(t, "конца программы", finished(m), 600, () => {
      expect(output(m)).toBe("true false")
      robot.entity.destroy()
    })
  })

  test("scan.entities видит только в радиусе зрения", (t) => {
    const { surface, robot } = site(-1040, 100)
    const near = surface.create_entity({ name: "wooden-chest", position: { x: -1033, y: 104 }, force: "player" })!
    const far = surface.create_entity({ name: "wooden-chest", position: { x: -1020, y: 104 }, force: "player" })!
    const m = run(robot, "test-vision", `const found = scan.entities({ name: "wooden-chest" })
print(found.length, found[0].position.x)`)
    waitUntil(t, "конца программы", finished(m), 100, () => {
      expect(output(m)).toBe("1 -1032.5")
      near.destroy()
      far.destroy()
      robot.entity.destroy()
    })
  })
})

describe("сквозной сценарий 4.10", () => {
  test("разведчик: едет по спирали и отмечает месторождения на карте", (t) => {
    const { surface, robot } = site(-1100, 100)
    for (let dx = 0; dx < 2; dx++) surface.create_entity({ name: "copper-ore", position: { x: -1084.5 + dx, y: 103.5 }, amount: 500 })
    robot.fuel.insert({ name: "coal", count: 50 })
    const m = run(
      robot,
      "Разведчик",
      `const seen = new Set<string>()
const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]]
let pos = me.position
let step = 6
for (let turn = 0; turn < 3 && me.fuel > 0.3; turn++) {
  for (const patch of scan.resources()) {
    const key = \`\${patch.item}:\${Math.floor(patch.center.x / 32)}:\${Math.floor(patch.center.y / 32)}\`
    if (seen.has(key)) continue
    seen.add(key)
    map.tag(patch.center, \`\${patch.item}: \${patch.amount}\`, patch.item)
    print(\`Нашёл \${patch.item}, запас \${patch.amount}\`)
  }
  const [dx, dy] = dirs[turn % 4]
  pos = { x: pos.x + dx * step, y: pos.y + dy * step }
  try { move(pos) } catch {}
  if (turn % 2 === 1) step += 6
}`,
    )
    waitUntil(t, "конца программы", finished(m), 1500, () => {
      expect(m.machine.status).toBe("done")
      expect(output(m)).toBe("Нашёл copper-ore, запас 1000")
      const tags = robot.entity.force.find_chart_tags(surface, { left_top: { x: -1090, y: 98 }, right_bottom: { x: -1080, y: 108 } })
      expect(tags.length).toBe(1)
      for (const tag of tags) tag.destroy()
      robot.entity.destroy()
    })
  })


  test("шахтёр: добыть руду, отвезти в печь, забрать пластины", (t) => {
    const { surface, robot } = site(-960, 100)
    for (let dy = 0; dy < 3; dy++) surface.create_entity({ name: "iron-ore", position: { x: -955.5, y: 102.5 + dy }, amount: 100 })
    const furnace = surface.create_entity({ name: "stone-furnace", position: { x: -950, y: 103 }, force: "player" })!
    robot.cargo.insert({ name: "coal", count: 5 })
    machineOf(robot.id).args = { ore: "iron-ore" }
    const m = run(
      robot,
      "Шахтёр",
      `const { ore } = me.args<{ ore: string }>()
const furnace = scan.entities({ name: "stone-furnace" })[0]
put(furnace, "coal", 2)
while (furnace.count("iron-plate") < 2) {
  if (me.cargo.count(ore) === 0) {
    const patch = scan.resources().find(p => p.item === ore)!
    move(patch.nearest, { radius: 1.5 })
    mine(ore, 2)
    move(furnace)
  }
  put(furnace, ore)
  wait(1)
}
take(furnace, "iron-plate")
print("пластин:", me.cargo.count("iron-plate"))`,
    )
    waitUntil(t, "пластин", finished(m), 3000, () => {
      expect(m.machine.status).toBe("done")
      expect(robot.cargo.get_item_count("iron-plate") >= 2).toBe(true)
      furnace.destroy()
      robot.entity.destroy()
    })
  })
})
