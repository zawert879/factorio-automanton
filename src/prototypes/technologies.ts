// Технологии автоматонов (6.3). Встают на место «Логистики» (конвейеры убраны) и открывают возможности
// API и модели машин — таблица в docs/API.md, «Исследования». Сами по себе прототипы ничего не делают
// (эффект «nothing» с описанием): проверку «исследовано ли» делает control (этап 8.4).
//
// «Жидкости» открываются не наукой, а триггером (скрафтить котёл): прибрежного насоса нет, воду к котлам
// возят машины, а без электричества не работают лаборатории — иначе не исследовать вообще ничего.
import { PrototypeData } from "factorio:common"
import { Color, IconData, TechnologyPrototype } from "factorio:prototype"
import { CHARGING_STATION, COMBAT_MK1, COMBAT_MK2, DISPLAYS, SIGNAL_MARKER, TECH, UPGRADE_LEVELS, UPGRADES, WORKER_MK2, WORKER_MK3 } from "../names"

declare const data: PrototypeData

const STEEL: Color = { r: 0.62, g: 0.72, b: 0.88 }

/** Значок: машина (персонаж в цвете стали) и в углу — значок возможности. */
function icons(overlay: string): IconData[] {
  return [
    { icon: "__core__/graphics/icons/entity/character.png", icon_size: 64, tint: STEEL, scale: 2 },
    { icon: overlay, icon_size: 64, scale: 1, shift: [36, 36] },
  ]
}

type Pack = "automation-science-pack" | "logistic-science-pack" | "chemical-science-pack" | "military-science-pack" | "utility-science-pack"

interface Spec {
  name: string
  overlay: string
  prerequisites: string[]
  count?: number
  packs?: Pack[]
  time?: number
  trigger?: TechnologyPrototype["research_trigger"]
  /** Уровни одной технологии (Сенсоры 1–3): общий значок и «upgrade». */
  upgrade?: boolean
  /** Рецепты, которые открывает (модели, станция). */
  unlocks?: string[]
  /** Описание эффекта (ключ automaton.tech-effect-…); по умолчанию — по имени технологии. */
  effect?: string
}

const RED: Pack[] = ["automation-science-pack"]
const GREEN: Pack[] = [...RED, "logistic-science-pack"]
const BLUE: Pack[] = [...GREEN, "chemical-science-pack"]
const ICON = "__base__/graphics/icons/"

const SPECS: Spec[] = [
  // Красная наука: место «Логистики».
  { name: TECH.radio, overlay: ICON + "radar.png", prerequisites: ["automation-science-pack"], count: 20, packs: RED, time: 15 },
  {
    name: TECH.display,
    overlay: ICON + "display-panel.png",
    prerequisites: [TECH.radio],
    count: 30,
    packs: RED,
    unlocks: DISPLAYS.map((d) => d.name),
  },
  { name: TECH.tuning, overlay: ICON + "assembling-machine-1.png", prerequisites: ["automation"], count: 30, packs: RED },
  { name: TECH.sensors1, overlay: ICON + "night-vision-equipment.png", prerequisites: [TECH.radio], count: 50, packs: RED, upgrade: true },
  {
    name: TECH.fluids,
    overlay: ICON + "fluid/water.png",
    prerequisites: ["steam-power"],
    trigger: { type: "craft-item", item: "boiler" },
  },
  // Зелёная.
  { name: TECH.construction, overlay: ICON + "blueprint.png", prerequisites: [TECH.radio, "logistic-science-pack"], count: 100, packs: GREEN },
  {
    name: TECH.circuits,
    overlay: ICON + "red-wire.png",
    prerequisites: ["circuit-network"],
    count: 100,
    packs: GREEN,
    unlocks: [SIGNAL_MARKER],
  },
  { name: TECH.sensors2, overlay: ICON + "night-vision-equipment.png", prerequisites: [TECH.sensors1, "logistic-science-pack"], count: 150, packs: GREEN, upgrade: true },
  {
    name: TECH.mk2,
    overlay: ICON + "battery.png",
    prerequisites: ["electric-energy-distribution-1"],
    count: 150,
    packs: GREEN,
    unlocks: [WORKER_MK2, CHARGING_STATION],
  },
  {
    name: TECH.combat1,
    overlay: ICON + "submachine-gun.png",
    prerequisites: ["military-2"],
    count: 100,
    packs: GREEN,
    unlocks: [COMBAT_MK1],
  },
  // Синяя и дальше.
  { name: TECH.sensors3, overlay: ICON + "night-vision-equipment.png", prerequisites: [TECH.sensors2, "chemical-science-pack"], count: 250, packs: BLUE, upgrade: true },
  {
    name: TECH.mk3,
    overlay: ICON + "accumulator.png",
    prerequisites: [TECH.mk2, "battery", "chemical-science-pack"],
    count: 300,
    packs: BLUE,
    unlocks: [WORKER_MK3],
  },
  {
    name: TECH.combat2,
    overlay: ICON + "rocket-launcher.png",
    prerequisites: [TECH.combat1, "military-3", "rocketry"],
    count: 200,
    packs: [...BLUE, "military-science-pack"],
    unlocks: [COMBAT_MK2],
  },
  { name: TECH.flying1, overlay: ICON + "flying-robot-frame.png", prerequisites: [TECH.mk3, "robotics"], count: 300, packs: BLUE },
  {
    name: TECH.flying2,
    overlay: ICON + "flying-robot-frame.png",
    prerequisites: [TECH.flying1, "utility-science-pack"],
    count: 500,
    packs: [...BLUE, "utility-science-pack"],
  },
]

