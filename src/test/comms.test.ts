// Внутриигровые тесты связи (этап 9): сообщения, запросы, подписки, ящик, доска, задачи.
import { MapPosition } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { MODELS, TECH } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord, restartMachine } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

let placed = 0
let prepared = false

/** Площадка 44×24 из травы без сущностей — один раз на все тесты связи. */
function prepare(): void {
  if (prepared) return
  prepared = true
  const surface = nauvis()
  surface.request_to_generate_chunks({ x: -480, y: 12 }, 2)
  surface.force_generate_chunk_requests()
  const area = { left_top: { x: -502, y: -2 }, right_bottom: { x: -458, y: 22 } }
  for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = -502; x < -458; x++) for (let y = -2; y < 22; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
}

/** Машина с именем в своей клетке площадки (тесты связи не зависят от расстояния). */
function robotNamed(name: string): RobotRecord {
  prepare()
  const surface = nauvis()
  const position: MapPosition = { x: -500.5 + (placed % 20) * 2, y: 0.5 + (math.floor(placed / 20) % 10) * 2 }
  placed++
  for (const e of surface.find_entities_filtered({ position, radius: 1 })) if (e.type !== "character") e.destroy()
  surface.create_entity({ name: MODELS[0].placer, position, force: "player", raise_built: true })
  const record = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position, radius: 0.5 })[0])!
  record.name = name
  return record
}

function start(robot: RobotRecord, source: string): MachineRecord {
  const result = publishProgram(`test-comms-${robot.name}-${placed}`, source)
  if (!result.ok) error(describeDiagnostics(result.diagnostics).join("; "))
  return assignProgram(robot, result.program)
}

function output(m: MachineRecord): string {
  return m.console.filter((line) => !line.startsWith("—")).join("|")
}

const finished = (...machines: MachineRecord[]) => () => machines.every((m) => m.machine.status === "done" || m.machine.status === "error")

function cleanup(...robots: RobotRecord[]): void {
  for (const robot of robots) if (robot.entity.valid) robot.entity.destroy()
}

