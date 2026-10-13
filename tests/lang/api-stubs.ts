// Заглушки API машины (docs/API.md) для прогона примеров вне игры: правдоподобные значения,
// блокирующие вызовы завершаются через тик. Дополняют заглушки tests/lang/harness.ts (он загружается первым).
import "./harness"
import {
  blockingCall,
  defineHostObject,
  host,
  hostBlocking,
  hostGetters,
  hostKindClass,
  hostMethods,
  hostSetters,
  program,
  Val,
} from "../../src/lang/runtime/core"

export const log: string[] = []

/** Массив программы из значений. */
function arr(...items: Val[]): Val {
  const count = select("#", ...items)
  const result: Val = { __n: count }
  for (let i = 1; i <= count; i++) result[i] = select(i, ...items)[0]
  return result
}

function hostObject(kind: string, fields: Val): Val {
  fields.__t = "host"
  fields.__h = kind
  return fields
}

let nextId = 100

/** Класс здания по части имени (19.2): печь — Furnace, сундук — Chest, …, остальное — Building. */
const CLASS_BY_NAME: [string, string][] = [
  ["furnace", "Furnace"],
  ["chest", "Chest"],
  ["storage-tank", "StorageTank"],
  ["boiler", "Boiler"],
  ["assembling", "Assembler"],
  ["lab", "Lab"],
]

function entity(id: number, name: string, x: number, y: number): Val {
  let cls = "Building"
  for (const [part, c] of CLASS_BY_NAME) if (string.find(name, part, 1, true)[0] !== undefined) cls = c
  return hostObject("entity", { __c: cls, __id: id, __name: name, __x: x, __y: y })
}

/** Пример здания класса kind (для scan.buildings и zone.find); без класса — печь. */
function sampleOf(kind: Val, x: number, y: number): Val {
  const cls = type(kind) === "table" ? (kind.__builtin as string) : "Furnace"
  for (const [part, c] of CLASS_BY_NAME) if (c === cls) return entity(nextId++, part === "chest" ? "steel-chest" : part === "furnace" ? "stone-furnace" : part, x, y)
  return entity(nextId++, "stone-furnace", x, y)
}

function robot(id: number, name: string, programName: string): Val {
  return hostObject("robot", { __id: id, __name: name, __program: programName })
}

function message(topic: string, data: Val, from: Val): Val {
  return hostObject("message", { __topic: topic, __data: data, __from: from })
}


// Здания — таблицы класса Building (как в игре, src/program/handles.ts): подклассы их наследуют.
hostKindClass.entity = "Building"
hostKindClass.robot = "Robot"
hostGetters.entity = hostGetters.Building
hostMethods.entity = hostMethods.Building
hostGetters.entity.id = (o: Val) => o.__id
hostGetters.entity.name = (o: Val) => o.__name
hostGetters.entity.valid = () => true
hostGetters.entity.position = (o: Val) => ({ x: o.__x, y: o.__y })
hostMethods.entity.count = () => 5
// Деревья, скалы и призраки — обёртки сущностей своих классов (не здания): общие свойства — те же.
for (const cls of ["Tree", "Rock", "Ghost"]) for (const key of ["id", "name", "valid", "position"]) hostGetters[cls][key] = hostGetters.entity[key]
hostMethods.entity.output = () => inventory(arr({ name: "iron-plate", count: 4 }))

// Инвентарь (груз машины, выход печи): предметы заданы при создании, count — по ним.
defineHostObject("inventory")
hostMethods.inventory.count = (o: Val, _k: Val, item: Val) => {
  let total = 0
  for (let i = 1; i <= o.__items.__n; i++) if (item === undefined || o.__items[i].name === item) total += o.__items[i].count
  return total
}
hostMethods.inventory.items = (o: Val) => o.__items
hostMethods.inventory.free = () => 100
hostMethods.inventory.isEmpty = (o: Val) => o.__items.__n === 0
hostMethods.inventory.isFull = () => false

