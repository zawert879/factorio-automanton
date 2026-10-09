// Программы-примеры (examples/*.ts), собранные схемами (этап 15): те же параметры, метки и зоны, что у кода, —
// для снимков мастерской и проверки, что схемой можно сделать то же, что кодом. Сложные примеры проще кода:
// перевозчик — одна линия вместо списка маршрутов, оркестратор и рабочие — очередь задач вместо писем и Map.
// Параметр машины поставлен у каждого узла, которому нужен, — короткие провода (в коде это одна константа).
import { GraphBuilder } from "./builder"
import { Graph, GraphNode, GraphValue } from "./model"

export interface GraphSample {
  /** Имя программы — как у примера-кода. */
  name: string
  /** Что делает (для подписи снимка). */
  about: string
  graph: Graph
}

function param(b: GraphBuilder, name: string, type: string, fallback: GraphValue): GraphNode {
  return b.node("param", { name, type, default: fallback })
}

/** «если A < x»: сравнение выхода узла с числом. */
function below(b: GraphBuilder, source: GraphNode, limit: number, op = "<"): GraphNode {
  const compare = b.node("compare", { op, b: limit })
  b.data(source, compare, "a")
  return compare
}

/** Шахтёр: копает руду у месторождения и возит в сундук у метки; заправляется углём, если везёт уголь. */
function miner(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const label = b.node("set-label")
  const text = b.node("join", { a: "копаю " })
  const loop = b.node("forever")
  const move = b.node("move")
  const patch = b.node("nearest-patch")
  const mine = b.node("mine")
  const both = b.node("and")
  const cond = b.node("if")
  const refuel = b.node("refuel", { item: "coal" })
  const chest = b.node("chest-at")
  const attempt = b.node("try")
  const put = b.node("put")
  const say = b.node("say", { text: "Сундук полон — жду", seconds: 10 })
  const wait = b.node("wait", { seconds: 10 })
  b.seq(start, label, loop)
  b.exec(loop, move, "body").seq(move, mine, cond)
  b.exec(cond, refuel, "then").exec(cond, chest, "else").exec(refuel, chest).exec(chest, attempt)
  b.exec(attempt, put, "body").exec(attempt, say, "catch").exec(say, wait)
  b.data(param(b, "ore", "item", "coal"), text, "b").data(text, label, "text")
  b.data(param(b, "ore", "item", "coal"), patch, "item").data(patch, move, "to")
  b.data(param(b, "ore", "item", "coal"), mine, "item")
  b.data(below(b, b.node("me-fuel"), 0.5), both, "a").data(below(b, b.node("me-cargo-count", { item: "coal" }), 0, ">"), both, "b").data(both, cond, "cond")
  b.data(param(b, "depot", "marker", "склад"), chest, "marker").data(chest, put, "into").data(param(b, "ore", "item", "coal"), put, "item")
  return b.layout()
}

