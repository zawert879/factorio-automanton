// Проверка сохранения/загрузки посреди работы (npm run test:desync).
// Сценарий на карте: машины ставятся, одна копает руду, одна гибнет, одну подбирает персонаж, остальные уезжают далеко —
// сохранение на тике 300 застаёт их в пути; после него подобранную ставят обратно из предмета и ставят новую. На тике DUMP_TICK — снимок storage в
// script-output/automaton-state.txt. Состояние сценария нигде не хранится: всё ищется на карте.
// Подключается из control.ts, только когда включён служебный мод automaton-desync-test.
import { LuaEntity, LuaInventory, LuaRenderObject } from "factorio:runtime"
import { startAction } from "../automaton/actions"
import { moveRobot } from "../automaton/movement"
import { replacePlacer } from "../automaton/placement"
import { findRobot, tagFromInventory, tagMinedRobot } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { assignProgram } from "../program/machines"
import { publishProgram } from "../program/store"

/** Программа держит в кадрах всё сразу: класс, Map, замыкание, try/finally через паузу, случайные числа. */
const BUSY_PROGRAM = `class Counter { n = 0; inc() { this.n++; return this.n } }
const c = new Counter()
const seen = new Map<string, number>()
let total = 0
const bump = (x: number) => { total += x }
while (true) {
  const r = Math.floor(Math.random() * 100)
  seen.set("k" + (c.inc() % 5), r)
  try { bump(r); wait(0.1) } finally { total += 1 }
  if (c.n % 10 === 0) print(total, [...seen.keys()].join(","))
}`

const MINER_PROGRAM = `while (true) { mine("iron-ore", 3); wait(0.5) }`

/** Жидкости (этап 7): набрать воду, залить в резервуар; второй — нефть с месторождения. */
const WATER_PROGRAM = `const tank = scan.entities({ name: "storage-tank" })[0]
while (true) { pump("water", 300); fill(tank); wait(0.2) }`
const OIL_PROGRAM = `while (true) { pump("crude-oil", 30); print(Math.round(me.tank!.amount)) }`

const DUMP_TICK = 600 // как в tools/test/desync.mjs

function nauvis() {
  return game.get_surface("nauvis")!
}

function placeAt(near: { x: number; y: number }): void {
  const position = nauvis().find_non_colliding_position(WORKER_MK1, near, 20, 0.5)!
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
}

function workers(): LuaEntity[] {
  return nauvis()
    .find_entities_filtered({ name: WORKER_MK1 })
    .sort((a, b) => a.unit_number! - b.unit_number!)
}