describe("связь между машинами", () => {
  test("send / receive: данные копируются, отправитель и время отправки известны", (t) => {
    const a = robotNamed("альфа")
    const b = robotNamed("бета")
    const mb = start(b, `const m = receive<{ n: number }>("привет")!
print(m.data.n, m.from.name, m.topic, m.sentAt < time.tick)`)
    const ma = start(a, `const data = { n: 1 }
send("бета", "привет", data)
data.n = 2
print("ok")`)
    waitUntil(t, "конца программ", finished(ma, mb), 300, () => {
      expect(output(mb)).toBe("1 альфа привет true")
      expect(output(ma)).toBe("ok")
      cleanup(a, b)
    })
  })

  test("request / reply; таймаут receive — null, request — ActionError timeout", (t) => {
    const keeper = robotNamed("кладовщик")
    const asker = robotNamed("спрашивающий")
    const silent = robotNamed("молчун")
    const mk = start(keeper, `while (true) { const m = receive<string>("сколько")!; m.reply(m.data === "coal" ? 42 : 0) }`)
    const ms = start(silent, `while (true) wait(10)`)
    const ma = start(asker, `print(request<number>("кладовщик", "сколько", "coal", 5))
print(receive("ничего", 0.3))
try { request("молчун", "эй", 1, 0.3) } catch (e) { print(e instanceof ActionError ? e.code : "?") }`)
    waitUntil(t, "конца спрашивающего", finished(ma), 300, () => {
      expect(output(ma)).toBe("42|undefined|timeout")
      expect(mk.machine.status).toBe("waiting")
      void ms
      cleanup(keeper, asker, silent)
    })
  })

  test("publish — только подписанным на машину (на тему или на все темы); ящик на 64", (t) => {
    const sender = robotNamed("диктор")
    const listener = robotNamed("слушатель")
    const all = robotNamed("всеслух")
    const deaf = robotNamed("глухой")
    const ml = start(listener, `subscribe("диктор", "новости")
wait(1)
const first = tryReceive<number>("новости")!
print(inbox.count, inbox.dropped, first.data, tryReceive("погода") === null)`)
    const ma = start(all, `subscribe(robot("диктор")!)
wait(1)
print(tryReceive("погода") !== null)`)
    // Подписка на тему (как было с broadcast) — ошибка с подсказкой: подписываются на машину.
    const md = start(deaf, `try { subscribe("новости") } catch (e) { print(e instanceof ActionError ? e.code : "?") }
wait(1)
print(tryReceive("новости") === null, inbox.count)`)
    const msd = start(sender, `wait(0.2)
for (let i = 1; i <= 70; i++) publish("новости", i)
publish("погода", "дождь")`)
    waitUntil(t, "конца программ", finished(ml, ma, md, msd), 300, () => {
      // 70 новостей: 6 самых старых выброшены, первая оставшаяся — №7, после неё в ящике 63; погоды нет.
      expect(output(ml)).toBe("63 6 7 true")
      expect(output(ma)).toBe("true")
      expect(output(md)).toBe("invalid-target|true 0")
      cleanup(sender, listener, all, deaf)
    })
  })

  test("публикация многим подписчикам стоит отправителю квант: перерасход — долг, машина пропускает тики", (t) => {
    const speaker = robotNamed("громкоговоритель")
    const fans: RobotRecord[] = []
    for (let i = 0; i < 120; i++) fans.push(robotNamed(`слушатель-${i}`))
    // Подписки — напрямую, без 120 программ.
    for (const fan of fans) storage.comms.followers[speaker.id] = { ...(storage.comms.followers[speaker.id] ?? {}), [fan.id]: { "": true } }
    const m = start(speaker, `const t0 = time.tick
publish("новость", 1)
for (let i = 0; i < 3; i++) {}
print(time.tick - t0)`)
    waitUntil(t, "конца программы", finished(m), 120, () => {
      // 120 писем при кванте Mk1 50: долг ~70 инструкций — следующий виток только через тики.
      expect(tonumber(output(m))! >= 2).toBe(true)
      storage.comms.followers[speaker.id] = undefined
      cleanup(speaker, ...fans)
    })
  })

  test("отписка и перезапуск: свои подписки снимаются, подписки на машину остаются", (t) => {
    const source = robotNamed("источник")
    const fan = robotNamed("поклонник")
    const mf = start(fan, `subscribe("источник")
unsubscribe("источник")
subscribe("источник", "a")
unsubscribe("источник", "a")
subscribe("источник", "b")
wait(1)
print(tryReceive("a") === null, tryReceive("b") !== null)`)
    const ms = start(source, `wait(0.3)
publish("a")
publish("b")`)
    waitUntil(t, "конца программ", finished(mf, ms), 300, () => {
      expect(output(mf)).toBe("true true")
      // Подписчик закончил — его подписка жива до перезапуска; перезапуск источника её не трогает.
      expect(storage.comms.followers[source.id]?.[fan.id]?.["b"]).toBe(true)
      restartMachine(ms)
      expect(storage.comms.followers[source.id]?.[fan.id]?.["b"]).toBe(true)
      restartMachine(mf)
      expect(storage.comms.followers[source.id]).toBe(undefined)
      cleanup(source, fan)
    })
  })

  test("robot(): по id и имени своей команды; неизвестный — null; send неизвестному — invalid-target", (t) => {
    const a = robotNamed("искатель")
    const b = robotNamed("найдёныш")
    const m = start(a, `const r = robot("найдёныш")!
print(r.name, robot(r.id)!.name, robot("никто") === null)
try { send("никто", "x") } catch (e) { print(e instanceof ActionError ? e.code : "?") }`)
    waitUntil(t, "конца программы", finished(m), 120, () => {
      expect(output(m)).toBe("найдёныш найдёныш true|invalid-target")
      cleanup(a, b)
    })
  })

  test("без «Радиосвязи» — not-researched", (t) => {
    const a = robotNamed("немой")
    game.forces.player.technologies[TECH.radio].researched = false
    const m = start(a, `try { send(me.id, "x") } catch (e) { print(e instanceof ActionError ? e.code : "?") }
try { board.get("x") } catch (e) { print(e instanceof ActionError ? e.code : "?") }`)
    waitUntil(t, "конца программы", finished(m), 120, () => {
      game.forces.player.technologies[TECH.radio].researched = true
      expect(output(m)).toBe("not-researched|not-researched")
      cleanup(a)
    })
  })
})