/** Копатель: как шахтёр, но с запасом угля у метки «уголь» — заправка в своей функции. */
function digger(): Graph {
  const b = new GraphBuilder()
  // Функция «заправка»: топлива мало — взять уголь у метки (если в грузе нет) и заправиться.
  const fn = b.node("function", { name: "заправка", params: "склад: marker", returns: "none" })
  const low = b.node("if")
  const noCoal = b.node("if")
  const chest = b.node("chest-at")
  const attempt = b.node("try")
  const take = b.node("take", { item: "coal", count: 10 })
  const hasCoal = b.node("if")
  const refuel = b.node("refuel", { item: "coal" })
  b.exec(fn, low).exec(low, noCoal, "then").exec(noCoal, chest, "then").exec(noCoal, hasCoal, "else").exec(chest, attempt)
  b.exec(attempt, take, "body").exec(attempt, hasCoal).exec(hasCoal, refuel, "then")
  b.data(below(b, b.node("me-fuel"), 0.3), low, "cond")
  b.data(below(b, b.node("me-cargo-count", { item: "coal" }), 0, "==="), noCoal, "cond")
  b.data(fn, chest, "marker", "склад").data(chest, take, "from")
  b.data(below(b, b.node("me-cargo-count", { item: "coal" }), 0, ">"), hasCoal, "cond")

  const start = b.node("start")
  const label = b.node("set-label")
  const text = b.node("join", { a: "копаю " })
  const loop = b.node("forever")
  const fuel1 = b.node("call", { name: "заправка" })
  const move = b.node("move")
  const patch = b.node("nearest-patch")
  const dig = b.node("try")
  const mine = b.node("mine", { count: 40 })
  const fuel2 = b.node("call", { name: "заправка" })
  const depot = b.node("chest-at")
  const store = b.node("try")
  const put = b.node("put")
  const say = b.node("say", { text: "Сундук полон — жду", seconds: 10 })
  const wait = b.node("wait", { seconds: 10 })
  b.seq(start, label, loop).exec(loop, fuel1, "body").seq(fuel1, move, dig)
  b.exec(dig, mine, "body").exec(dig, fuel2).seq(fuel2, depot, store)
  b.exec(store, put, "body").exec(store, say, "catch").exec(say, wait)
  b.data(param(b, "ore", "item", "iron-ore"), text, "b").data(text, label, "text")
  b.data(param(b, "coal", "marker", "уголь"), fuel1, "склад").data(param(b, "coal", "marker", "уголь"), fuel2, "склад")
  b.data(param(b, "ore", "item", "iron-ore"), patch, "item").data(patch, move, "to").data(param(b, "ore", "item", "iron-ore"), mine, "item")
  b.data(param(b, "depot", "marker", "склад"), depot, "marker").data(depot, put, "into").data(param(b, "ore", "item", "iron-ore"), put, "item")
  return b.layout()
}

/** Печник: руду и уголь — со склада, по печам зоны; плиты — в сундук у метки «плиты». */
function smelter(): Graph {
  const b = new GraphBuilder()
  const furnaces = () => {
    const find = b.node("find-in-zone", { what: "furnace", by: "type" })
    b.data(param(b, "zone", "zone", "плавильня"), find, "zone")
    return find
  }
  const start = b.node("start")
  const loop = b.node("forever")
  const none = b.node("if")
  const empty = b.node("list-empty")
  const alert = b.node("alert", { text: "в зоне нет печей" })
  const stop = b.node("stop")
  const source = b.node("chest-at")
  const fuelIf = b.node("if")
  const fuelTry = b.node("try")
  const takeFuel = b.node("take", { item: "coal", count: 5 })
  const refuel = b.node("refuel", { item: "coal" })
  const oreTry = b.node("try")
  const takeOre = b.node("take")
  const oreNeed = b.node("math", { op: "*", b: 10 })
  const oreLen = b.node("list-length")
  const coalTry = b.node("try")
  const takeCoal = b.node("take", { item: "coal" })
  const coalNeed = b.node("math", { op: "*", b: 2 })
  const coalLen = b.node("list-length")
  const each = b.node("foreach")
  const go = b.node("move")
  const plateTry = b.node("try")
  const takePlate = b.node("take")
  const coalIn = b.node("try")
  const putCoal = b.node("put", { item: "coal", count: 2 })
  const oreIn = b.node("try")
  const putOre = b.node("put", { count: 10 })
  const target = b.node("chest-at")
  const outTry = b.node("try")
  const putPlates = b.node("put")
  b.seq(start, loop).exec(loop, none, "body").exec(none, alert, "then").exec(alert, stop).exec(none, source, "else")
  b.data(furnaces(), empty, "list").data(empty, none, "cond")
  b.exec(source, fuelIf).exec(fuelIf, fuelTry, "then").exec(fuelIf, oreTry, "else").exec(fuelTry, takeFuel, "body").exec(fuelTry, refuel).exec(refuel, oreTry)
  b.data(below(b, b.node("me-fuel"), 0.5), fuelIf, "cond")
  b.data(param(b, "from", "marker", "склад"), source, "marker").data(source, takeFuel, "from")
  b.exec(oreTry, takeOre, "body").exec(oreTry, coalTry).exec(coalTry, takeCoal, "body").exec(coalTry, each)
  b.data(source, takeOre, "from").data(param(b, "ore", "item", "iron-ore"), takeOre, "item").data(furnaces(), oreLen, "list").data(oreLen, oreNeed, "a").data(oreNeed, takeOre, "count")
  b.data(source, takeCoal, "from").data(furnaces(), coalLen, "list").data(coalLen, coalNeed, "a").data(coalNeed, takeCoal, "count")
  b.data(furnaces(), each, "list").exec(each, go, "body").seq(go, plateTry).exec(plateTry, takePlate, "body").exec(plateTry, coalIn)
  b.exec(coalIn, putCoal, "body").exec(coalIn, oreIn).exec(oreIn, putOre, "body")
  b.data(each, go, "to", "element").data(each, takePlate, "from", "element").data(param(b, "plate", "item", "iron-plate"), takePlate, "item")
  b.data(each, putCoal, "into", "element").data(each, putOre, "into", "element").data(param(b, "ore", "item", "iron-ore"), putOre, "item")
  b.exec(each, target).exec(target, outTry).exec(outTry, putPlates, "body")
  b.data(param(b, "to", "marker", "плиты"), target, "marker").data(target, putPlates, "into").data(param(b, "plate", "item", "iron-plate"), putPlates, "item")
  return b.layout()
}

