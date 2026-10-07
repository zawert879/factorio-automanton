// Действия машины: добыть, взять, положить, подобрать… У машины одно текущее действие.
// Действие идёт шагами: каждый шаг назначен на тик (таймеры разложены по тикам — каждый тик
// обрабатываются только машины, у которых шаг созрел). Обработчики видов действий регистрируются
// при загрузке (registerActionHandler) — одинаково у всех игроков; в storage — только данные.
// Начало действия останавливает движение; досягаемость проверяет обработчик на каждом шаге.
import { LocalisedString, LuaEntity, MapPosition, PlayerIndex } from "factorio:runtime"
import { onTick } from "../events"
import { directionOf, setActivity } from "./appearance"
import { cancelMove } from "./movement"
import { RobotRecord } from "./registry"

export type ActionKind = "wait" | "mine" | "take" | "put" | "pickup" | "drop" | "give" | "repair" | "refuel"

export type ActionError =
  | "out-of-reach"
  | "invalid-target"
  | "no-resource"
  | "cargo-full"
  | "not-enough-items"
  | "target-full"
  | "no-fuel"
  | "cancelled"
  /** Ошибка в коде мода при выполнении действия (записана в лог); машина продолжает работать. */
  | "internal-error"

/** Параметры действия — простые данные и ссылки на объекты игры (лежат в storage). */
export interface ActionParams {
  target?: LuaEntity
  item?: string
  count?: number
  seconds?: number
}

export interface ActionState {
  kind: ActionKind
  params: ActionParams
  startTick: number
  /** Тик следующего шага. */
  nextTick: number
  /** Сколько сделано (предметов перенесено, единиц добыто…). */
  done: number
  notifyPlayer?: PlayerIndex
}

/**
 * Итог действия. error — сделать ничего нельзя (далеко, нет цели, груз полон с самого начала…);
 * reason — сделано меньше просимого, но это успех (груз заполнился, месторождение кончилось…).
 */
export interface ActionResult {
  kind: ActionKind
  ok: boolean
  /** Сколько сделано — и при успехе, и при ошибке. */
  count: number
  error?: ActionError
  reason?: ActionError
}

export interface ActionsState {
  current: Record<number, ActionState | undefined>
  lastResult: Record<number, ActionResult | undefined>
  /** Тик → id машин, у которых на этот тик назначен шаг. */
  timers: Record<number, number[] | undefined>
}

/** Шаг действия: «ещё через столько тиков» или итог (ошибка либо причина неполного успеха). */
export type StepOutcome = { after: number } | { finish: true; error?: ActionError; reason?: ActionError }

export interface ActionHandler {
  /** Проверить и начать. Возвращает первый шаг (через сколько тиков) или ошибку. */
  start: (this: void, record: RobotRecord, action: ActionState, tick: number) => StepOutcome
  /** Очередной шаг (назначенный тик наступил). */
  step: (this: void, record: RobotRecord, action: ActionState, tick: number) => StepOutcome
}

const handlers: Partial<Record<ActionKind, ActionHandler>> = {}

export function registerActionHandler(kind: ActionKind, handler: ActionHandler): void {
  handlers[kind] = handler
}

export function initActions(): void {
  storage.actions ??= { current: {}, lastResult: {}, timers: {} }
}

export function currentAction(record: RobotRecord): ActionState | undefined {
  return storage.actions.current[record.id]
}

export function lastActionResult(record: RobotRecord): ActionResult | undefined {
  return storage.actions.lastResult[record.id]
}

function schedule(id: number, tick: number): void {
  const timers = storage.actions.timers
  const list = timers[tick]
  if (list === undefined) timers[tick] = [id]
  else list.push(id)
}

function finish(record: RobotRecord, action: ActionState, error: ActionError | undefined, reason?: ActionError): void {
  const state = storage.actions
  state.current[record.id] = undefined
  const result: ActionResult = { kind: action.kind, ok: error === undefined, count: action.done, error, reason }
  state.lastResult[record.id] = result
  if (record.entity.valid) setActivity(record, "idle")
  if (action.notifyPlayer !== undefined) {
    const kind: LocalisedString = [`automaton-action.${action.kind}`]
    const message: LocalisedString =
      error !== undefined
        ? ["automaton.action-failed", record.name, kind, [`automaton-error.${error}`], action.done]
        : reason !== undefined
          ? ["automaton.action-done-reason", record.name, kind, action.done, [`automaton-error.${reason}`]]
          : ["automaton.action-done", record.name, kind, action.done]
    game.get_player(action.notifyPlayer)?.print(message)
  }
}