const steps: Record<number, () => void> = {
  60: () => {
    for (let i = 0; i < 4; i++) placeAt({ x: 40 + i * 3, y: 40 })
  },
  // Шахтёр копает до и после сохранения (действие, его таймеры и генератор случайных чисел).
  70: () => {
    nauvis().create_entity({ name: "iron-ore", position: { x: 70.5, y: 40.5 }, amount: 1000 })
    placeAt({ x: 68.5, y: 40.5 })
    const miner = workers().find((w) => w.position.x > 65)!
    startAction(findRobot(miner)!, "mine", { item: "iron-ore", count: 50 })
  },
  // Программы (этап 4): исполняются до и после сохранения на тике 300.
  80: () => {
    placeAt({ x: 90, y: 40 })
    nauvis().create_entity({ name: "iron-ore", position: { x: 100.5, y: 60.5 }, amount: 1000 })
    placeAt({ x: 98.5, y: 60.5 })
    const busy = publishProgram("занятая", BUSY_PROGRAM)
    const miner = publishProgram("шахтёр", MINER_PROGRAM)
    if (!busy.ok || !miner.ok) error("программы сценария не компилируются")
    for (const worker of workers()) {
      if (worker.position.x > 85 && worker.position.y < 50) assignProgram(findRobot(worker)!, busy.program)
      if (worker.position.x > 95 && worker.position.y > 55) assignProgram(findRobot(worker)!, miner.program)
    }
  },
  90: () => {
    const tiles = []
    for (let x = 120; x < 124; x++) for (let y = 40; y < 50; y++) tiles.push({ name: "water", position: { x, y } })
    nauvis().set_tiles(tiles)
    nauvis().create_entity({ name: "storage-tank", position: { x: 114.5, y: 45.5 }, force: "player" })
    nauvis().create_entity({ name: "crude-oil", position: { x: 130.5, y: 60.5 }, amount: 300000 })
    const water = publishProgram("водовоз", WATER_PROGRAM)
    const oil = publishProgram("нефть", OIL_PROGRAM)
    if (!water.ok || !oil.ok) error("программы жидкостей не компилируются")
    placeAt({ x: 118.5, y: 45.5 })
    placeAt({ x: 128.5, y: 60.5 })
    for (const worker of workers()) {
      if (math.abs(worker.position.x - 118.5) < 2 && math.abs(worker.position.y - 45.5) < 2) assignProgram(findRobot(worker)!, water.program)
      if (math.abs(worker.position.x - 128.5) < 2 && math.abs(worker.position.y - 60.5) < 2) assignProgram(findRobot(worker)!, oil.program)
    }
  },
  120: () => workers()[0].die(),
  200: () => {
    const target = workers()[0]
    const position = nauvis().find_non_colliding_position("character", target.position, 10, 0.5)!
    // Как подбор игроком: предмет в инвентаре персонажа получает тег машины, машина исчезает.
    const inventory = nauvis().create_entity({ name: "character", position, force: "player" })!.get_main_inventory()!
    inventory.insert({ name: WORKER_MK1, count: 1 })
    tagMinedRobot(target, inventory)
    target.destroy()
  },
  // Поездки, которые сохранение на тике 300 застанет в пути.
  250: () => {
    for (const worker of workers()) if (worker.position.x < 65) moveRobot(findRobot(worker)!, { position: { x: 45, y: 90 } })
  },
  400: () => {
    const character = nauvis().find_entities_filtered({ name: "character" })[0]
    const position = nauvis().find_non_colliding_position(WORKER_MK1, { x: 40, y: 50 }, 20, 0.5)!
    const placer = nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player" })!
    replacePlacer(placer, tagFromInventory(character.get_main_inventory()))
    character.get_main_inventory()!.remove({ name: WORKER_MK1, count: 1 })
  },
  450: () => placeAt({ x: 50, y: 50 }),
}

/**
 * Объекты игры serpent печатает с адресами памяти — заменяем их стабильным описанием.
 * Общие таблицы и циклы (класс → окружение методов → класс) печатаются один раз, дальше — «<ссылка>».
 */
function stable(value: unknown, seen: LuaSet<object> = new LuaSet()): unknown {
  if (type(value) === "userdata") {
    const object = value as { valid: boolean; object_name: string }
    if (!object.valid) return `<${object.object_name}: недействителен>`
    if (object.object_name === "LuaEntity") {
      const e = value as LuaEntity
      return `<LuaEntity ${e.name} #${e.unit_number} (${e.position.x}, ${e.position.y})>`
    }
    if (object.object_name === "LuaRenderObject") return `<LuaRenderObject #${(value as LuaRenderObject).id}>`
    if (object.object_name === "LuaInventory") return `<LuaInventory ${serpent.line((value as LuaInventory).get_contents())}>`
    return `<${object.object_name}>`
  }
  if (type(value) !== "table") return value
  if (seen.has(value as object)) return "<ссылка>"
  seen.add(value as object)
  const copy: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) copy[key] = stable(item, seen)
  return copy
}

script.on_nth_tick(1, (event) => {
  steps[event.tick]?.()
  if (event.tick !== DUMP_TICK) return
  const snapshot = serpent.block(stable(storage), { sortkeys: true, comment: false })
  helpers.write_file("automaton-state.txt", `tick ${event.tick}\n${snapshot}\n`, false)
})