/** Водовоз: набирает воду у берега (где стоял при запуске) и заливает в резервуары и котлы у метки. */
function water(): Graph {
  const b = new GraphBuilder()
  const shore = b.node("variable", { name: "берег", type: "position", initial: "" })
  const start = b.node("start")
  const label = b.node("set-label", { text: "вода" })
  const remember = b.node("variable-set", { name: "берег" })
  const loop = b.node("forever")
  const toShore = b.node("move", { radius: 2 })
  const pump = b.node("pump", { fluid: "water" })
  const toTarget = b.node("move", { radius: 2 })
  const fuelIf = b.node("if")
  const fuelTry = b.node("try")
  const take = b.node("take", { item: "coal", count: 10 })
  const refuel = b.node("refuel", { item: "coal" })
  const tanks = b.node("foreach")
  const tankTry = b.node("try")
  const fillTank = b.node("fill")
  const boilers = b.node("foreach")
  const boilerTry = b.node("try")
  const fillBoiler = b.node("fill")
  void shore
  b.seq(start, label, remember, loop).exec(loop, toShore, "body").seq(toShore, pump, toTarget, fuelIf)
  b.data(b.node("me-position"), remember, "value").data(b.node("variable-get", { name: "берег" }), toShore, "to")
  b.data(param(b, "target", "marker", "котельная"), toTarget, "to")
  b.exec(fuelIf, fuelTry, "then").exec(fuelIf, tanks, "else").exec(fuelTry, take, "body").exec(fuelTry, refuel).exec(refuel, tanks)
  b.data(below(b, b.node("me-fuel"), 0.3), fuelIf, "cond").data(b.node("nearest-entity", { type: "container" }), take, "from")
  b.data(b.node("entities-near", { type: "storage-tank", radius: 8 }), tanks, "list").exec(tanks, tankTry, "body").exec(tankTry, fillTank, "body")
  b.data(tanks, fillTank, "into", "element")
  b.exec(tanks, boilers).data(b.node("entities-near", { type: "boiler", radius: 8 }), boilers, "list").exec(boilers, boilerTry, "body").exec(boilerTry, fillBoiler, "body")
  b.data(boilers, fillBoiler, "into", "element")
  return b.layout()
}

/** Перевозчик: берёт предмет из сундука у метки и развозит по сборщикам зоны (до keep штук в каждый). */
function hauler(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const label = b.node("set-label", { text: "перевозчик" })
  const loop = b.node("forever")
  const need = b.node("if")
  const chest = b.node("chest-at")
  const takeTry = b.node("try")
  const take = b.node("take", { count: 50 })
  const each = b.node("foreach")
  const find = b.node("find-in-zone", { what: "assembling-machine", by: "type" })
  const go = b.node("move")
  const low = b.node("if")
  const count = b.node("entity-count")
  const compare = b.node("compare", { op: "<" })
  const putTry = b.node("try")
  const put = b.node("put", { count: 10 })
  const wait = b.node("wait", { seconds: 1 })
  b.seq(start, label, loop).exec(loop, need, "body").exec(need, chest, "then").exec(need, each, "else").exec(chest, takeTry).exec(takeTry, take, "body").exec(takeTry, each)
  const cargo = b.node("me-cargo-count")
  b.data(param(b, "item", "item", "iron-plate"), cargo, "item").data(below(b, cargo, 50), need, "cond")
  b.data(param(b, "from", "marker", "плиты"), chest, "marker").data(chest, take, "from").data(param(b, "item", "item", "iron-plate"), take, "item")
  b.data(param(b, "to", "zone", "сборка"), find, "zone").data(find, each, "list").exec(each, go, "body").exec(go, low).exec(low, putTry, "then").exec(putTry, put, "body")
  b.data(each, go, "to", "element").data(each, count, "entity", "element").data(param(b, "item", "item", "iron-plate"), count, "item")
  b.data(count, compare, "a").data(param(b, "keep", "number", 20), compare, "b").data(compare, low, "cond")
  b.data(each, put, "into", "element").data(param(b, "item", "item", "iron-plate"), put, "item")
  b.exec(each, wait)
  return b.layout()
}

