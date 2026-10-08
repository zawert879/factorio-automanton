// Полёт летающих машин (этап 11): по прямой, без столкновений и без юнитов. Движение рассчитывается:
// время = расстояние / скорость, машина «просыпается» по прибытии — колесо таймеров по тикам.
// У машины всегда есть сущность-заместитель (её выделяют и открывают окно машины): рядом с игроками
// она каждый тик переставляется в рассчитанную позицию (видно, как машина летит), вдали — стоит, пока
// машина не прилетит. Какие полёты «рядом с игроками», пересчитывается по кругу: 1/60 полётов за тик.
// Энергия на весь путь списывается при вылете; не хватает — машина не взлетает (no-fuel).
import { LuaEntity, MapPosition, PlayerIndex } from "factorio:runtime"
import { onTick } from "../events"
import { directionOf, setActivity } from "./appearance"
import { MOVE_JOULES_PER_TILE, spend } from "./energy"
import { isFlyer, robotSpeed } from "./models"
import { finishMove, registerFlightHooks } from "./movement"
import { RobotRecord } from "./registry"

export interface Flight {
  from: MapPosition
  to: MapPosition
  depart: number
  arrive: number
  /** Итог по прибытии: обычно arrived; no-fuel — не взлетела (итог приходит на следующем тике). */
  result: "arrived" | "no-fuel"
  notifyPlayer?: PlayerIndex
}

export interface FlightState {
  flights: Record<number, Flight | undefined>
  /** Тик прибытия → id машин. */
  timers: Record<number, number[] | undefined>
  /** Полёты рядом с игроками: заместитель переставляется каждый тик. */
  visible: Record<number, boolean | undefined>
  /** Все летящие по кругу для пересчёта «рядом с игроками»; машина → её место в круге. */
  rotation: number[]
  slot: Record<number, number | undefined>
  cursor: number
}

/** Летающей нужно в полёте меньше энергии, чем наземной на ходу: нет трения. */
export const FLY_JOULES_PER_TILE = MOVE_JOULES_PER_TILE / 2
/** Полёт виден игроку, если путь проходит ближе этого (клеток) от него. */
export const DETAIL_RADIUS = 150
const ROTATION_TICKS = 60

export function initFlight(): void {
  storage.flight ??= { flights: {}, timers: {}, visible: {}, rotation: [], slot: {}, cursor: 0 }
  storage.flight.slot ??= {}
}

