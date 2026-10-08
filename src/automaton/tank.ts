// Бак машины (этап 7): одна жидкость с температурой; смешивание одной жидкости — средняя температура
// по объёму. Отдельно от действий (src/automaton/fluids.ts), чтобы добыча урана (mining.ts) брала
// кислоту из бака без цикла модулей.
import type { RobotRecord } from "./registry"

/** Бак Mk1 (растёт исследованиями — этап 8.3). */
export const TANK_CAPACITY = 1000
export const EPSILON = 1e-6

export interface Tank {
  fluid?: string
  amount: number
  temperature: number
}

export function newTank(): Tank {
  return { amount: 0, temperature: 15 }
}

export function tankOf(record: RobotRecord): Tank {
  record.tank ??= newTank()
  return record.tank
}

export function tankCapacity(_record: RobotRecord): number {
  return TANK_CAPACITY
}

/** Сколько ещё этой жидкости влезет в бак (0 — бак занят другой). */
export function tankFree(record: RobotRecord, fluid: string): number {
  const tank = tankOf(record)
  if (tank.amount > EPSILON && tank.fluid !== fluid) return 0
  return math.max(0, tankCapacity(record) - tank.amount)
}

/** Налить в бак; возвращает, сколько вошло. */
export function addToTank(record: RobotRecord, fluid: string, amount: number, temperature: number): number {
  const tank = tankOf(record)
  const n = math.min(amount, tankFree(record, fluid))
  if (n <= 0) return 0
  tank.temperature = tank.amount > EPSILON ? (tank.temperature * tank.amount + temperature * n) / (tank.amount + n) : temperature
  tank.fluid = fluid
  tank.amount += n
  return n
}

/** Отлить из бака (если в нём эта жидкость); возвращает, сколько отлито. */
export function takeFromTank(record: RobotRecord, fluid: string, amount: number): number {
  const tank = tankOf(record)
  if (tank.fluid !== fluid) return 0
  const n = math.min(amount, tank.amount)
  tank.amount -= n
  if (tank.amount <= EPSILON) {
    tank.amount = 0
    tank.fluid = undefined
  }
  return n
}
