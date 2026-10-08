// Прототипы рабочих автоматонов Mk1–Mk3 (8.1): юнит, анимации тела, предмет, рецепт и заглушка для установки.
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
import {
  ACTIVITIES,
  Activity,
  BODY_DIRECTIONS,
  bodyAnimationName,
  COMBAT_MK1,
  COMBAT_MK2,
  MODELS,
  ModelSpec,
  SHOT_EFFECT,
  WORKER_MK1,
  WORKER_MK2,
} from "../names"

declare const data: PrototypeData

const SCALE = 0.8
// Цвета моделей — в MODELS (src/names.ts). Акцент Mk1 — бирюзовый: оранжевый совпадал с цветом игрока
// по умолчанию, машины путались с игроками.

/** Значок модели: персонаж в цвете стали и цифра модели в углу. */
function modelIcons(model: ModelSpec, digit: number): IconData[] {
  return [
    { icon: "__core__/graphics/icons/entity/character.png", icon_size: 64, tint: model.steel as Color },
    { icon: `__base__/graphics/icons/signal/signal_${digit}.png`, icon_size: 64, scale: 0.25, shift: [9, 9], tint: model.accent as Color },
  ]
}

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
function bodyAnimation(name: string, source: RotatedAnimation, direction: number, speed: number, model: ModelSpec): AnimationPrototype {
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
      tint: (layer.draw_as_shadow ? undefined : layer.apply_runtime_tint ? model.accent : model.steel) as Color | undefined,
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

/** Рецепты моделей: Mk1 — со старта, Mk2 и Mk3 — улучшение предыдущей модели (открываются технологиями). */
const RECIPES: Record<string, RecipePrototype["ingredients"]> = {
  [WORKER_MK1]: [
    { type: "item", name: "iron-plate", amount: 10 },
    { type: "item", name: "iron-gear-wheel", amount: 5 },
  ],
  [WORKER_MK2]: [
    { type: "item", name: WORKER_MK1, amount: 1 },
    { type: "item", name: "steel-plate", amount: 10 },
    { type: "item", name: "electronic-circuit", amount: 10 },
    { type: "item", name: "iron-gear-wheel", amount: 10 },
  ],
  "automaton-worker-mk3": [
    { type: "item", name: WORKER_MK2, amount: 1 },
    { type: "item", name: "battery", amount: 10 },
    { type: "item", name: "advanced-circuit", amount: 10 },
    { type: "item", name: "steel-plate", amount: 10 },
  ],
  [COMBAT_MK1]: [
    { type: "item", name: WORKER_MK1, amount: 1 },
    { type: "item", name: "submachine-gun", amount: 1 },
    { type: "item", name: "steel-plate", amount: 10 },
  ],
  [COMBAT_MK2]: [
    { type: "item", name: COMBAT_MK1, amount: 1 },
    { type: "item", name: "rocket-launcher", amount: 1 },
    { type: "item", name: "steel-plate", amount: 10 },
    { type: "item", name: "electronic-circuit", amount: 10 },
  ],
}

/**
 * Атака юнита. Рабочие: ближний бой без урона (юниту атака обязательна, бой не начинается — команды
 * с distraction = none). Боевые: мгновенное попадание с эффектом скрипта — урон и расход патронов
 * считает мод по заряженным патронам (src/automaton/combat.ts), сам выстрел урона не наносит.
 */
function attackParameters(model: ModelSpec): UnitPrototype["attack_parameters"] {
  const weapon = model.weapon
  if (weapon === undefined) {
    return {
      type: "projectile",
      range: 0.5,
      cooldown: 60,
      ammo_category: "melee",
      ammo_type: { action: { type: "direct", action_delivery: { type: "instant" } } },
      animation: INVISIBLE,
    }
  }
  const hit = weapon.category === "rocket" ? "big-explosion" : "explosion-hit"
  return {
    type: "projectile",
    range: weapon.range,
    cooldown: weapon.cooldown,
    ammo_category: weapon.category,
    ammo_type: {
      target_type: "entity",
      action: {
        type: "direct",
        action_delivery: {
          type: "instant",
          target_effects: [
            { type: "script", effect_id: SHOT_EFFECT },
            { type: "create-entity", entity_name: hit },
          ],
        },
      },
    },
    sound: [{ filename: weapon.category === "rocket" ? "__base__/sound/fight/rocket-launcher.ogg" : "__base__/sound/fight/submachine-gunshot-1.ogg", volume: 0.4 }],
    animation: INVISIBLE,
  }
}

function modelPrototypes(model: ModelSpec, index: number): object[] {
  const icons = modelIcons(model, model.digit)
  const animations: AnimationPrototype[] = []
  for (const activity of ACTIVITIES) {
    const [source, frameSpeed] = BODY_SOURCES[activity]
    // Кадры бега идут по пути: быстрая модель перебирает их быстрее.
    const speed = activity === "run" ? frameSpeed * (model.speed / 0.1) : frameSpeed
    for (let direction = 0; direction < BODY_DIRECTIONS; direction++) {
      animations.push(bodyAnimation(bodyAnimationName(model.entity, activity, direction), source, direction, speed, model))
    }
  }

  const worker: UnitPrototype = {
    type: "unit",
    name: model.entity,
    icons,
    flags: ["placeable-player", "placeable-off-grid", "player-creation"],
    minable: { mining_time: 0.5, result: model.entity },
    max_health: model.health,
    collision_box: [
      [-0.2, -0.2],
      [0.2, 0.2],
    ],
    selection_box: [
      [-0.35, -1.1],
      [0.35, 0.2],
    ],
    movement_speed: model.speed,
    distance_per_frame: 1,
    run_animation: INVISIBLE,
    attack_parameters: attackParameters(model),
    resistances:
      model.resistances === undefined
        ? undefined
        : [
            { type: "physical", percent: model.resistances.physical, decrease: 2 },
            { type: "explosion", percent: model.resistances.explosion },
          ],
    vision_distance: model.weapon === undefined ? 10 : model.weapon.range + 5,
    distraction_cooldown: 300,
    max_pursue_distance: model.weapon === undefined ? 10 : 30,
    ai_settings: { destroy_when_commands_fail: false, allow_try_return_to_spawner: false, do_separation: true },
    has_belt_immunity: true,
    dying_explosion: "explosion",
  }

  const placer: SimpleEntityWithOwnerPrototype = {
    type: "simple-entity-with-owner",
    name: model.placer,
    icons,
    flags: ["placeable-player", "placeable-off-grid", "player-creation"],
    placeable_by: { item: model.entity, count: 1 },
    minable: { mining_time: 0.1, result: model.entity },
    collision_box: worker.collision_box,
    selection_box: worker.selection_box,
    picture: { filename: "__core__/graphics/icons/entity/character.png", size: 64, scale: 0.5, tint: model.steel as Color },
    hidden_in_factoriopedia: true,
  }

  // item-with-tags: подобранная машина уносит в предмет свои id, имя, энергию и бак (src/automaton/registry.ts).
  const item: ItemWithTagsPrototype = {
    type: "item-with-tags",
    name: model.entity,
    icons,
    subgroup: "transport",
    order: `z[automaton]-a[${model.id}]`,
    place_result: model.placer,
    stack_size: 10,
  }

  const recipe: RecipePrototype = {
    type: "recipe",
    name: model.entity,
    enabled: model.tech === undefined,
    energy_required: 2 + index * 3,
    ingredients: RECIPES[model.entity],
    results: [{ type: "item", name: model.entity, amount: 1 }],
  }

  return [worker, placer, item, recipe, ...animations]
}

for (let i = 0; i < MODELS.length; i++) data.extend(modelPrototypes(MODELS[i], i) as never)
