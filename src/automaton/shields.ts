// Щиты (22.5): энергощиты в сетке модульной и силовой брони машины. Сетка брони в слоте машины игрой не питается,
// поэтому щит считает мод: запас — сумма max_shield щитов в сетке, урон по машине сначала гасит щит (здоровье
// возвращается), щит восстанавливается раз в SHIELD_TICKS за счёт энергии машины (energy_per_shield — 30 кДж
// на единицу, как у персонажа; скорость — пятая часть запаса в секунду: Mk1 — 10/с, Mk2 — 30/с). Остальное
// в сетке не действует.
import { onEvent, onTick } from "../events"
import { spend } from "./energy"
import { findRobot, RobotRecord } from "./registry"

const SHIELD_TICKS = 30
/** Доля запаса щита, которая восстанавливается за секунду. */
const REGEN_PER_SECOND = 0.2
const DEFAULT_ENERGY_PER_SHIELD = 30_000

export interface ShieldsState {
  /** Машины со щитами в броне: id → true (их обходит восстановление). */
  robots: Record<number, boolean | undefined>
}

export function initShields(): void {
  storage.shields ??= { robots: {} }
}

/** Запас щита брони машины и цена единицы (Дж) — по энергощитам в её сетке. */
function shieldSpec(record: RobotRecord): { max: number; joules: number } {
  const stack = record.armor?.valid ? record.armor[0] : undefined
  const grid = stack !== undefined && stack.valid_for_read ? stack.grid : undefined
  let max = 0
  let joules = DEFAULT_ENERGY_PER_SHIELD
  for (const equipment of grid?.equipment ?? []) {
    if (equipment.max_shield <= 0) continue
    max += equipment.max_shield
    joules = equipment.prototype.energy_per_shield ?? joules
  }
  return { max, joules }
}

/** Броню сменили: запас щита — по новой сетке (что было сверх — пропадает); новая броня — с пустым щитом. */
export function updateShield(record: RobotRecord, fresh: boolean): void {
  initShields()
  const { max } = shieldSpec(record)
  record.shieldMax = max
  record.shield = fresh ? 0 : math.min(record.shield ?? 0, max)
  storage.shields!.robots[record.id] = max > 0 ? true : undefined
}

export function registerShields(): void {
  // Урон по машине — сначала в щит: здоровье возвращается на погашенное.
  onEvent(defines.events.on_entity_damaged, (e) => {
    const entity = e.entity
    if (entity.type !== "unit" || !entity.valid) return
    const record = findRobot(entity)
    if (record === undefined || (record.shield ?? 0) <= 0) return
    const absorbed = math.min(record.shield!, e.final_damage_amount)
    record.shield! -= absorbed
    entity.health = (entity.health ?? 0) + absorbed
  })
  onTick((tick) => {
    if (tick % SHIELD_TICKS !== 0 || storage.shields === undefined) return
    for (const [key] of pairs(storage.shields.robots)) {
      const record = storage.robots.byId[key as number]
      if (record === undefined || !record.entity.valid) {
        storage.shields.robots[key as number] = undefined
        continue
      }
      const max = record.shieldMax ?? 0
      const shield = record.shield ?? 0
      if (shield >= max) continue
      const add = math.min(max - shield, (max * REGEN_PER_SECOND * SHIELD_TICKS) / 60)
      if (spend(record, add * shieldSpec(record).joules)) record.shield = shield + add
    }
  })
}
