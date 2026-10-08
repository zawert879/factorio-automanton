// Заглушки API машины (docs/API.md) для прогона примеров вне игры: правдоподобные значения,
// блокирующие вызовы завершаются через тик. Дополняют заглушки tests/lang/harness.ts (он загружается первым).
import "./harness"
import {
  blockingCall,
  defineHostObject,
  host,
  hostBlocking,
  hostGetters,
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

function entity(id: number, name: string, x: number, y: number): Val {
  return hostObject("entity", { __id: id, __name: name, __x: x, __y: y })
}

function robot(id: number, name: string, programName: string): Val {
  return hostObject("robot", { __id: id, __name: name, __program: programName })
}

function message(topic: string, data: Val, from: Val): Val {
  return hostObject("message", { __topic: topic, __data: data, __from: from })
}

let nextId = 100

defineHostObject("entity")
hostGetters.entity.id = (o: Val) => o.__id
hostGetters.entity.name = (o: Val) => o.__name
hostGetters.entity.valid = () => true
hostGetters.entity.position = (o: Val) => ({ x: o.__x, y: o.__y })
hostMethods.entity.count = () => 5
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
  weapon: () => ({ ammo: { count: 30 } }),
  cargo: () => inventory(arr({ name: "iron-plate", count: 8 })),
  tank: () => ({ fluid: "water", amount: 0, capacity: 1000 }),
}
for (const [name, fn] of Object.entries(meFields)) hostGetters.me[name] = fn
hostSetters.me.label = (_o: Val, v: Val) => log.push(`label ${tostring(v)}`)
hostMethods.me.args = () => ({ ore: "iron-ore", field: "north-iron" })
hostMethods.me.distance = () => 3
hostMethods.me.refuel = () => undefined

// scan, map
defineHostObject("scan")
hostMethods.scan.enemies = () => arr()
hostMethods.scan.entities = () => arr(entity(1, "stone-furnace", 5, 5), entity(2, "stone-furnace", 7, 5))
hostMethods.scan.robots = () => arr(robot(42, "boss", "Оркестратор"))
hostMethods.scan.resources = () =>
  arr({ item: "iron-ore", center: { x: 40, y: 70 }, nearest: { x: 35, y: 60 }, amount: 5000 }, { item: "coal", center: { x: 10, y: 20 }, nearest: { x: 8, y: 18 }, amount: 3000 })
hostMethods.scan.items = () => arr()
hostMethods.scan.water = () => arr()
defineHostObject("map")
hostMethods.map.tag = () => undefined

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
  broadcast: () => 1,
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
  refuel: () => undefined,
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
