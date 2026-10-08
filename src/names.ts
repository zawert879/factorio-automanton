// Имена прототипов и ключей мода — общие для data и control.
export const WORKER_MK1 = "automaton-worker-mk1"
export const WORKER_MK1_PLACER = "automaton-worker-mk1-placer"
export const ROBOT_TAG = "automaton"
/** Метка — сущность с именем, к которой программы обращаются marker("имя"). */
export const MARKER = "automaton-marker"
/** «Программатор» — инструмент выделения зон: zone("имя"). */
export const PROGRAMMER = "automaton-programmer"

/** Что делает машина — от этого зависит анимация её тела. */
export type Activity = "idle" | "run" | "mine"
export const ACTIVITIES: readonly Activity[] = ["idle", "run", "mine"]
/** Направлений у анимаций тела: 0 — север, дальше по часовой стрелке через 45°. */
export const BODY_DIRECTIONS = 8

/** Имя прототипа анимации тела машины. */
export function bodyAnimationName(activity: Activity, direction: number): string {
  return `${WORKER_MK1}-${activity}-${direction}`
}

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
