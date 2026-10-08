// Энергия машины Mk1: запас в джоулях тратится на путь и действия; кончился — сжигается предмет
// из топливного слота. Из груза машина сама не заправляется — это действие refuel (решение программы).
// Нет ни запаса, ни топлива — машина встаёт: поездка и действие заканчиваются «кончилось топливо».
// Без импорта actions: движение (его импортирует actions) тоже тратит энергию — иначе цикл модулей.
import { modelOf } from "../names"
import type { RobotRecord } from "./registry"

/** Путь: 75 кВт на ходу (6 клеток в секунду). */
export const MOVE_JOULES_PER_TILE = 12_500
/** Добыча: 150 кВт. */
export const MINING_WATTS = 150_000
/** Одна перекладка (взять, положить, подобрать, передать, починить — за шаг). */
export const HANDLING_JOULES = 10_000

export function fuelValue(item: string): number {
  return prototypes.item[item]?.fuel_value ?? 0
}

/**
 * Потратить энергию: из запаса, при нехватке — сжигая топливо из слота. false — не хватило
 * (запас обнуляется: машина выдохлась).
 */
export function spend(record: RobotRecord, joules: number): boolean {
  // Mk2+ — аккумулятор: топливо не жгут, заряжаются на станции (charge).
  if (modelOf(record.model)?.battery !== undefined) {
    if (record.energy < joules) {
      record.energy = 0
      return false
    }
    record.energy -= joules
    return true
  }
  while (record.energy < joules) {
    const stack = record.fuel[0]
    if (!stack.valid_for_read) {
      record.energy = 0
      return false
    }
    record.energy += fuelValue(stack.name)
    stack.count -= 1
  }
  record.energy -= joules
  return true
}

/** Есть ли у машины хоть какая-то энергия (запас или топливо в слоте). */
export function hasEnergy(record: RobotRecord): boolean {
  return record.energy > 0 || record.fuel[0].valid_for_read
}
