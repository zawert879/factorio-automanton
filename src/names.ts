// Имена прототипов и ключей мода — общие для data и control.
export const WORKER_MK1 = "automaton-worker-mk1"
export const WORKER_MK1_PLACER = "automaton-worker-mk1-placer"
export const WORKER_MK2 = "automaton-worker-mk2"
export const WORKER_MK3 = "automaton-worker-mk3"
export const COMBAT_MK1 = "automaton-combat-mk1"
export const COMBAT_MK2 = "automaton-combat-mk2"
export const FLYER_MK1 = "automaton-flyer-mk1"
export const FLYER_MK2 = "automaton-flyer-mk2"
/** Выстрел боевой машины: событие скрипта, по которому мод тратит патрон и наносит урон (src/automaton/combat.ts). */
export const SHOT_EFFECT = "automaton-shot"
/** Зарядная станция машин Mk2+ (8.2). */
export const CHARGING_STATION = "automaton-charging-station"
export const ROBOT_TAG = "automaton"
/** Метка — сущность с именем, к которой программы обращаются marker("имя"). */
export const MARKER = "automaton-marker"
/** Сигнальная метка (9.6): метка, которую можно подключить проводами (постоянный комбинатор). */
export const SIGNAL_MARKER = "automaton-signal-marker"
export const MARKER_ENTITIES: readonly string[] = [MARKER, SIGNAL_MARKER]
/** «Программатор» — инструмент выделения зон: zone("имя"). */
export const PROGRAMMER = "automaton-programmer"
/** Справка в игре (18.5): ярлык на панели быстрого доступа и клавиша (F1). */
export const HELP_SHORTCUT = "automaton-help"
export const HELP_INPUT = "automaton-help"

/** Что делает машина — от этого зависит анимация её тела. */
export type Activity = "idle" | "run" | "mine"
export const ACTIVITIES: readonly Activity[] = ["idle", "run", "mine"]
/** Направлений у анимаций тела: 0 — север, дальше по часовой стрелке через 45°. */
export const BODY_DIRECTIONS = 8

/** Имя прототипа анимации тела машины этой модели. */
export function bodyAnimationName(entity: string, activity: Activity, direction: number): string {
  return `${entity}-${activity}-${direction}`
}

/** Какую анимацию показывать: у летающих поза не зависит от занятия (дрон одинаков на месте и в полёте). */
export function bodyPose(entity: string, activity: Activity, direction: number): string {
  return bodyAnimationName(entity, modelOf(entity)?.flying ? "idle" : activity, direction)
}

/** Цвет (как Color прототипов и runtime). */
export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Модели машин (8.1): сущность-юнит (её имя — и имя предмета), заглушка для установки, характеристики.
 * Mk1 жжёт топливо, Mk2+ работают от аккумулятора и заряжаются на станции. Бонусы исследований (8.3)
 * умножают характеристики — src/automaton/models.ts.
 */
export interface ModelSpec {
  /** Имя модели для программ (Robot.model). */
  id: "worker-mk1" | "worker-mk2" | "worker-mk3" | "combat-mk1" | "combat-mk2" | "flyer-mk1" | "flyer-mk2"
  /** Цифра на значке. */
  digit: number
  entity: string
  placer: string
  /** Технология, которая открывает рецепт (нет — доступна сразу). */
  tech?: string
  /** Клеток за тик. */
  speed: number
  health: number
  cargoSlots: number
  /** Бак, единиц жидкости. */
  tank: number
  /** Инструкций программы за тик. */
  quantum: number
  /** Живой памяти программы, единиц (таблица — 1, элемент — 1/8). */
  memory: number
  miningSpeed: number
  /** Ёмкость аккумулятора, Дж (Mk2+); у Mk1 — нет (топливо). */
  battery?: number
  /** Оружие боевых моделей (этап 10). */
  weapon?: WeaponSpec
  /** Летающая (этап 11): движение рассчитывается, ни с чем не сталкивается, не добывает, без бака. */
  flying?: boolean
  /** Радиус зрения модели, клеток (исследования «Сенсоров» могут дать больше). */
  vision: number
  /** Сопротивления (боевые модели): физический и взрывной урон, процент. */
  resistances?: { physical: number; explosion: number }
  steel: Rgb
  accent: Rgb
}

