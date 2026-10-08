// Контекст исполнения: какая машина сейчас исполняет программу. Функции API читают его, чтобы знать,
// чьи руки, глаза и груз. Устанавливает планировщик перед отрезком и снимает после.
import { RobotRecord } from "../automaton/registry"
import { err, makeError, Val } from "../lang/runtime/core"
import type { MachineRecord } from "./machines"

export const context: { robot?: RobotRecord; machine?: MachineRecord } = {}

/** Машина, исполняющая программу (функции API вызываются только из программ). */
export function currentRobot(): RobotRecord {
  const robot = context.robot
  if (robot === undefined || !robot.entity.valid) err("bad-argument", "no robot is running")
  return robot
}

export function currentMachine(): MachineRecord {
  const machine = context.machine
  if (machine === undefined) err("bad-argument", "no robot is running")
  return machine
}

/** Коды ActionError (docs/API.md, «Ошибки»). */
export type ActionErrorCode =
  | "no-path"
  | "stuck"
  | "out-of-reach"
  | "out-of-sight"
  | "invalid-target"
  | "no-fuel"
  | "no-ammo"
  | "cargo-full"
  | "not-enough-items"
  | "target-full"
  | "no-resource"
  | "not-researched"
  | "timeout"
  | "cancelled"
  | "not-serializable"
  | "limit-exceeded"
  | "internal-error"

const MESSAGES: Record<ActionErrorCode, string> = {
  "no-path": "No path to the target",
  stuck: "The robot is stuck",
  "out-of-reach": "The target is out of reach: move closer first",
  "out-of-sight": "The target is out of sight",
  "invalid-target": "The target does not exist",
  "no-fuel": "Out of fuel",
  "no-ammo": "Out of ammo",
  "cargo-full": "Cargo is full",
  "not-enough-items": "Not enough items",
  "target-full": "The target is full",
  "no-resource": "No such resource nearby",
  "not-researched": "Not researched yet",
  timeout: "Timed out",
  cancelled: "The action was cancelled",
  "not-serializable": "Functions and class instances cannot be stored or sent",
  "limit-exceeded": "Limit exceeded",
  "internal-error": "Internal error",
}

export function actionErrorValue(code: ActionErrorCode, detail?: string): Val {
  const message = MESSAGES[code] ?? code
  return makeError("ActionError", detail !== undefined ? `${message}: ${detail}` : message, code)
}

/** Бросить ActionError в программу. */
export function actionError(code: ActionErrorCode, detail?: string): never {
  error(actionErrorValue(code, detail), 0)
}
