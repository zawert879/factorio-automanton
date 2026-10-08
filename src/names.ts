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