function distance(a: MapPosition, b: MapPosition): number {
  return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/** Позиция полёта в тик tick. */
function positionAt(flight: Flight, tick: number): MapPosition {
  if (tick >= flight.arrive) return flight.to
  const t = (tick - flight.depart) / (flight.arrive - flight.depart)
  return { x: flight.from.x + (flight.to.x - flight.from.x) * t, y: flight.from.y + (flight.to.y - flight.from.y) * t }
}

/** Где машины сели в этом тике: следующий рейс начнётся оттуда без запроса позиции у движка. */
let landed: { tick: number; at: LuaMap<number, MapPosition> } = { tick: -1, at: new LuaMap() }

/** Где машина сейчас: в полёте — рассчитанная позиция, иначе — позиция сущности. */
export function robotPosition(record: RobotRecord): MapPosition {
  const flight = storage.flight.flights[record.id]
  if (flight !== undefined) return positionAt(flight, game.tick)
  if (landed.tick === game.tick) {
    const at = landed.at.get(record.id)
    if (at !== undefined) return at
  }
  return record.entity.position
}

export function isFlying(record: RobotRecord): boolean {
  return storage.flight.flights[record.id] !== undefined
}

/** Расстояние от точки до отрезка пути полёта. */
function distanceToPath(point: MapPosition, flight: Flight): number {
  const dx = flight.to.x - flight.from.x
  const dy = flight.to.y - flight.from.y
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : math.max(0, math.min(1, ((point.x - flight.from.x) * dx + (point.y - flight.from.y) * dy) / length2))
  return distance(point, { x: flight.from.x + dx * t, y: flight.from.y + dy * t })
}

/** Позиции игроков по поверхностям — один раз за тик (вызовы API дороги, а проверок за тик — тысячи). */
let viewers: { tick: number; bySurface: LuaMap<number, MapPosition[]> } | undefined

function viewersNow(): LuaMap<number, MapPosition[]> {
  if (viewers !== undefined && viewers.tick === game.tick) return viewers.bySurface
  const bySurface = new LuaMap<number, MapPosition[]>()
  for (const player of game.connected_players) {
    const index = player.surface_index
    const list = bySurface.get(index)
    if (list === undefined) bySurface.set(index, [player.position])
    else list.push(player.position)
  }
  viewers = { tick: game.tick, bySurface }
  return bySurface
}

function nearPlayers(record: RobotRecord, flight: Flight): boolean {
  const all = viewersNow()
  // Игроков нет вовсе — и спрашивать поверхность машины незачем.
  if (next(all)[0] === undefined) return false
  const positions = all.get(record.entity.surface_index)
  if (positions === undefined) return false
  for (const position of positions) if (distanceToPath(position, flight) <= DETAIL_RADIUS) return true
  return false
}

function schedule(id: number, tick: number): void {
  const timers = storage.flight.timers
  const list = timers[tick]
  if (list === undefined) timers[tick] = [id]
  else list.push(id)
}

/** Начать полёт (вызывает moveRobot для летающих). Итог — всегда не раньше следующего тика. */
function startFlight(record: RobotRecord, target: { position: MapPosition } | { entity: LuaEntity }, options: { radius?: number; notifyPlayer?: PlayerIndex }): void {
  const state = storage.flight
  const tick = game.tick
  const from = robotPosition(record)
  cancelFlight(record)
  const goal = "entity" in target ? target.entity.position : target.position
  // К зданию — до расстояния radius от него, к точке — в саму точку (или ближе radius).
  const radius = math.min(options.radius ?? ("entity" in target ? 2 : 0.5), distance(from, goal))
  const total = distance(from, goal)
  const to = total <= radius || total === 0 ? from : { x: goal.x + ((from.x - goal.x) * radius) / total, y: goal.y + ((from.y - goal.y) * radius) / total }
  const length = distance(from, to)
  const enough = spend(record, length * FLY_JOULES_PER_TILE)
  const flight: Flight = enough
    ? { from, to, depart: tick, arrive: tick + math.max(1, math.ceil(length / robotSpeed(record))), result: "arrived", notifyPlayer: options.notifyPlayer }
    : { from, to: from, depart: tick, arrive: tick + 1, result: "no-fuel", notifyPlayer: options.notifyPlayer }
  state.flights[record.id] = flight
  schedule(record.id, flight.arrive)
  if (state.slot[record.id] === undefined) {
    state.rotation.push(record.id)
    state.slot[record.id] = state.rotation.length - 1
  }
  if (enough && length > 0) {
    const orientation = (math.atan2(to.x - from.x, -(to.y - from.y)) / (2 * math.pi) + 1) % 1
    setActivity(record, "run", directionOf(orientation))
    if (nearPlayers(record, flight)) state.visible[record.id] = true
  }
}

/** Убрать машину из круга: на её место — последнюю (O(1)). */
function leaveRotation(id: number): void {
  const state = storage.flight
  const slot = state.slot[id]
  if (slot === undefined) return
  const rotation = state.rotation
  const last = rotation.length - 1
  const moved = rotation[last]
  rotation[slot] = moved
  state.slot[moved] = slot
  rotation.pop()
  state.slot[id] = undefined
  state.visible[id] = undefined
}

/** Прервать полёт: машина остаётся там, где её застали. */
function cancelFlight(record: RobotRecord): boolean {
  const state = storage.flight
  const flight = state.flights[record.id]
  if (flight === undefined) return false
  const here = positionAt(flight, game.tick)
  state.flights[record.id] = undefined
  leaveRotation(record.id)
  if (record.entity.valid) record.entity.teleport(here)
  return true
}

function arrive(id: number, tick: number): void {
  const state = storage.flight
  const flight = state.flights[id]
  if (flight === undefined || flight.arrive !== tick) return
  state.flights[id] = undefined
  leaveRotation(id)
  const record = storage.robots.byId[id]
  if (record === undefined || !record.entity.valid) return
  record.entity.teleport(flight.to)
  if (landed.tick !== tick) landed = { tick, at: new LuaMap() }
  landed.at.set(id, flight.to)
  finishMove(id, flight.result, flight.notifyPlayer)
}

/**
 * Пересчитать «рядом с игроками» для части полётов (по кругу). Без игроков — ничего: видимых нет,
 * а из круга машины уходят сами при посадке.
 */
function rotate(): void {
  const state = storage.flight
  const rotation = state.rotation
  const count = rotation.length
  if (count === 0) return
  if (next(viewersNow())[0] === undefined) {
    if (next(state.visible)[0] !== undefined) state.visible = {}
    return
  }
  let cursor = state.cursor
  for (let budget = math.ceil(count / ROTATION_TICKS); budget > 0; budget--) {
    if (cursor >= count) cursor = 0
    const id = rotation[cursor]
    const flight = state.flights[id]
    const record = storage.robots.byId[id]
    if (flight !== undefined && record !== undefined && record.entity.valid) state.visible[id] = nearPlayers(record, flight) ? true : undefined
    cursor++
  }
  state.cursor = cursor
}

function updateVisible(tick: number): void {
  const state = storage.flight
  for (const [id] of pairs(state.visible)) {
    const flight = state.flights[id]
    const record = storage.robots.byId[id]
    if (flight === undefined || record === undefined || !record.entity.valid) {
      state.visible[id] = undefined
      continue
    }
    record.entity.teleport(positionAt(flight, tick))
  }
}

export function registerFlight(): void {
  registerFlightHooks({
    isFlyer: (record) => isFlyer(record),
    start: (record, target, options) => startFlight(record, target, options),
    cancel: (record) => cancelFlight(record),
    isMoving: (record) => isFlying(record),
  })
  onTick((tick) => {
    const state = storage.flight
    const due = state.timers[tick]
    if (due !== undefined) {
      state.timers[tick] = undefined
      for (const id of due) arrive(id, tick)
    }
    rotate()
    updateVisible(tick)
  })
}
