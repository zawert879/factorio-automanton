// Общее для функций API: ожидание (блокирующие вызовы), действия, проверка аргументов.
import { ActionKind, ActionParams, currentAction, lastActionResult, startAction } from "../../automaton/actions"
import { err, program, Q, Val, Y } from "../../lang/runtime/core"
import { actionError, actionErrorValue, ActionErrorCode, currentRobot } from "../context"

/** Начать ожидание: программа встанет на паузу, кадр ожидания {__host = имя} завершит игра. */
export function startWaiting(name: string, init?: (this: void, frame: Val) => void): LuaMultiReturn<[Val, Val?]> {
  if (program().sync() > 0) err("action-in-callback")
  const frame: Val = { __host: name }
  if (init !== undefined) init(frame)
  Q.w = frame
  return $multi(Y, frame)
}

/** Продолжение после ожидания: результат или ошибка, записанные в кадр. */
export function finishWaiting(k: Val): LuaMultiReturn<[Val, Val?]> {
  if (k.error !== undefined) error(k.error, 0)
  return $multi(k.result)
}

/** Действие системы действий (этап 2): результат — сколько сделано, неудача — ActionError. */
export function actionCall(k: Val, kind: ActionKind, params: ActionParams): LuaMultiReturn<[Val, Val?]> {
  if (k !== undefined) return finishWaiting(k)
  if (program().sync() > 0) err("action-in-callback")
  const robot = currentRobot()
  startAction(robot, kind, params)
  // Действие могло закончиться сразу (цель далеко, нечего делать) — тогда без паузы.
  if (currentAction(robot) === undefined) {
    const result = lastActionResult(robot)!
    if (result.error !== undefined) error(actionErrorValue(result.error as ActionErrorCode), 0)
    return $multi(result.count)
  }
  return startWaiting(kind, (frame) => (frame.__action = kind))
}

/** Имя предмета (проверка, что такой есть). */
export function item(value: Val): string {
  if (type(value) !== "string" || prototypes.item[value as string] === undefined) actionError("invalid-target", `unknown item ${tostring(value)}`)
  return value as string
}

export function optionalItem(value: Val): string | undefined {
  return value === undefined ? undefined : item(value)
}

/** Количество: положительное целое или undefined («сколько получится»). */
export function count(value: Val): number | undefined {
  if (value === undefined) return undefined
  if (type(value) !== "number" || value !== value || value < 0) actionError("invalid-target", `bad count ${tostring(value)}`)
  return math.floor(value as number)
}

/** Секунды → тики (не меньше одного). */
export function ticks(seconds: Val, fallback: number): number {
  const s = type(seconds) === "number" && seconds === seconds ? (seconds as number) : fallback
  return math.max(1, math.floor(s * 60 + 0.5))
}

export function text(value: Val): string {
  return type(value) === "string" ? (value as string) : tostring(value)
}
