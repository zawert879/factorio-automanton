// Мастерская схем (этап 15): тело узла — простое здание (тёмная плита по клеткам), заголовок, подписи и значки
// рисует rendering; разъёмы — маленькие лампы без картинки (у лампы есть подключение проводов цепи), кружок или
// квадрат рисует rendering. Предметы — только для чертежей (вырезать и вставить, палитра); в игре их не сделать.
import { PrototypeData } from "factorio:common"
import { ItemPrototype, SimpleEntityWithOwnerPrototype, Sprite } from "factorio:prototype"
import { NODE_BODY_PREFIX, NODE_MAX_HEIGHT, NODE_MIN_HEIGHT, NODE_WIDTH, PIN_DATA, PIN_EXEC } from "../names"

declare const data: PrototypeData

const PLATE = { r: 0.22, g: 0.21, b: 0.2 }
const EDGE = { r: 0.08, g: 0.08, b: 0.07 }
const ICON = "__base__/graphics/icons/decider-combinator.png"

function deepcopy<T>(value: T): T {
  if (type(value) !== "table") return value
  const copy: Record<string, unknown> = {}
  for (const [key, item] of pairs(value as Record<string, unknown>)) copy[key] = deepcopy(item)
  return copy as T
}

/** Плита тела: клетки между колонками разъёмов (ширина NODE_WIDTH − 1), рамка — клетки чуть больше и темнее. */
function plate(height: number): Sprite {
  const layers: Sprite[] = []
  const inner = NODE_WIDTH - 1
  for (const [tint, scale] of [
    [EDGE, 3.3],
    [PLATE, 3.2],
  ] as const) {
    for (let x = 0; x < inner; x++) {
      for (let y = 0; y < height; y++) {
        layers.push({ filename: "__core__/graphics/white-square.png", size: 10, scale, tint, shift: [x - inner / 2 + 0.5, y - height / 2 + 0.5] })
      }
    }
  }
  return { layers }
}

const prototypes: object[] = []
for (let height = NODE_MIN_HEIGHT; height <= NODE_MAX_HEIGHT; height++) {
  const name = `${NODE_BODY_PREFIX}${height}`
  const body: SimpleEntityWithOwnerPrototype = {
    type: "simple-entity-with-owner",
    name,
    icon: ICON,
    icon_size: 64,
    flags: ["placeable-neutral", "player-creation", "not-on-map", "not-upgradable", "not-rotatable"],
    hidden: true,
    minable: { mining_time: 0.1 },
    placeable_by: { item: name, count: 1 },
    max_health: 100,
    // Ровно NODE_WIDTH × height клеток: от размера зависит, к чему игра притягивает центр при постройке.
    collision_box: [
      [-NODE_WIDTH / 2 + 0.1, -height / 2 + 0.1],
      [NODE_WIDTH / 2 - 0.1, height / 2 - 0.1],
    ],
    tile_width: NODE_WIDTH,
    tile_height: height,
    selection_box: [
      [-NODE_WIDTH / 2 + 0.5, -height / 2],
      [NODE_WIDTH / 2 - 0.5, height / 2],
    ],
    selection_priority: 40,
    render_layer: "object",
    picture: plate(height),
  }
  const item: ItemPrototype = { type: "item", name, icon: ICON, icon_size: 64, hidden: true, flags: ["only-in-cursor"], place_result: name, stack_size: 50 }
  prototypes.push(body, item)
}

for (const name of [PIN_EXEC, PIN_DATA]) {
  const pin = deepcopy(data.raw.lamp!["small-lamp"]!) as unknown as Record<string, unknown>
  pin.name = name
  pin.icon = name === PIN_EXEC ? "__base__/graphics/icons/red-wire.png" : "__base__/graphics/icons/green-wire.png"
  pin.icon_size = 64
  pin.icons = undefined
  pin.hidden = true
  pin.flags = ["placeable-neutral", "player-creation", "not-on-map", "not-upgradable"]
  pin.minable = undefined
  pin.placeable_by = { item: name, count: 1 }
  pin.collision_box = [
    [-0.2, -0.2],
    [0.2, 0.2],
  ]
  pin.collision_mask = { layers: {} }
  pin.selection_box = [
    [-0.4, -0.4],
    [0.4, 0.4],
  ]
  pin.selection_priority = 60
  pin.fast_replaceable_group = undefined
  pin.next_upgrade = undefined
  pin.corpse = undefined
  pin.dying_explosion = undefined
  pin.energy_source = { type: "void" }
  pin.circuit_wire_max_distance = 64
  const empty = { filename: "__core__/graphics/empty.png", size: 1 }
  pin.picture_off = empty
  pin.picture_on = empty
  pin.light = { intensity: 0, size: 0 }
  pin.light_when_colored = { intensity: 0, size: 0 }
  pin.glow_size = 0
  pin.always_on = false
  // Без значка подключения лампы: разъём рисует rendering, точки проводов — те же.
  const connector = pin.circuit_connector as { points?: unknown } | undefined
  pin.circuit_connector = connector === undefined ? undefined : { points: connector.points }
  const item: ItemPrototype = { type: "item", name, icon: pin.icon as string, icon_size: 64, hidden: true, flags: ["only-in-cursor"], place_result: name, stack_size: 50 }
  prototypes.push(pin, item)
}

data.extend(prototypes as never)