function inventory(items: Val): Val {
  return hostObject("inventory", { __items: items })
}

defineHostObject("robot")
hostGetters.robot.id = (o: Val) => o.__id
hostGetters.robot.name = (o: Val) => o.__name
hostGetters.robot.program = (o: Val) => o.__program

defineHostObject("message")
hostGetters.message.data = (o: Val) => o.__data
hostGetters.message.from = (o: Val) => o.__from
hostGetters.message.topic = (o: Val) => o.__topic
hostMethods.message.reply = (o: Val, _k: Val, data: Val) => log.push(`reply to ${o.__from.__name}: ${tostring(data)}`)

defineHostObject("zone")
hostGetters.zone.name = (o: Val) => o.__name
hostKindClass.zone = "Zone"
hostMethods.zone.find = (_o: Val, _k: Val, what: Val) => arr(sampleOf(what, 3, 3))

defineHostObject("screen")
hostGetters.screen.width = () => 128
hostGetters.screen.height = () => 64
hostMethods.screen.frame = (_o: Val, _k: Val, fn: Val) => program().calls(fn, undefined)
for (const name of ["clear", "text", "table", "bar", "rect", "line", "pixel"]) hostMethods.screen[name] = () => undefined

// me
let fuel = 1
const meFields: Record<string, (this: void) => Val> = {
  fuel: () => {
    fuel -= 0.1
    return fuel
  },
  position: () => ({ x: 0, y: 0 }),
  health: () => 1,
  reach: () => 10,
  mineReach: () => 2.7,
  vision: () => 20,
  label: () => "",
  home: () => ({ x: 0, y: 0 }),
  weapon: () => hostObject("weapon", {}),
  cargo: () => inventory(arr({ name: "iron-plate", count: 8 })),
  tank: () => hostObject("tank", {}),
  energy: () => hostObject("energy", {}),
  model: () => "worker-mk2",
}
for (const [name, fn] of Object.entries(meFields)) hostGetters.me[name] = fn
hostSetters.me.label = (_o: Val, v: Val) => log.push(`label ${tostring(v)}`)
hostMethods.me.args = () => ({ ore: "iron-ore", field: "north-iron" })
hostMethods.me.distance = () => 3
hostMethods.me.refuel = () => undefined
// Действия и системы своей машины (19.4) — как в игре (src/program/api/me.ts): те же функции API.
for (const name of ["move", "canReach", "follow", "goHome", "mine", "pickup", "drop", "build"]) {
  hostMethods.me[name] = (_o: Val, k: Val, ...args: Val[]) => host[name](k, ...args)
}
defineHostObject("energy")
hostGetters.energy.level = () => 0.5
for (const name of ["refuel", "charge"]) hostMethods.energy[name] = (_o: Val, k: Val, ...args: Val[]) => host[name](k, ...args)
defineHostObject("tank")
hostGetters.tank.fluid = () => "water"
hostGetters.tank.amount = () => 0
hostGetters.tank.capacity = () => 1000
hostMethods.tank.pump = (_o: Val, k: Val, ...args: Val[]) => host.pump(k, ...args)
defineHostObject("weapon")
hostGetters.weapon.type = () => "gun"
hostGetters.weapon.range = () => 15
hostGetters.weapon.ammo = () => ({ name: "firearm-magazine", count: 30 })
hostGetters.weapon.item = () => undefined
hostMethods.weapon.equip = () => undefined
hostMethods.weapon.unequip = () => undefined
defineHostObject("armor")
hostGetters.me.armor = () => hostObject("armor", {})
hostGetters.armor.item = () => undefined
hostGetters.armor.shield = () => 0
hostGetters.armor.maxShield = () => 0
hostMethods.armor.equip = () => undefined
hostMethods.armor.unequip = () => undefined
for (const name of ["reload", "attack", "guard", "patrol"]) hostMethods.weapon[name] = (_o: Val, k: Val, ...args: Val[]) => host[name](k, ...args)

