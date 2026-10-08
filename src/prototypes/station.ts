// Зарядная станция (8.2): машины Mk2+ заряжают у неё аккумулятор (charge()). Здание — электроинтерфейс
// с буфером: копит энергию из сети, а мод перекачивает её в машины рядом (src/automaton/charging.ts).
// Графика — аккумулятор игры, перекрашенный в цвета автоматонов.
import { PrototypeData } from "factorio:common"
import { ElectricEnergyInterfacePrototype, ItemPrototype, RecipePrototype } from "factorio:prototype"
import { CHARGING_STATION, MODELS } from "../names"

declare const data: PrototypeData

const TINT = MODELS[1].accent

function deepcopy<T>(value: T): T {
  if (type(value) !== "table") return value
  const copy: Record<string, unknown> = {}
  for (const [key, item] of pairs(value as Record<string, unknown>)) copy[key] = deepcopy(item)
  return copy as T
}

/** Перекрасить слои картинки (кроме теней). */
function tinted(picture: unknown): unknown {
  const copy = deepcopy(picture) as { layers?: Array<Record<string, unknown>> } & Record<string, unknown>
  for (const layer of copy.layers ?? [copy]) if (!layer.draw_as_shadow) layer.tint = TINT
  return copy
}

const accumulator = data.raw.accumulator!.accumulator!
const icons = [{ icon: "__base__/graphics/icons/accumulator.png", icon_size: 64, tint: TINT }]

const station: ElectricEnergyInterfacePrototype = {
  type: "electric-energy-interface",
  name: CHARGING_STATION,
  icons,
  flags: ["placeable-neutral", "player-creation"],
  minable: { mining_time: 0.2, result: CHARGING_STATION },
  max_health: 200,
  corpse: "accumulator-remnants",
  collision_box: accumulator.collision_box,
  selection_box: accumulator.selection_box,
  energy_source: {
    type: "electric",
    buffer_capacity: "20MJ",
    usage_priority: "secondary-input",
    input_flow_limit: "2MW",
    output_flow_limit: "0W",
  },
  energy_production: "0W",
  energy_usage: "0W",
  picture: tinted((accumulator as unknown as { chargable_graphics: { picture: unknown } }).chargable_graphics.picture) as never,
}

const item: ItemPrototype = {
  type: "item",
  name: CHARGING_STATION,
  icons,
  subgroup: "energy",
  order: "e[accumulator]-z[automaton-charging-station]",
  place_result: CHARGING_STATION,
  stack_size: 20,
}

const recipe: RecipePrototype = {
  type: "recipe",
  name: CHARGING_STATION,
  enabled: false,
  energy_required: 5,
  ingredients: [
    { type: "item", name: "steel-plate", amount: 5 },
    { type: "item", name: "electronic-circuit", amount: 10 },
    { type: "item", name: "copper-cable", amount: 20 },
    { type: "item", name: "iron-plate", amount: 10 },
  ],
  results: [{ type: "item", name: CHARGING_STATION, amount: 1 }],
}

data.extend([station, item, recipe])