/** Хранитель: отвечает, сколько предмета в сундуке рядом (запрос «сколько» от других машин). */
function keeper(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const label = b.node("set-label", { text: "склад" })
  const loop = b.node("forever")
  const receive = b.node("receive", { topic: "сколько" })
  const got = b.node("if")
  const reply = b.node("reply")
  const count = b.node("entity-count")
  const asItem = b.node("as", { type: "item" })
  const exists = b.node("exists")
  b.seq(start, label, loop).exec(loop, receive, "body").seq(receive, got).exec(got, reply, "then")
  b.data(receive, exists, "value", "message").data(exists, got, "cond")
  b.data(receive, reply, "message", "message").data(b.node("nearest-entity", { type: "container" }), count, "entity")
  b.data(receive, b.node("message-data"), "message", "message")
  const data = b.graph.nodes[b.graph.nodes.length - 1]
  b.data(data, asItem, "value").data(asItem, count, "item").data(count, reply, "data")
  return b.layout()
}

/** Оркестратор: голодные печи зоны — задачи «руда» в очередь (печь занята, пока задача не сделана). */
function orchestrator(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const go = b.node("move")
  const register = b.node("board-set", { key: "оркестратор" })
  const loop = b.node("forever")
  const each = b.node("foreach")
  const find = b.node("find-in-zone", { what: "furnace", by: "type" })
  const hungry = b.node("if")
  const count = b.node("entity-count")
  const claim = b.node("board-claim", { ttl: 120 })
  const key = b.node("join", { a: "печь " })
  const id = b.node("entity-id")
  const claimed = b.node("if")
  const push = b.node("tasks-push", { queue: "руда" })
  const showTry = b.node("try")
  const show = b.node("display-text", { x: 4, y: 4 })
  const text = b.node("join", { a: "задач в очереди: " })
  const size = b.node("tasks-size", { queue: "руда" })
  const wait = b.node("wait", { seconds: 2 })
  b.seq(start, go, register, loop).exec(loop, each, "body").exec(each, hungry, "body").exec(hungry, claim, "then").exec(claim, claimed).exec(claimed, push, "then")
  b.data(param(b, "zone", "zone", "плавильня"), go, "to").data(b.node("me-id"), register, "value")
  b.data(param(b, "zone", "zone", "плавильня"), find, "zone").data(find, each, "list")
  b.data(each, count, "entity", "element").data(param(b, "ore", "item", "iron-ore"), count, "item").data(below(b, count, 10), hungry, "cond")
  b.data(each, id, "entity", "element").data(id, key, "b").data(key, claim, "key").data(claim, claimed, "cond", "result")
  b.data(each, push, "data", "element")
  b.exec(each, showTry).exec(showTry, show, "body").exec(showTry, wait)
  b.data(param(b, "display", "string", "штаб"), show, "name").data(size, text, "b").data(text, show, "text")
  return b.layout()
}

