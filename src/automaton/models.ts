// Модели машин и улучшения исследованиями (8.1, 8.3, 8.7). Характеристики машины = модель × бонусы
// исследований её команды: скорость, груз, добыча, квант инструкций, память программы, бак; радиус
// зрения — по уровням «Сенсоров». Скорость и размер груза хранит сама игра (entity.speed, инвентарь),
// поэтому после исследования они пересчитываются у всех машин команды; остальное считается на лету.
//
// Уровни читаются из технологий команды и кэшируются на один тик: исследование, изменённое скриптом
// без события, не разведёт игроков (кэш у всех одинаково живёт тик). Скорость и груз сверяются с
// уровнями раз в секунду (запомненные уровни — в storage) и сразу по событиям исследований.
import { LuaForce } from "factorio:runtime"
import { onEvent, onTick } from "../events"
import { MODELS, ModelSpec, modelOf, TECH, UPGRADE_LEVELS, UPGRADES, UpgradeKind, VISION_BY_SENSORS } from "../names"
import type { RobotRecord } from "./registry"

type Levels = Record<UpgradeKind | "sensors", number>

/** Уровни улучшений команды: кэш на тик, вне storage. */
const levels = new LuaMap<string, { tick: number; levels: Levels }>()
const APPLY_CHECK_TICKS = 60

function researchedLevels(force: LuaForce, tech: string): number {
  let level = 0
  for (let i = 1; i <= UPGRADE_LEVELS; i++) if (force.technologies[`${tech}-${i}`]?.researched) level = i
  return level
}

export function forceLevels(force: LuaForce): Levels {
  const cached = levels.get(force.name)
  if (cached !== undefined && cached.tick === game.tick) return cached.levels
  const result = { sensors: 0 } as Levels
  for (const upgrade of UPGRADES) result[upgrade.kind] = researchedLevels(force, upgrade.tech)
  const sensors = [TECH.sensors1, TECH.sensors2, TECH.sensors3]
  for (let i = 0; i < sensors.length; i++) if (force.technologies[sensors[i]]?.researched) result.sensors = i + 1
  levels.set(force.name, { tick: game.tick, levels: result })
  return result
}

function multiplier(record: RobotRecord, kind: UpgradeKind): number {
  const upgrade = UPGRADES.find((u) => u.kind === kind)!
  return 1 + upgrade.step * forceLevels(record.entity.force as LuaForce)[kind]
}

export function modelOfRecord(record: RobotRecord): ModelSpec {
  return modelOf(record.model ?? (record.entity.valid ? record.entity.name : MODELS[0].entity)) ?? MODELS[0]
}

export function robotSpeed(record: RobotRecord): number {
  return modelOfRecord(record).speed * multiplier(record, "speed")
}

export function robotCargoSlots(record: RobotRecord): number {
  return math.floor(modelOfRecord(record).cargoSlots * multiplier(record, "cargo"))
}

export function robotMiningSpeed(record: RobotRecord): number {
  return modelOfRecord(record).miningSpeed * multiplier(record, "mining")
}

export function robotQuantum(record: RobotRecord): number {
  return math.floor(modelOfRecord(record).quantum * multiplier(record, "processor"))
}

export function robotMemory(record: RobotRecord): number {
  return math.floor(modelOfRecord(record).memory * multiplier(record, "memory"))
}

export function robotTankCapacity(record: RobotRecord): number {
  return math.floor(modelOfRecord(record).tank * multiplier(record, "tank"))
}

export function robotVision(record: RobotRecord): number {
  return VISION_BY_SENSORS[forceLevels(record.entity.force as LuaForce).sensors]
}

/** Ёмкость аккумулятора (Mk2+) или undefined (Mk1 жжёт топливо). */
export function robotBattery(record: RobotRecord): number | undefined {
  return modelOfRecord(record).battery
}

/** Скорость и размер груза — по текущим исследованиям (груз только растёт: лишнее не выбрасываем). */
export function applyUpgrades(record: RobotRecord): void {
  if (!record.entity.valid) return
  record.entity.speed = robotSpeed(record)
  const slots = robotCargoSlots(record)
  if (record.cargo.valid && record.cargo.length < slots) record.cargo.resize(slots)
}

/** Скорость и груз всех машин команды — по текущим исследованиям. */
export function refreshForce(force: LuaForce): void {
  levels.delete(force.name)
  const current = forceLevels(force)
  storage.upgradeLevels ??= {}
  storage.upgradeLevels[force.name] = `${current.speed}/${current.cargo}`
  for (const [, record] of pairs(storage.robots.byId)) {
    if (record.entity.valid && record.entity.force === force) applyUpgrades(record)
  }
}

/** Раз в секунду: если уровни скорости или груза изменились без события — применить. */
function checkApplied(): void {
  storage.upgradeLevels ??= {}
  for (const [, force] of pairs(game.forces)) {
    const current = forceLevels(force)
    if (storage.upgradeLevels[force.name] !== `${current.speed}/${current.cargo}`) refreshForce(force)
  }
}

export function registerModels(): void {
  onEvent(defines.events.on_research_finished, (e) => refreshForce(e.research.force))
  onEvent(defines.events.on_research_reversed, (e) => refreshForce(e.research.force))
  onEvent(defines.events.on_technology_effects_reset, (e) => refreshForce(e.force))
  onEvent(defines.events.on_forces_merged, () => {
    for (const [name] of levels) levels.delete(name)
  })
  onTick((tick) => {
    if (tick % APPLY_CHECK_TICKS === 0) checkApplied()
  })
}
