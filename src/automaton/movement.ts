// Движение машин: поездка к точке или к зданию. Путь ищет и машину ведёт движок
// (команда go_to_location юниту, ответ — событие on_ai_command_completed).
//
// Фазы поездки: queued (ждёт отправки) → going (едет) → при неудаче sidestep (шаг в сторону) →
// waiting (пауза) → снова queued. Новые поездки отдаются движку не больше DISPATCH_PER_TICK за тик.
//
// Неудачи двух видов:
// - отказ движка, а машина с места не сдвинулась — скорее всего, цели не достичь: мало повторов;
// - застряла по дороге (пробка, отказ движка в толпе, нет продвижения) — повторов больше,
//   а продвижение сбрасывает счётчик.
// Шаг в сторону у разных машин в разные стороны, пауза разной длины — так расходятся встречные.
import { LuaEntity, MapPosition, PlayerIndex } from "factorio:runtime"
import { onTick } from "../events"
import { directionOf, setActivity } from "./appearance"
import { hasEnergy, MOVE_JOULES_PER_TILE, spend } from "./energy"
import { RobotRecord } from "./registry"
import { problemFor, showProblem } from "./status"

export type MoveResult = "arrived" | "no-path" | "stuck" | "no-fuel"

type Phase = "queued" | "going" | "sidestep" | "waiting"

export interface MoveOrder {
  destination?: MapPosition
  destinationEntity?: LuaEntity
  radius: number
  phase: Phase
  /** Неудачи подряд: без продвижения (пробка) и отказы поиска пути с места. */
  stuckRetries: number
  pathRetries: number
  /** Тик отправки движку текущей попытки и позиция машины в этот момент. */
  dispatchedTick?: number
  dispatchedPosition?: MapPosition
  deadlineTick?: number
  /** Где была машина при последней проверке продвижения и когда. */
  checkPosition?: MapPosition
  checkTick?: number
  /** Откуда считать пройденный путь для расхода энергии. */
  energyPosition?: MapPosition
  /** Шаг в сторону начат / пауза до этого тика. */
  sidestepTick?: number
  waitUntilTick?: number
  /** Кому сообщить результат (игрок, отдавший приказ отладочной командой). */
  notifyPlayer?: PlayerIndex
}

export interface MovementState {
  orders: Record<number, MoveOrder | undefined>
  /** id машин, ждущих отправки приказа движку, по порядку. */
  queue: number[]
  /** Последний результат поездки каждой машины. */
  lastResult: Record<number, MoveResult | undefined>
}

const DISPATCH_PER_TICK = 20
/** Скорость машины (клеток за тик) — как movement_speed в прототипе. */
const SPEED = 0.1
/** Время на поиск пути и объезды сверх прямой дороги. */
const TIME_MARGIN_TICKS = 600
const CHECK_EVERY_TICKS = 15
const PROGRESS_CHECK_TICKS = 300
const MIN_PROGRESS = 1
const MAX_STUCK_RETRIES = 5
const MAX_PATH_RETRIES = 2
const SIDESTEP_DISTANCE = 2.5
const SIDESTEP_TIMEOUT_TICKS = 120

export function initMovement(): void {
  storage.movement ??= { orders: {}, queue: [], lastResult: {} }
}