// scan, map
defineHostObject("scan")
hostMethods.scan.enemies = () => arr()
hostMethods.scan.buildings = (_o: Val, _k: Val, filter: Val) => {
  const kind = type(filter) === "table" ? filter.kind : undefined
  return arr(sampleOf(kind, 5, 5), sampleOf(kind, 7, 5))
}
hostMethods.scan.robots = () => arr(robot(42, "boss", "Оркестратор"))
hostMethods.scan.resources = () =>
  arr({ item: "iron-ore", center: { x: 40, y: 70 }, nearest: { x: 35, y: 60 }, amount: 5000 }, { item: "coal", center: { x: 10, y: 20 }, nearest: { x: 8, y: 18 }, amount: 3000 })
hostMethods.scan.items = () => arr()
hostMethods.scan.ghosts = () => arr(hostObject("entity", { __c: "Ghost", __id: 900, __name: "stone-furnace", __x: 6, __y: 6 }))
hostGetters.Ghost.item = () => "stone-furnace"
hostMethods.Ghost.requests = () => arr()
for (const cls of ["Furnace", "Assembler", "RocketSilo", "Lab", "Beacon"]) {
  hostMethods[cls].modules = () => arr()
  hostMethods[cls].requests = () => arr({ name: "speed-module", count: 2 })
  hostMethods[cls].installModule = () => 2
  hostMethods[cls].removeModule = () => 0
}
hostMethods.scan.marked = () => arr(hostObject("entity", { __c: "Tree", __name: "tree-02", __x: 4, __y: 4 }), entity(nextId++, "wooden-chest", 6, 6))
hostMethods.scan.trees = () => arr(hostObject("entity", { __c: "Tree", __name: "tree-01", __x: 3, __y: 4 }))
hostMethods.scan.rocks = () => arr(hostObject("entity", { __c: "Rock", __name: "huge-rock", __x: 9, __y: 4 }))
hostMethods.scan.water = () => arr()
defineHostObject("map")
hostMethods.map.tag = () => undefined

// Сигналы, время и мир
defineHostObject("signals")
hostMethods.signals.read = () => 500
hostMethods.signals.readAll = () => ({})
hostMethods.signals.write = () => log.push("signals")
defineHostObject("time")
hostGetters.time.tick = () => 600
hostGetters.time.seconds = () => 10
hostGetters.time.daytime = () => 0.5
hostMethods.time.isNight = () => false
defineHostObject("world")
hostMethods.world.recipe = () => ({ ingredients: arr({ name: "iron-plate", count: 2 }), products: arr({ name: "iron-gear-wheel", count: 1 }), seconds: 0.5 })
hostMethods.world.item = () => ({ stackSize: 100, fuelValue: 0 })

// Доска и задачи
const boardValues: Record<string, Val> = {}
defineHostObject("board")
hostMethods.board.get = (_o: Val, _k: Val, key: Val) => boardValues[key]
hostMethods.board.set = (_o: Val, _k: Val, key: Val, value: Val) => {
  boardValues[key] = value
}
hostMethods.board.delete = (_o: Val, _k: Val, key: Val) => {
  boardValues[key] = undefined
}
hostMethods.board.increment = (_o: Val, _k: Val, key: Val, by: Val) => {
  boardValues[key] = (boardValues[key] ?? 0) + (by ?? 1)
  return boardValues[key]
}
hostMethods.board.claim = () => true
hostMethods.board.release = () => undefined
hostMethods.board.compareAndSet = () => true
hostMethods.board.keys = () => arr()
defineHostObject("task")
hostGetters.task.data = (o: Val) => o.__data
hostMethods.task.done = () => undefined
hostMethods.task.fail = () => undefined
defineHostObject("tasks")
hostMethods.tasks.push = () => undefined
hostMethods.tasks.size = () => 0
hostMethods.tasks.next = (_o: Val, k: Val) => {
  if (k !== undefined) return k.result
  return hostObject("task", { __data: { item: "iron-plate", to: "сборка" } })
}