describe("доска и задачи", () => {
  test("board: set/get копируют, increment атомарен, compareAndSet, keys по префиксу", (t) => {
    const robots = [robotNamed("счётчик-1"), robotNamed("счётчик-2"), robotNamed("счётчик-3")]
    const counters = robots.map((r) => start(r, `for (let i = 0; i < 10; i++) { board.increment("тест/счёт"); wait(0.05) }`))
    waitUntil(t, "счётчиков", finished(...counters), 300, () => {
      const checker = robotNamed("проверка")
      const m = start(checker, `print(board.get("тест/счёт"))
const v = { a: [1, 2] }
board.set("тест/объект", v)
v.a.push(3)
print(board.get<{ a: number[] }>("тест/объект")!.a.length)
print(board.compareAndSet("тест/объект", { a: [1, 2] }, "новое"), board.compareAndSet("тест/объект", "старое", "x"), board.get("тест/объект"))
print(board.keys("тест/").join(","))
board.delete("тест/объект")
print(board.get("тест/объект"))`)
      waitUntil(t, "проверки", finished(m), 120, () => {
        expect(output(m)).toBe("30|2|true false новое|тест/объект,тест/счёт|undefined")
        cleanup(...robots, checker)
      })
    })
  })

  test("claim: захватить может одна машина; release освобождает; ttl истекает", (t) => {
    const a = robotNamed("захватчик")
    const b = robotNamed("второй")
    const ma = start(a, `print(board.claim("печь-1", 0.5))
wait(0.2)
board.release("печь-1")
print(board.claim("печь-2", 0.3))`)
    const mb = start(b, `wait(0.1)
print(board.claim("печь-1"))
wait(0.2)
print(board.claim("печь-1"))
wait(0.5)
print(board.claim("печь-2"))`)
    waitUntil(t, "конца программ", finished(ma, mb), 300, () => {
      expect(output(ma)).toBe("true|true")
      expect(output(mb)).toBe("false|true|true")
      cleanup(a, b)
    })
  })

  test("tasks: по приоритету; брошенная задача возвращается после аренды; ждущий получает новую", (t) => {
    const boss = robotNamed("диспетчер")
    const quitter = robotNamed("бросивший")
    const worker = robotNamed("работник")
    const mq = start(quitter, `const task = tasks.next<string>("работа", { lease: 1 })!
print(task.data)`)
    const mw = start(worker, `wait(0.5)
const got: string[] = []
for (let i = 0; i < 3; i++) {
  const task = tasks.next<string>("работа", { timeout: 5 })!
  got.push(task.data)
  task.done()
}
print(got.join(","), tasks.size("работа"))`)
    const mb = start(boss, `wait(0.1)
tasks.push("работа", "обычная")
tasks.push("работа", "срочная", { priority: 10 })
tasks.push("работа", "вторая обычная")
print(tasks.size("работа"))`)
    waitUntil(t, "конца программ", finished(mq, mw, mb), 900, () => {
      // Бросивший ждал первым — ему первая же поставленная; работник берёт по приоритету,
      // а брошенную — когда истекла аренда.
      expect(output(mb)).toBe("2")
      expect(output(mq)).toBe("обычная")
      expect(output(mw)).toBe("срочная,вторая обычная,обычная 0")
      cleanup(boss, quitter, worker)
    })
  })
})