// Улучшения (8.3): по 3 уровня, зелёная → синяя → жёлтая наука.
const UPGRADE_ICONS: Record<string, string> = {
  speed: ICON + "exoskeleton-equipment.png",
  cargo: ICON + "wooden-chest.png",
  mining: ICON + "iron-ore.png",
  processor: ICON + "advanced-circuit.png",
  memory: ICON + "processing-unit.png",
  tank: ICON + "storage-tank.png",
}
const UPGRADE_COST: { count: number; packs: Pack[]; prerequisite: string }[] = [
  { count: 100, packs: GREEN, prerequisite: "logistic-science-pack" },
  { count: 200, packs: BLUE, prerequisite: "chemical-science-pack" },
  { count: 400, packs: [...BLUE, "utility-science-pack"], prerequisite: "utility-science-pack" },
]
for (const upgrade of UPGRADES) {
  for (let level = 1; level <= UPGRADE_LEVELS; level++) {
    const cost = UPGRADE_COST[level - 1]
    SPECS.push({
      name: `${upgrade.tech}-${level}`,
      overlay: UPGRADE_ICONS[upgrade.kind],
      prerequisites: level === 1 ? [TECH.radio, cost.prerequisite] : [`${upgrade.tech}-${level - 1}`, cost.prerequisite],
      count: cost.count,
      packs: cost.packs,
      upgrade: true,
      effect: `upgrade-${upgrade.kind}`,
    })
  }
}

/** Ключ описания эффекта: automaton.tech-effect-<имя без префикса>. */
function effectKey(name: string): string {
  const [key] = string.gsub(name, "^automaton%-", "")
  return `automaton.tech-effect-${key}`
}

const technologies: TechnologyPrototype[] = SPECS.map((spec) => {
  const technology: TechnologyPrototype = {
    type: "technology",
    name: spec.name,
    icons: icons(spec.overlay),
    effects: [
      ...(spec.unlocks ?? []).map((recipe) => ({ type: "unlock-recipe" as const, recipe })),
      { type: "nothing", effect_description: spec.effect !== undefined ? [`automaton.tech-effect-${spec.effect}`] : [effectKey(spec.name)], icons: icons(spec.overlay) },
    ],
    prerequisites: spec.prerequisites,
    upgrade: spec.upgrade,
  }
  if (spec.trigger !== undefined) technology.research_trigger = spec.trigger
  else technology.unit = { count: spec.count!, ingredients: spec.packs!.map((p) => [p, 1] as [string, number]), time: spec.time ?? 30 }
  return technology
})

data.extend(technologies)