// Функции API
const queues: Record<string, Val[]> = {}
function queue(topic: string): Val[] {
  queues[topic] = queues[topic] ?? [message(topic, "worker-1", robot(nextId++, "worker", "Рабочий"))]
  return queues[topic]
}

const nonBlocking: Record<string, (this: void, ...args: Val[]) => Val> = {
  alert: (text: Val) => log.push(`alert ${tostring(text)}`),
  chat: (text: Val) => log.push(`chat ${tostring(text)}`),
  send: () => true,
  publish: () => 1,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  tryReceive: (topic: Val) => queue(topic).shift(),
  display: () => hostObject("screen", {}),
  zone: (name: Val) => hostObject("zone", { __name: name }),
  marker: (name: Val) => entity(nextId++, `marker:${tostring(name)}`, 1, 1),
  find: () => arr(entity(nextId++, "steel-chest", 3, 3)),
  robot: (id: Val) => robot(id, "robot", ""),
  exit: () => undefined,
}
for (const [name, fn] of Object.entries(nonBlocking)) host[name] = fn

const blocking: Record<string, (this: void, ...args: Val[]) => Val> = {
  goHome: () => undefined,
  take: () => 10,
  pump: () => 1000,
  fill: () => 500,
  drain: () => 100,
  reload: () => undefined,
  attack: () => true,
  pickup: () => 2,
  drop: () => 1,
  refuel: () => undefined,
  charge: () => undefined,
  guard: () => undefined,
  canReach: () => true,
  patrol: () => undefined,
  request: () => 10,
  receive: (topic: Val) => {
    const data = topic === "задание" ? { furnace: entity(nextId++, "stone-furnace", 9, 9), ore: "iron-ore" } : "iron-ore"
    return message(topic, data, robot(nextId++, "asker", ""))
  },
  waitUntil: (condition: Val) => {
    program().calls(condition, undefined)
    return true
  },
}
for (const [name, fn] of Object.entries(blocking)) {
  hostBlocking[name] = true
  host[name] = (k: Val, ...args: Val[]) =>
    blockingCall(k, name, (frame) => {
      frame.ticks = 1
      frame.value = fn(...args)
    })
}

// Методы зданий и машин (19.3): ждут тик, результат — как у прежних функций.
const objectMethods: [string, string, (this: void, ...args: Val[]) => Val][] = [
  ["Building", "insert", () => 5],
  ["Building", "extract", () => 10],
  ["Building", "fill", () => 500],
  ["Building", "drain", () => 100],
  ["Building", "setRecipe", () => undefined],
  ["Building", "repair", () => undefined],
  ["Building", "rotate", () => undefined],
  ["Building", "deconstruct", () => undefined],
  ["robot", "insert", () => 5],
  ["robot", "refuel", () => undefined],
  ["robot", "repair", () => undefined],
]
for (const [cls, name, fn] of objectMethods) {
  hostMethods[cls][name] = (_o: Val, k: Val, ...args: Val[]) =>
    blockingCall(k, name, (frame) => {
      frame.ticks = 1
      frame.value = fn(...args)
    })
}

// radio (19.5) — как в игре (src/program/api/comms.ts): те же функции API.
defineHostObject("radio")
for (const name of ["send", "publish", "subscribe", "unsubscribe", "tryReceive"]) {
  hostMethods.radio[name] = (_o: Val, _k: Val, ...args: Val[]) => host[name](...args)
}
for (const name of ["receive", "request"]) hostMethods.radio[name] = (_o: Val, k: Val, ...args: Val[]) => host[name](k, ...args)
hostGetters.radio.inbox = () => hostObject("inbox", {})
