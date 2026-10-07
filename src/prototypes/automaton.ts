// Прототипы рабочего автоматона Mk1: юнит, анимации тела, предмет, временный рецепт и заглушка для установки.
// Юнит нельзя поставить из инвентаря напрямую, поэтому предмет ставит заглушку
// (simple-entity-with-owner), которую control заменяет на юнит (src/automaton/placement.ts).
import { PrototypeData } from "factorio:common"
import {
  AnimationPrototype,
  Color,
  IconData,
  ItemWithTagsPrototype,
  RecipePrototype,
  RotatedAnimation,
  SimpleEntityWithOwnerPrototype,
  UnitPrototype,
} from "factorio:prototype"
import { ACTIVITIES, Activity, BODY_DIRECTIONS, bodyAnimationName, WORKER_MK1, WORKER_MK1_PLACER } from "../names"

declare const data: PrototypeData

const SCALE = 0.8
const STEEL: Color = { r: 0.62, g: 0.72, b: 0.88 }
// Акцент — бирюзовый: оранжевый совпадал с цветом игрока по умолчанию, машины путались с игроками.
const ACCENT: Color = { r: 0.15, g: 0.85, b: 0.9 }

const ICONS: IconData[] = [{ icon: "__core__/graphics/icons/entity/character.png", icon_size: 64, tint: STEEL }]

/** Слой анимации персонажа, как он лежит в data.raw (нужные нам поля). */
interface SourceLayer {
  filename?: string
  stripes?: Array<{ filename: string; width_in_frames: number; height_in_frames: number; x?: number; y?: number }>
  width: number
  height: number
  frame_count: number
  scale?: number
  shift?: [number, number] | { x: number; y: number }
  apply_runtime_tint?: boolean
  draw_as_shadow?: boolean
}

/**
 * Анимация одного направления из анимации персонажа (8 направлений — 8 строк листа, а «полосы» —
 * несколько файлов по ширине). Перекрашена в сталь с янтарным акцентом и уменьшена.
 */
function bodyAnimation(name: string, source: RotatedAnimation, direction: number, speed: number): AnimationPrototype {
  const layers = (source as unknown as { layers: SourceLayer[] }).layers.map((layer) => {
    const [x, y] = Array.isArray(layer.shift) ? layer.shift : [layer.shift?.x ?? 0, layer.shift?.y ?? 0]
    const common = {
      width: layer.width,
      height: layer.height,
      frame_count: layer.frame_count,
      scale: (layer.scale ?? 1) * SCALE,
      shift: [x * SCALE, y * SCALE] as [number, number],
      animation_speed: speed,
      draw_as_shadow: layer.draw_as_shadow,
      tint: layer.draw_as_shadow ? undefined : layer.apply_runtime_tint ? ACCENT : STEEL,
    }
    if (layer.stripes !== undefined) {
      const stripes = layer.stripes.map((stripe) => ({
        filename: stripe.filename,
        width_in_frames: stripe.width_in_frames,
        height_in_frames: 1,
        x: stripe.x ?? 0,
        y: (stripe.y ?? 0) + direction * layer.height,
      }))
      return { ...common, stripes }
    }
    return { ...common, filename: layer.filename!, line_length: layer.frame_count, y: direction * layer.height }
  })
  return { type: "animation", name, layers } as AnimationPrototype
}

const characterAnimations = data.raw.character.character!.animations[0]

/** Анимации тела: состояние → (анимация персонажа, скорость кадров за тик). */
const BODY_SOURCES: Record<Activity, [RotatedAnimation, number]> = {
  idle: [characterAnimations.idle!, 0.15],
  // Машина проходит 0.1 клетки за тик, кадр бега персонажа — ~0.1 клетки: около кадра за тик.
  run: [characterAnimations.running!, 1],
  mine: [characterAnimations.mining_with_tool!, 0.9],
}

const bodyAnimations: AnimationPrototype[] = []
for (const activity of ACTIVITIES) {
  const [source, speed] = BODY_SOURCES[activity]
  for (let direction = 0; direction < BODY_DIRECTIONS; direction++) {
    bodyAnimations.push(bodyAnimation(bodyAnimationName(activity, direction), source, direction, speed))
  }
}

/**
 * Собственный спрайт юнита — прозрачный: у юнита только анимация бега по пройденному пути,
 * простоя нет. Тело рисуется накладкой (src/automaton/appearance.ts) по состоянию и направлению.
 */
const INVISIBLE: RotatedAnimation = {
  filename: "__core__/graphics/empty.png",
  width: 1,
  height: 1,
  frame_count: 1,
  direction_count: 1,
}

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
  distance_per_frame: 1,
  run_animation: INVISIBLE,
  // Юниту обязательно нужна атака; рабочему она ни к чему — нулевой урон, бой не начинается
  // (команды отдаются с distraction = none).
  attack_parameters: {
    type: "projectile",
    range: 0.5,
    cooldown: 60,
    ammo_category: "melee",
    ammo_type: { action: { type: "direct", action_delivery: { type: "instant" } } },
    animation: INVISIBLE,
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

// item-with-tags: подобранная машина уносит в предмет свои id и имя (src/automaton/registry.ts).
const item: ItemWithTagsPrototype = {
  type: "item-with-tags",
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

data.extend([worker, placer, item, recipe, ...bodyAnimations])