/**
 * Вызвать обработчик под защитой: ошибка в коде одного действия не должна ронять мод —
 * действие завершается с internal-error, подробности — в лог.
 */
function guarded(record: RobotRecord, action: ActionState, call: () => StepOutcome): StepOutcome {
  try {
    return call()
  } catch (problem) {
    log(`automaton: ошибка в действии ${action.kind} машины ${record.name}: ${tostring(problem)}`)
    return { finish: true, error: "internal-error" }
  }
}

function apply(record: RobotRecord, action: ActionState, outcome: StepOutcome, tick: number): void {
  if ("finish" in outcome) {
    finish(record, action, outcome.error, outcome.reason)
  } else {
    action.nextTick = tick + math.max(1, outcome.after)
    schedule(record.id, action.nextTick)
  }
}

/** Начать действие. Текущее действие отменяется, движение останавливается. */
export function startAction(
  record: RobotRecord,
  kind: ActionKind,
  params: ActionParams,
  options: { notifyPlayer?: PlayerIndex } = {},
): void {
  const handler = handlers[kind]
  if (handler === undefined) error(`automaton: нет обработчика действия ${kind}`)
  cancelAction(record)
  cancelMove(record)
  const tick = game.tick
  const action: ActionState = { kind, params, startTick: tick, nextTick: tick, done: 0, notifyPlayer: options.notifyPlayer }
  storage.actions.current[record.id] = action
  storage.actions.lastResult[record.id] = undefined
  apply(record, action, guarded(record, action, () => handler.start(record, action, tick)), tick)
}

/** Отменить текущее действие (итог — ошибка cancelled с тем, что успело сделаться). */
export function cancelAction(record: RobotRecord): void {
  const action = storage.actions.current[record.id]
  if (action !== undefined) finish(record, action, "cancelled")
}

function runTimers(tick: number): void {
  const state = storage.actions
  const ids = state.timers[tick]
  if (ids === undefined) return
  state.timers[tick] = undefined
  for (const id of ids) {
    const action = state.current[id]
    if (action === undefined || action.nextTick !== tick) continue
    const record = storage.robots.byId[id]
    if (record === undefined || !record.entity.valid) {
      state.current[id] = undefined
      continue
    }
    const handler = handlers[action.kind]!
    apply(record, action, guarded(record, action, () => handler.step(record, action, tick)), tick)
  }
}

/** Расстояние от точки до прямоугольника сущности (0 — внутри). Досягаемость меряется до края, как у персонажа. */
export function distanceToEntity(position: MapPosition, entity: LuaEntity): number {
  const box = entity.bounding_box
  const dx = math.max(box.left_top.x - position.x, 0, position.x - box.right_bottom.x)
  const dy = math.max(box.left_top.y - position.y, 0, position.y - box.right_bottom.y)
  return math.sqrt(dx * dx + dy * dy)
}

/** Повернуть машину лицом к точке и показать занятие. */
export function face(record: RobotRecord, toward: MapPosition, activity: "idle" | "mine"): void {
  const { x, y } = record.entity.position
  const dx = toward.x - x
  const dy = toward.y - y
  if (dx === 0 && dy === 0) return setActivity(record, activity)
  // Ориентация Factorio: 0 — север, по часовой стрелке; ось y направлена вниз.
  const orientation = (math.atan2(dx, -dy) / (2 * math.pi) + 1) % 1
  setActivity(record, activity, directionOf(orientation))
}

// Простейшее действие — подождать: пригодится программам и тестам.
registerActionHandler("wait", {
  start: (_record, action) => ({ after: math.max(1, math.floor((action.params.seconds ?? 1) * 60)) }),
  step: () => ({ finish: true }),
})

export function registerActions(): void {
  onTick((tick) => runTimers(tick))
}