/** Оружие модели: вид (для программ), категория патронов, дальность (клеток), перезарядка (тиков). */
export interface WeaponSpec {
  type: "gun" | "rocket"
  category: "bullet" | "rocket"
  range: number
  cooldown: number
}

export const MODELS: readonly ModelSpec[] = [
  {
    id: "worker-mk1",
    vision: 10,
    digit: 1,
    entity: WORKER_MK1,
    placer: WORKER_MK1_PLACER,
    speed: 0.1,
    health: 150,
    cargoSlots: 10,
    tank: 1000,
    quantum: 50,
    memory: 20000,
    miningSpeed: 0.5,
    steel: { r: 0.62, g: 0.72, b: 0.88 },
    accent: { r: 0.15, g: 0.85, b: 0.9 },
  },
  {
    id: "worker-mk2",
    vision: 16,
    digit: 2,
    entity: WORKER_MK2,
    placer: `${WORKER_MK2}-placer`,
    tech: "automaton-mk2",
    speed: 0.14,
    health: 250,
    cargoSlots: 20,
    tank: 2000,
    quantum: 100,
    memory: 40000,
    miningSpeed: 0.75,
    battery: 10_000_000,
    steel: { r: 0.55, g: 0.58, b: 0.62 },
    accent: { r: 1, g: 0.75, b: 0.15 },
  },
  {
    id: "worker-mk3",
    vision: 24,
    digit: 3,
    entity: WORKER_MK3,
    placer: `${WORKER_MK3}-placer`,
    tech: "automaton-mk3",
    speed: 0.18,
    health: 400,
    cargoSlots: 30,
    tank: 4000,
    quantum: 200,
    memory: 80000,
    miningSpeed: 1,
    battery: 25_000_000,
    steel: { r: 0.85, g: 0.86, b: 0.9 },
    accent: { r: 0.95, g: 0.25, b: 0.45 },
  },
  {
    id: "combat-mk1",
    vision: 24,
    digit: 1,
    entity: COMBAT_MK1,
    placer: `${COMBAT_MK1}-placer`,
    tech: "automaton-combat-1",
    speed: 0.12,
    health: 350,
    cargoSlots: 5,
    tank: 0,
    quantum: 50,
    memory: 20000,
    miningSpeed: 0.5,
    weapon: { type: "gun", category: "bullet", range: 15, cooldown: 10 },
    resistances: { physical: 20, explosion: 10 },
    steel: { r: 0.42, g: 0.46, b: 0.36 },
    accent: { r: 0.9, g: 0.2, b: 0.15 },
  },
  {
    id: "combat-mk2",
    vision: 32,
    digit: 2,
    entity: COMBAT_MK2,
    placer: `${COMBAT_MK2}-placer`,
    tech: "automaton-combat-2",
    speed: 0.13,
    health: 700,
    cargoSlots: 5,
    tank: 0,
    quantum: 100,
    memory: 40000,
    miningSpeed: 0.5,
    battery: 15_000_000,
    weapon: { type: "rocket", category: "rocket", range: 24, cooldown: 60 },
    resistances: { physical: 30, explosion: 30 },
    steel: { r: 0.3, g: 0.31, b: 0.35 },
    accent: { r: 1, g: 0.5, b: 0.1 },
  },
  {
    id: "flyer-mk1",
    vision: 16,
    digit: 1,
    entity: FLYER_MK1,
    placer: `${FLYER_MK1}-placer`,
    tech: "automaton-flying-1",
    flying: true,
    speed: 0.25,
    health: 100,
    cargoSlots: 2,
    tank: 0,
    quantum: 100,
    memory: 20000,
    miningSpeed: 0,
    battery: 5_000_000,
    steel: { r: 0.85, g: 0.88, b: 0.92 },
    accent: { r: 0.15, g: 0.85, b: 0.9 },
  },
  {
    id: "flyer-mk2",
    vision: 24,
    digit: 2,
    entity: FLYER_MK2,
    placer: `${FLYER_MK2}-placer`,
    tech: "automaton-flying-2",
    flying: true,
    speed: 0.4,
    health: 200,
    cargoSlots: 4,
    tank: 0,
    quantum: 400,
    memory: 40000,
    miningSpeed: 0,
    battery: 10_000_000,
    steel: { r: 0.95, g: 0.85, b: 0.55 },
    accent: { r: 1, g: 0.75, b: 0.15 },
  },
]