/** Рабочий: берёт задачу из очереди «руда», копает руду в зоне-поле и кладёт в печь из задачи. */
function worker(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const label = b.node("set-label", { text: "рабочий" })
  const loop = b.node("forever")
  const next = b.node("tasks-next", { queue: "руда", timeout: 30 })
  const got = b.node("if")
  const exists = b.node("exists")
  const work = b.node("try")
  const toField = b.node("move")
  const mine = b.node("mine")
  const toFurnace = b.node("move")
  const put = b.node("put")
  const say = b.node("say")
  const why = b.node("join", { a: "Не вышло: " })
  const done = b.node("task-done")
  const release = b.node("board-release")
  const key = b.node("join", { a: "печь " })
  const id = b.node("entity-id")
  const furnace = () => {
    const data = b.node("task-data")
    const cast = b.node("as", { type: "entity" })
    b.data(next, data, "task", "task").data(data, cast, "value")
    return cast
  }
  b.seq(start, label, loop).exec(loop, next, "body").seq(next, got).exec(got, work, "then")
  b.data(next, exists, "value", "task").data(exists, got, "cond")
  b.exec(work, toField, "body").seq(toField, mine, toFurnace, put).exec(work, say, "catch").exec(work, done).exec(done, release)
  b.data(param(b, "field", "zone", "поле"), toField, "to").data(param(b, "ore", "item", "iron-ore"), mine, "item").data(param(b, "amount", "number", 50), mine, "count")
  b.data(furnace(), toFurnace, "to").data(furnace(), put, "into").data(param(b, "ore", "item", "iron-ore"), put, "item")
  b.data(work, why, "b", "code").data(why, say, "text")
  b.data(next, done, "task", "task").data(furnace(), id, "entity").data(id, key, "b").data(key, release, "key")
  return b.layout()
}

/** Патруль: объезжает посты; мало патронов — в арсенал; сильно повреждена — зовёт ремонт и ждёт дома. */
function patrol(): Graph {
  const b = new GraphBuilder()
  const start = b.node("start")
  const loop = b.node("forever")
  const ammoIf = b.node("if")
  const arsenal = () => {
    const first = b.node("list-first")
    const find = b.node("find-in-zone", { what: "container", by: "type" })
    b.data(param(b, "arsenal", "zone", "арсенал"), find, "zone").data(find, first, "list")
    return first
  }
  const go = b.node("move")
  const take = b.node("take", { count: 50 })
  const reload = b.node("reload")
  const round = b.node("patrol")
  const points = b.node("markers")
  const either = b.node("or")
  const hurt = b.node("if")
  const call = b.node("publish", { topic: "нужен-ремонт" })
  const home = b.node("go-home")
  const heal = b.node("wait-until", { every: 2 })
  b.seq(start, loop).exec(loop, ammoIf, "body").exec(ammoIf, go, "then").exec(ammoIf, round, "else").seq(go, take, reload, round).exec(round, hurt)
  b.exec(hurt, call, "then").seq(call, home, heal)
  b.data(below(b, b.node("me-ammo"), 20), ammoIf, "cond").data(arsenal(), go, "to").data(arsenal(), take, "from").data(param(b, "ammo", "item", "firearm-magazine"), take, "item")
  b.data(param(b, "posts", "string", "пост-1,пост-2,пост-3"), points, "names").data(points, round, "points")
  b.data(below(b, b.node("me-ammo"), 20), either, "a").data(below(b, b.node("me-health"), 0.4), either, "b").data(either, round, "until")
  b.data(below(b, b.node("me-health"), 0.4), hurt, "cond").data(b.node("me-id"), call, "data").data(below(b, b.node("me-health"), 0.9, ">"), heal, "cond")
  return b.layout()
}

export function graphSamples(): GraphSample[] {
  return [
    { name: "Шахтёр", about: "копает руду и возит в сундук у метки «склад»", graph: miner() },
    { name: "Копатель", about: "как шахтёр, заправка — своей функцией, уголь у метки «уголь»", graph: digger() },
    { name: "Печник", about: "руда и уголь со склада — по печам зоны, плиты — к метке «плиты»", graph: smelter() },
    { name: "Водовоз", about: "вода от берега — в резервуары и котлы у метки «котельная»", graph: water() },
    { name: "Перевозчик", about: "плиты от метки — по сборщикам зоны «сборка»", graph: hauler() },
    { name: "Хранитель", about: "отвечает другим машинам, сколько предмета в сундуке", graph: keeper() },
    { name: "Оркестратор", about: "голодные печи — задачи в очередь «руда»", graph: orchestrator() },
    { name: "Рабочий", about: "берёт задачу, копает руду, несёт в печь", graph: worker() },
    { name: "Патруль", about: "объезжает посты, пополняет патроны, зовёт ремонт", graph: patrol() },
  ]
}
