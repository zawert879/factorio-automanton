// Движение машин: поездка к точке или к зданию. Путь ищет и машину ведёт движок
// (команда go_to_location юниту, ответ — событие on_ai_command_completed).
// Новые поездки отдаются движку не больше DISPATCH_PER_TICK за тик — чтобы сотня одновременных
// приказов не забивала поиск пути. Застрявшие (нет продвижения, вышло время) снимаются с поездки.
import { LuaEntity, MapPosition, PlayerIndex } from "factorio:runtime"
import { onTick } from "../events"
import { directionOf, setActivity } from "./appearance"
import { RobotRecord } from "./registry"

export type MoveResult = "arrived" | "no-path" | "stuck"

export interface MoveOrder {
  destination?: MapPosition
  destinationEntity?: LuaEntity
  radius: number
  /** Тик, когда приказ отдан движку; до этого поездка ждёт в очереди. */
  dispatchedTick?: number
  deadlineTick?: number
  /** Где была машина при последней проверке продвижения и когда. */
  checkPosition?: MapPosition
  checkTick?: number
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
const PROGRESS_CHECK_TICKS = 300
const MIN_PROGRESS = 1

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
  const order: MoveOrder =
    "entity" in target
      ? { destinationEntity: target.entity, radius: options.radius ?? 2, notifyPlayer: options.notifyPlayer }
      : { destination: target.position, radius: options.radius ?? 1, notifyPlayer: options.notifyPlayer }
  // В очередь — если машина ещё не ждёт отправки (едущая получает новый приказ через очередь заново).
  const previous = state.orders[record.id]
  if (previous === undefined || previous.dispatchedTick !== undefined) state.queue.push(record.id)
  state.orders[record.id] = order
  state.lastResult[record.id] = undefined
}

export function isMoving(record: RobotRecord): boolean {
  return storage.movement.orders[record.id] !== undefined
}

export function lastMoveResult(record: RobotRecord): MoveResult | undefined {
  return storage.movement.lastResult[record.id]
}

function finish(id: number, result: MoveResult): void {
  const state = storage.movement
  const order = state.orders[id]
  state.orders[id] = undefined
  state.lastResult[id] = result
  const record = storage.robots.byId[id]
  if (record === undefined || !record.entity.valid) return
  record.entity.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
  setActivity(record, "idle")
  if (order?.notifyPlayer !== undefined) {
    game.get_player(order.notifyPlayer)?.print([`automaton.move-${result}`, record.name])
  }
}

function dispatch(tick: number): void {
  const state = storage.movement
  let sent = 0
  while (sent < DISPATCH_PER_TICK && state.queue.length > 0) {
    const id = state.queue.shift()!
    const order = state.orders[id]
    const record = storage.robots.byId[id]
    if (order === undefined) continue
    if (record === undefined || !record.entity.valid) {
      state.orders[id] = undefined
      continue
    }
    const target = order.destinationEntity
    if (target !== undefined && !target.valid) {
      finish(id, "no-path")
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
    order.dispatchedTick = tick
    order.deadlineTick = tick + math.ceil(distance(record.entity.position, destination) / SPEED) * 2 + TIME_MARGIN_TICKS
    order.checkPosition = record.entity.position
    order.checkTick = tick
    sent++
  }
}

/** Раз в секунду: снять с поездки тех, кто давно не продвигается или не успел к сроку. */
function checkProgress(tick: number): void {
  const state = storage.movement
  for (const [key, order] of Object.entries(state.orders)) {
    if (order === undefined || order.dispatchedTick === undefined) continue
    const id = tonumber(key)!
    const record = storage.robots.byId[id]
    if (record === undefined || !record.entity.valid) {
      state.orders[id] = undefined
      continue
    }
    if (tick >= order.deadlineTick!) {
      finish(id, "stuck")
    } else if (tick - order.checkTick! >= PROGRESS_CHECK_TICKS) {
      if (distance(record.entity.position, order.checkPosition!) < MIN_PROGRESS) {
        finish(id, "stuck")
      } else {
        order.checkPosition = record.entity.position
        order.checkTick = tick
      }
    }
  }
}

function onCommandCompleted(unitNumber: number, result: defines.behavior_result): void {
  // deleted — команду заменили новой (новая поездка); её ответ придёт отдельно.
  if (result === defines.behavior_result.deleted) return
  const id = storage.robots.idByUnit[unitNumber]
  if (id === undefined || storage.movement.orders[id]?.dispatchedTick === undefined) return
  finish(id, result === defines.behavior_result.success ? "arrived" : "no-path")
}

export function registerMovement(): void {
  onTick((tick) => {
    if (storage.movement.queue.length > 0) dispatch(tick)
    if (tick % 60 === 0) checkProgress(tick)
  })
  script.on_event(defines.events.on_ai_command_completed, (e) => onCommandCompleted(e.unit_number, e.result))
}