const MODEL_BY_NAME = new LuaMap<string, ModelSpec>()
for (const model of MODELS) {
  MODEL_BY_NAME.set(model.entity, model)
  MODEL_BY_NAME.set(model.placer, model)
}

/** Модель по имени сущности юнита, заглушки или предмета (таблицей: зовётся на каждом шагу). */
export function modelOf(name: string): ModelSpec | undefined {
  return MODEL_BY_NAME.get(name)
}

export const ROBOT_ENTITIES: readonly string[] = MODELS.map((m) => m.entity)
export const ROBOT_PLACERS: readonly string[] = MODELS.map((m) => m.placer)

/** Технологии автоматонов (6.3): открывают возможности API и модели машин (таблица — docs/API.md, «Исследования»). */
export const TECH = {
  radio: "automaton-radio",
  display: "automaton-display",
  tuning: "automaton-tuning",
  fluids: "automaton-fluids",
  construction: "automaton-construction",
  circuits: "automaton-circuits",
  sensors1: "automaton-sensors-1",
  sensors2: "automaton-sensors-2",
  sensors3: "automaton-sensors-3",
  mk2: "automaton-mk2",
  mk3: "automaton-mk3",
  combat1: "automaton-combat-1",
  combat2: "automaton-combat-2",
  flying1: "automaton-flying-1",
  flying2: "automaton-flying-2",
} as const

/** Типы сущностей, которые убирает мод (src/prototypes/removal.ts; логистические сундуки — кроме сундука хранения). */
export const REMOVED_ENTITY_TYPES = [
  "transport-belt",
  "underground-belt",
  "splitter",
  "loader",
  "loader-1x1",
  "linked-belt",
  "lane-splitter",
  "inserter",
  "mining-drill",
  "logistic-robot",
  "offshore-pump",
]

/** Улучшения исследованиями (8.3): технологии `<tech>-1..3`; каждый уровень добавляет step к множителю. */
export const UPGRADES = [
  { kind: "speed", tech: "automaton-speed", step: 0.15 },
  { kind: "cargo", tech: "automaton-cargo", step: 0.5 },
  { kind: "mining", tech: "automaton-mining", step: 0.25 },
  { kind: "processor", tech: "automaton-processor", step: 0.5 },
  { kind: "memory", tech: "automaton-memory", step: 0.5 },
  { kind: "tank", tech: "automaton-tank", step: 0.5 },
] as const
export type UpgradeKind = (typeof UPGRADES)[number]["kind"]
export const UPGRADE_LEVELS = 3
/** Радиус зрения по числу исследованных уровней «Сенсоров» (0–3). */
export const VISION_BY_SENSORS = [10, 16, 24, 32]

/** Табло (9.5): размер в клетках и пикселях экрана (32 пикселя на клетку), рецепт. */
export const DISPLAYS = [
  {
    name: "automaton-display-small",
    tilesWide: 3,
    tilesHigh: 2,
    ingredients: [
      ["electronic-circuit", 5],
      ["copper-cable", 10],
      ["iron-plate", 5],
    ] as [string, number][],
  },
  {
    name: "automaton-display-large",
    tilesWide: 6,
    tilesHigh: 4,
    ingredients: [
      ["automaton-display-small", 3],
      ["electronic-circuit", 5],
    ] as [string, number][],
  },
]
/** Пикселей экрана табло на клетку. */
export const DISPLAY_PIXELS_PER_TILE = 32
/** Спрайт экрана табло: белый квадрат 10×10 (перекрашивается в цвет фона). */
export const DISPLAY_SCREEN_SPRITE = "automaton-display-screen"
