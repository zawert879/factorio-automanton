// Прототипы рабочего автоматона Mk1: юнит, предмет, временный рецепт и заглушка для установки.
// Юнит нельзя поставить из инвентаря напрямую, поэтому предмет ставит заглушку
// (simple-entity-with-owner), которую control заменяет на юнит (src/automaton/placement.ts).
import { PrototypeData } from "factorio:common"
import {
  Color,
  IconData,
  ItemPrototype,
  RecipePrototype,
  RotatedAnimation,
  SimpleEntityWithOwnerPrototype,
  UnitPrototype,
} from "factorio:prototype"
import * as util from "util"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"

declare const data: PrototypeData

const SCALE = 0.8
const STEEL: Color = { r: 0.72, g: 0.78, b: 0.86 }
const AMBER: Color = { r: 1, g: 0.62, b: 0.12 }

const ICONS: IconData[] = [{ icon: "__core__/graphics/icons/entity/character.png", icon_size: 64, tint: STEEL }]

interface AnimationLayer {
  scale?: number
  shift?: [number, number] | { x: number; y: number }
  tint?: Color
  apply_runtime_tint?: boolean
  draw_as_shadow?: boolean
}

/** Анимация персонажа, перекрашенная в сталь с янтарным акцентом и уменьшенная. */
function steelAnimation(source: RotatedAnimation): RotatedAnimation {
  const animation = util.table.deepcopy(source) as { layers: AnimationLayer[] }
  for (const layer of animation.layers) {
    layer.scale = (layer.scale ?? 1) * SCALE
    if (layer.shift !== undefined) {
      const [x, y] = Array.isArray(layer.shift) ? layer.shift : [layer.shift.x, layer.shift.y]
      layer.shift = [x * SCALE, y * SCALE]
    }
    if (layer.draw_as_shadow) continue
    if (layer.apply_runtime_tint) {
      layer.apply_runtime_tint = false
      layer.tint = AMBER
    } else {
      layer.tint = STEEL
    }
  }
  return animation as unknown as RotatedAnimation
}

const characterAnimations = data.raw.character.character!.animations[0]

const worker: UnitPrototype = {
  type: "unit",
  name: WORKER_MK1,
  icons: ICONS,
  flags: ["placeable-player", "placeable-off-grid", "player-creation"],
  minable: { mining_time: 0.5, result: WORKER_MK1 },
  max_health: 150,
  collision_box: [
    [-0.2, -0.2],
    [0.2, 0.2],
  ],
  selection_box: [
    [-0.35, -1.1],
    [0.35, 0.2],
  ],
  movement_speed: 0.1,
  distance_per_frame: 0.13 * SCALE,
  run_animation: steelAnimation(characterAnimations.running!),
  // Юниту обязательно нужна атака; рабочему она ни к чему — нулевой урон, бой не начинается
  // (команды отдаются с distraction = none).
  attack_parameters: {
    type: "projectile",
    range: 0.5,
    cooldown: 60,
    ammo_category: "melee",
    ammo_type: { action: { type: "direct", action_delivery: { type: "instant" } } },
    animation: steelAnimation(characterAnimations.idle!),
  },
  vision_distance: 10,
  distraction_cooldown: 300,
  max_pursue_distance: 10,
  ai_settings: { destroy_when_commands_fail: false, allow_try_return_to_spawner: false, do_separation: true },
  has_belt_immunity: true,
  dying_explosion: "explosion",
}

const placer: SimpleEntityWithOwnerPrototype = {
  type: "simple-entity-with-owner",
  name: WORKER_MK1_PLACER,
  icons: ICONS,
  flags: ["placeable-player", "placeable-off-grid", "player-creation"],
  placeable_by: { item: WORKER_MK1, count: 1 },
  minable: { mining_time: 0.1, result: WORKER_MK1 },
  collision_box: worker.collision_box,
  selection_box: worker.selection_box,
  picture: { filename: "__core__/graphics/icons/entity/character.png", size: 64, scale: 0.5, tint: STEEL },
  hidden_in_factoriopedia: true,
}

const item: ItemPrototype = {
  type: "item",
  name: WORKER_MK1,
  icons: ICONS,
  subgroup: "transport",
  order: "z[automaton]-a[worker-mk1]",
  place_result: WORKER_MK1_PLACER,
  stack_size: 10,
}

// Временный рецепт для спайка: доступен с начала игры. Настоящий баланс — на этапах 6 и 8.
const recipe: RecipePrototype = {
  type: "recipe",
  name: WORKER_MK1,
  enabled: true,
  energy_required: 2,
  ingredients: [
    { type: "item", name: "iron-plate", amount: 10 },
    { type: "item", name: "iron-gear-wheel", amount: 5 },
  ],
  results: [{ type: "item", name: WORKER_MK1, amount: 1 }],
}

data.extend([worker, placer, item, recipe])
