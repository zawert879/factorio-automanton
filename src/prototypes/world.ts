// Метки и зоны (4.9): сущность-метка (флажок с именем) и «Программатор» — инструмент выделения зон
// с ярлыком на панели быстрого доступа.
import { PrototypeData } from "factorio:common"
import {
  ItemPrototype,
  RecipePrototype,
  SelectionToolPrototype,
  ShortcutPrototype,
  SimpleEntityWithOwnerPrototype,
} from "factorio:prototype"
import { MARKER, PROGRAMMER, SIGNAL_MARKER } from "../names"

declare const data: PrototypeData

const FLAG = "__base__/graphics/icons/signal/signal-white-flag.png"
const TOOL = "__base__/graphics/icons/copy-paste-tool.png"
const ACCENT = { r: 0.15, g: 0.85, b: 0.9 }

const marker: SimpleEntityWithOwnerPrototype = {
  type: "simple-entity-with-owner",
  name: MARKER,
  icons: [{ icon: FLAG, icon_size: 64, tint: ACCENT }],
  flags: ["placeable-player", "placeable-neutral", "player-creation", "not-on-map"],
  minable: { mining_time: 0.1, result: MARKER },
  collision_box: [
    [-0.2, -0.2],
    [0.2, 0.2],
  ],
  // Машины и персонажи проходят сквозь метку.
  collision_mask: { layers: {} },
  selection_box: [
    [-0.4, -0.4],
    [0.4, 0.4],
  ],
  render_layer: "object",
  picture: { filename: FLAG, size: 64, scale: 0.4, tint: ACCENT, shift: [0, -0.3] },
}

const markerItem: ItemPrototype = {
  type: "item",
  name: MARKER,
  icons: marker.icons,
  subgroup: "transport",
  order: "z[automaton]-m[marker]",
  place_result: MARKER,
  stack_size: 50,
}

const markerRecipe: RecipePrototype = {
  type: "recipe",
  name: MARKER,
  enabled: true,
  energy_required: 0.5,
  ingredients: [{ type: "item", name: "iron-plate", amount: 1 }],
  results: [{ type: "item", name: MARKER, amount: 1 }],
}

const programmer: SelectionToolPrototype = {
  type: "selection-tool",
  name: PROGRAMMER,
  icons: [{ icon: TOOL, icon_size: 64, tint: ACCENT }],
  flags: ["only-in-cursor", "spawnable", "not-stackable"],
  subgroup: "tool",
  order: "z[automaton]-p[programmer]",
  stack_size: 1,
  select: { border_color: ACCENT, cursor_box_type: "entity", mode: ["nothing"] },
  alt_select: { border_color: { r: 0.9, g: 0.3, b: 0.2 }, cursor_box_type: "not-allowed", mode: ["nothing"] },
}

const shortcut: ShortcutPrototype = {
  type: "shortcut",
  name: PROGRAMMER,
  action: "spawn-item",
  item_to_spawn: PROGRAMMER,
  icon: TOOL,
  icon_size: 64,
  small_icon: TOOL,
  small_icon_size: 64,
}

// Сигнальная метка (9.6): постоянный комбинатор игры (провода, окно сигналов), перекрашенный в цвет
// меток, сквозь который можно ходить. Программы находят её marker("имя") и читают/пишут сигналы.
function deepcopy<T>(value: T): T {
  if (type(value) !== "table") return value
  const copy: Record<string, unknown> = {}
  for (const [key, item] of pairs(value as Record<string, unknown>)) copy[key] = deepcopy(item)
  return copy as T
}

function tintSprites(value: unknown): void {
  if (type(value) !== "table") return
  const table = value as Record<string, unknown>
  if (typeof table.filename === "string" && !table.draw_as_shadow) table.tint = ACCENT
  for (const [, item] of pairs(table)) tintSprites(item)
}

const signalMarker = deepcopy(data.raw["constant-combinator"]!["constant-combinator"]!) as unknown as Record<string, unknown>
signalMarker.name = SIGNAL_MARKER
signalMarker.icons = [
  { icon: FLAG, icon_size: 64, tint: ACCENT },
  { icon: "__base__/graphics/icons/red-wire.png", icon_size: 64, scale: 0.25, shift: [8, 8] },
]
signalMarker.icon = undefined
signalMarker.minable = { mining_time: 0.1, result: SIGNAL_MARKER }
signalMarker.collision_mask = { layers: {} }
signalMarker.fast_replaceable_group = undefined
signalMarker.next_upgrade = undefined
tintSprites(signalMarker.sprites)

const signalMarkerItem: ItemPrototype = {
  type: "item",
  name: SIGNAL_MARKER,
  icons: signalMarker.icons as ItemPrototype["icons"],
  subgroup: "transport",
  order: "z[automaton]-n[signal-marker]",
  place_result: SIGNAL_MARKER,
  stack_size: 50,
}

const signalMarkerRecipe: RecipePrototype = {
  type: "recipe",
  name: SIGNAL_MARKER,
  enabled: false,
  energy_required: 0.5,
  ingredients: [
    { type: "item", name: MARKER, amount: 1 },
    { type: "item", name: "constant-combinator", amount: 1 },
  ],
  results: [{ type: "item", name: SIGNAL_MARKER, amount: 1 }],
}

data.extend([signalMarker as never, signalMarkerItem, signalMarkerRecipe])

data.extend([marker, markerItem, markerRecipe, programmer, shortcut])