function distance(a: MapPosition, b: MapPosition): number {
  return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/** Отправить машину к точке или зданию. Прежняя поездка отменяется. */
export function moveRobot(
  record: RobotRecord,
  target: { position: MapPosition } | { entity: LuaEntity },
  options: { radius?: number; notifyPlayer?: PlayerIndex } = {},
): void {
  const state = storage.movement
  const common = { phase: "queued" as Phase, stuckRetries: 0, pathRetries: 0, notifyPlayer: options.notifyPlayer }
  const order: MoveOrder =
    "entity" in target
      ? { ...common, destinationEntity: target.entity, radius: options.radius ?? 2 }
      : { ...common, destination: target.position, radius: options.radius ?? 1 }
  // В очередь — если машина ещё не ждёт отправки.
  if (state.orders[record.id]?.phase !== "queued") state.queue.push(record.id)
  state.orders[record.id] = order
  state.lastResult[record.id] = undefined
  showProblem(record, undefined)
}

/** Отменить поездку без итога (машина займётся другим). */
export function cancelMove(record: RobotRecord): void {
  const state = storage.movement
  if (state.orders[record.id] === undefined) return
  state.orders[record.id] = undefined
  if (record.entity.valid) stopCommand(record)
}

export function isMoving(record: RobotRecord): boolean {
  return storage.movement.orders[record.id] !== undefined
}

/** Машина сейчас едет (а не ждёт в очереди, не отступает и не стоит на паузе). */
export function isGoing(record: RobotRecord): boolean {
  return storage.movement.orders[record.id]?.phase === "going"
}

export function lastMoveResult(record: RobotRecord): MoveResult | undefined {
  return storage.movement.lastResult[record.id]
}

function stopCommand(record: RobotRecord): void {
  record.entity.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
}

function finish(id: number, result: MoveResult): void {
  const state = storage.movement
  const order = state.orders[id]
  state.orders[id] = undefined
  state.lastResult[id] = result
  const record = storage.robots.byId[id]
  if (record === undefined || !record.entity.valid) return
  stopCommand(record)
  setActivity(record, "idle")
  showProblem(record, result === "arrived" ? undefined : problemFor(result))
  if (order?.notifyPlayer !== undefined) {
    game.get_player(order.notifyPlayer)?.print([`automaton.move-${result}`, record.name])
  }
}

/** Детерминированный «случайный» номер для машины и попытки — чтобы встречные расходились по-разному. */
function spread(id: number, attempt: number, range: number): number {
  return (id * 7919 + attempt * 104729) % range
}

function onFailure(id: number, record: RobotRecord, order: MoveOrder, tick: number, kind: "no-path" | "stuck"): void {
  const movedSinceDispatch = distance(record.entity.position, order.dispatchedPosition!)
  if (kind === "no-path" && movedSinceDispatch < 0.5) order.pathRetries++
  else order.stuckRetries++
  if (order.pathRetries > MAX_PATH_RETRIES) return finish(id, "no-path")
  if (order.stuckRetries > MAX_STUCK_RETRIES) return finish(id, "stuck")

  // Шаг в сторону: направление зависит от машины и номера попытки.
  const attempt = order.pathRetries + order.stuckRetries
  const angle = (spread(id, attempt, 8) / 8) * 2 * math.pi
  const position = record.entity.position
  const aside = { x: position.x + math.cos(angle) * SIDESTEP_DISTANCE, y: position.y + math.sin(angle) * SIDESTEP_DISTANCE }
  record.entity.commandable!.set_command({
    type: defines.command.go_to_location,
    destination: aside,
    radius: 1,
    distraction: defines.distraction.none,
  })
  order.phase = "sidestep"
  order.sidestepTick = tick
}

function startWaiting(id: number, record: RobotRecord, order: MoveOrder, tick: number): void {
  setActivity(record, "idle")
  order.phase = "waiting"
  order.waitUntilTick = tick + 30 + spread(id, order.pathRetries + order.stuckRetries, 240)
}

function dispatch(tick: number): void {
  const state = storage.movement
  let sent = 0
  while (sent < DISPATCH_PER_TICK && state.queue.length > 0) {
    const id = state.queue.shift()!
    const order = state.orders[id]
    if (order === undefined || order.phase !== "queued") continue
    const record = storage.robots.byId[id]
    if (record === undefined || !record.entity.valid) {
      state.orders[id] = undefined
      continue
    }
    const target = order.destinationEntity
    if (target !== undefined && !target.valid) {
      finish(id, "no-path")
      continue
    }
    if (!hasEnergy(record)) {
      finish(id, "no-fuel")
      continue
    }
    const destination = target?.position ?? order.destination!
    record.entity.commandable!.set_command({
      type: defines.command.go_to_location,
      destination: target === undefined ? destination : undefined,
      destination_entity: target,
      radius: order.radius,
      distraction: defines.distraction.none,
      pathfind_flags: { cache: true },
    })
    setActivity(record, "run", directionOf(record.entity.orientation))
    const position = record.entity.position
    order.phase = "going"
    order.dispatchedTick = tick
    order.dispatchedPosition = position
    order.deadlineTick = tick + math.ceil(distance(position, destination) / SPEED) * 2 + TIME_MARGIN_TICKS
    order.checkPosition = position
    order.checkTick = tick
    order.energyPosition ??= position
    sent++
  }
}

/** Проверки по таймерам: продвижение и срок у едущих, конец шага в сторону и паузы. */
function checkOrders(tick: number): void {
  const state = storage.movement
  for (const [key, order] of Object.entries(state.orders)) {
    if (order === undefined || order.phase === "queued") continue
    const id = tonumber(key)!
    const record = storage.robots.byId[id]
    if (record === undefined || !record.entity.valid) {
      state.orders[id] = undefined
      continue
    }
    // Пройденный путь (и при шаге в сторону) — расход энергии; не хватило — машина встаёт.
    if ((order.phase === "going" || order.phase === "sidestep") && order.energyPosition !== undefined) {
      const position = record.entity.position
      if (!spend(record, distance(position, order.energyPosition) * MOVE_JOULES_PER_TILE)) {
        finish(id, "no-fuel")
        continue
      }
      order.energyPosition = position
    }
    if (order.phase === "going") {
      if (distance(record.entity.position, order.checkPosition!) >= MIN_PROGRESS) {
        order.checkPosition = record.entity.position
        order.checkTick = tick
        order.stuckRetries = 0
      } else if (tick - order.checkTick! >= PROGRESS_CHECK_TICKS || tick >= order.deadlineTick!) {
        onFailure(id, record, order, tick, "stuck")
      }
    } else if (order.phase === "sidestep") {
      if (tick - order.sidestepTick! >= SIDESTEP_TIMEOUT_TICKS) startWaiting(id, record, order, tick)
    } else if (order.phase === "waiting") {
      if (tick >= order.waitUntilTick!) {
        order.phase = "queued"
        state.queue.push(id)
      }
    }
  }
}

function onCommandCompleted(unitNumber: number, result: defines.behavior_result, tick: number): void {
  // deleted — команду заменили новой (новая попытка или новая поездка); её ответ придёт отдельно.
  if (result === defines.behavior_result.deleted) return
  const id = storage.robots.idByUnit[unitNumber]
  if (id === undefined) return
  const order = storage.movement.orders[id]
  const record = storage.robots.byId[id]
  if (order === undefined || record === undefined) return
  if (order.phase === "sidestep") {
    startWaiting(id, record, order, tick)
  } else if (order.phase === "going") {
    if (result === defines.behavior_result.success) finish(id, "arrived")
    else onFailure(id, record, order, tick, "no-path")
  }
}

export function registerMovement(): void {
  onTick((tick) => {
    if (storage.movement.queue.length > 0) dispatch(tick)
    if (tick % CHECK_EVERY_TICKS === 0) checkOrders(tick)
  })
  script.on_event(defines.events.on_ai_command_completed, (e) => onCommandCompleted(e.unit_number, e.result, e.tick))
}
