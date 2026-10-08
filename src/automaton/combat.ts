// Бой (этап 10). Боевая модель — юнит с оружием: стреляет движок игры (подъезд, прицел, перезарядка
// оружия), а каждый выстрел вызывает событие скрипта (SHOT_EFFECT): мод тратит один заряд патрона из
// оружейного слота машины и наносит урон по виду патрона с учётом исследований урона команды.
// Без патронов выстрелы холостые.
//
// Действия: reload — патроны из груза в оружейный слот; attack — бой с целью до её гибели, потери из
// виду или конца патронов (сам подъезд и стрельба — команда attack движку).
import { LuaEntity, LuaForce, OnScriptTriggerEffectEvent } from "factorio:runtime"
import { onEvent } from "../events"
import { modelOf, SHOT_EFFECT, WeaponSpec } from "../names"
import { ActionState, registerActionHandler, StepOutcome } from "./actions"
import { directionOf, setActivity } from "./appearance"
import { HANDLING_JOULES, spend } from "./energy"
import { robotVision } from "./models"
import { findRobot, RobotRecord } from "./registry"

/** Урон одного заряда по патронам (без бонусов исследований) и его вид. */
export const AMMO_DAMAGE: Record<string, { damage: number; type: "physical" | "explosion" } | undefined> = {
  "firearm-magazine": { damage: 5, type: "physical" },
  "piercing-rounds-magazine": { damage: 8, type: "physical" },
  "uranium-rounds-magazine": { damage: 24, type: "physical" },
  rocket: { damage: 200, type: "explosion" },
  "explosive-rocket": { damage: 300, type: "explosion" },
}

export const RELOAD_TICKS = 30
const ATTACK_CHECK_TICKS = 15
/** Цель дальше этого от машины — потеряна (уехала или убежала). */
const LOSE_DISTANCE_FACTOR = 2

export function weaponOf(record: RobotRecord): WeaponSpec | undefined {
  return modelOf(record.model)?.weapon
}

/** Подходят ли патроны к оружию машины. */
export function ammoFits(weapon: WeaponSpec, item: string): boolean {
  const prototype = prototypes.item[item]
  return prototype?.type === "ammo" && prototype.ammo_category?.name === weapon.category
}

/** Заряжено ли (есть ли хоть один заряд). */
export function hasAmmo(record: RobotRecord): boolean {
  const stack = record.weapon?.[0]
  return stack !== undefined && stack.valid_for_read
}

function onShot(e: OnScriptTriggerEffectEvent): void {
  if (e.effect_id !== SHOT_EFFECT) return
  const shooter = e.source_entity
  const target = e.target_entity
  if (shooter === undefined || !shooter.valid || target === undefined || !target.valid) return
  const record = findRobot(shooter)
  const stack = record?.weapon?.[0]
  if (record === undefined || stack === undefined || !stack.valid_for_read) return
  const ammo = AMMO_DAMAGE[stack.name] ?? { damage: 5, type: "physical" as const }
  const category = weaponOf(record)?.category ?? "bullet"
  const bonus = (shooter.force as LuaForce).get_ammo_damage_modifier(category)
  stack.drain_ammo(1)
  if (target.health !== undefined && target.destructible) target.damage(ammo.damage * (1 + bonus), shooter.force, ammo.type, shooter)
}

// ---------- reload ----------

function bestAmmo(record: RobotRecord, weapon: WeaponSpec): string | undefined {
  let best: string | undefined
  for (const { name } of record.cargo.get_contents()) {
    if (!ammoFits(weapon, name)) continue
    if (best === undefined || (AMMO_DAMAGE[name]?.damage ?? 0) > (AMMO_DAMAGE[best]?.damage ?? 0)) best = name
  }
  return best
}

registerActionHandler("reload", {
  start: (record) => (weaponOf(record) === undefined ? { finish: true, error: "invalid-target" } : { after: RELOAD_TICKS }),
  step: (record, action) => {
    const weapon = weaponOf(record)!
    const item = action.params.item ?? bestAmmo(record, weapon)
    if (item === undefined || !ammoFits(weapon, item)) return { finish: true, error: "not-enough-items" }
    const have = record.cargo.get_item_count(item)
    if (have <= 0) return { finish: true, error: "not-enough-items" }
    const slot = record.weapon!
    // Другие патроны в слоте — обратно в груз.
    const current = slot[0]
    if (current.valid_for_read && current.name !== item) {
      if (record.cargo.insert(current) < current.count) return { finish: true, error: "cargo-full" }
      current.clear()
    }
    if (!spend(record, HANDLING_JOULES)) return { finish: true, error: "no-fuel" }
    const moved = slot.insert({ name: item, count: have })
    if (moved > 0) record.cargo.remove({ name: item, count: moved })
    action.done = moved
    return moved === 0 ? { finish: true, error: "target-full" } : { finish: true }
  },
})

// ---------- attack ----------

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

/** Отдать движку команду атаки (подъезд и бой — его). */
export function commandAttack(record: RobotRecord, target: LuaEntity): void {
  record.entity.commandable!.set_command({ type: defines.command.attack, target, distraction: defines.distraction.none })
}

/** Тело машины в бою: едет — бежит, стоит — смотрит на цель. */
export function combatPose(record: RobotRecord, target: { x: number; y: number } | undefined, moving: boolean): void {
  if (moving) return setActivity(record, "run", directionOf(record.entity.orientation))
  if (target === undefined) return setActivity(record, "idle")
  const { x, y } = record.entity.position
  const orientation = (math.atan2(target.x - x, -(target.y - y)) / (2 * math.pi) + 1) % 1
  setActivity(record, "idle", directionOf(orientation))
}

function attackStep(record: RobotRecord, action: ActionState): StepOutcome {
  const target = action.params.target
  // Цель уничтожена — победа.
  if (target === undefined || !target.valid || (target.health !== undefined && target.health <= 0)) {
    action.done = 1
    stopCombat(record)
    return { finish: true }
  }
  const position = record.entity.position
  if (distance(position, target.position) > robotVision(record) * LOSE_DISTANCE_FACTOR + weaponOf(record)!.range) {
    stopCombat(record)
    return { finish: true, reason: "out-of-sight" }
  }
  if (!hasAmmo(record)) {
    stopCombat(record)
    return { finish: true, reason: "no-ammo" }
  }
  // Команда кончилась (движок отвлёкся или цель вышла из досягаемости) — повторить.
  if (!record.entity.commandable!.has_command) commandAttack(record, target)
  const last = action.params.position
  const moving = last !== undefined && distance(last, position) > 0.05
  action.params.position = position
  combatPose(record, target.position, moving)
  return { after: ATTACK_CHECK_TICKS }
}

/** Прекратить бой: машина останавливается. */
export function stopCombat(record: RobotRecord): void {
  if (record.entity.valid) record.entity.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
}

registerActionHandler("attack", {
  start: (record, action) => {
    const target = action.params.target
    if (weaponOf(record) === undefined || target === undefined || !target.valid) return { finish: true, error: "invalid-target" }
    if (!hasAmmo(record)) return { finish: true, error: "no-ammo" }
    commandAttack(record, target)
    return { after: ATTACK_CHECK_TICKS }
  },
  step: (record, action) => attackStep(record, action),
})

export function registerCombat(): void {
  onEvent(defines.events.on_script_trigger_effect, (e) => onShot(e))
}
