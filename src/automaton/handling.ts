// Действия «подобрать», «выбросить», «передать», «починить».
// Подобрать — предметы с земли вплотную (PICKUP_RADIUS), по стопке за шаг.
// Выбросить — из груза на землю рядом. Передать — другой машине в пределах досягаемости, в её груз.
// Починить — ремкомплектами из груза здание или машину: столько здоровья за тик, какова скорость
// ремкомплекта (как у персонажа); прочность ремкомплекта расходуется на починенное здоровье.
// Заправиться — переложить топливо из груза в топливный слот (по умолчанию лучшее).
// Каждый шаг этих действий тратит HANDLING_JOULES энергии.
import { LuaEntity, LuaItemStack } from "factorio:runtime"
import { ActionError, ActionState, distanceToEntity, face, registerActionHandler, StepOutcome } from "./actions"
import { fuelValue, HANDLING_JOULES, spend } from "./energy"
import { findRobot, RobotRecord } from "./registry"
import { REACH } from "./transfer"
import { robotBattery } from "./models"

export const PICKUP_RADIUS = 1.5
const PICKUP_TICKS = 10
const DROP_TICKS = 10
const GIVE_TICKS = 30
const REPAIR_STEP_TICKS = 10
const REFUEL_TICKS = 30

/** Потратить энергию на шаг; не хватило — итог «кончилось топливо» (успех с причиной, если что-то сделано). */
function outOfFuel(record: RobotRecord, action: ActionState): StepOutcome | undefined {
  if (spend(record, HANDLING_JOULES)) return undefined
  return action.done > 0 ? { finish: true, reason: "no-fuel" } : { finish: true, error: "no-fuel" }
}

function groundItems(record: RobotRecord, item: string | undefined): LuaEntity[] {
  return record.entity.surface
    .find_entities_filtered({ type: "item-entity", position: record.entity.position, radius: PICKUP_RADIUS })
    .filter((e) => e.stack !== undefined && e.stack.valid_for_read && (item === undefined || e.stack.name === item))
}

/** Подобрать: по одной лежащей стопке за шаг, пока не наберём просимое или не кончится место. */
function pickupStep(record: RobotRecord, action: ActionState): StepOutcome {
  const { item, count } = action.params
  if (count !== undefined && action.done >= count) return { finish: true }
  const next = groundItems(record, item)[0]
  if (next === undefined) return { finish: true }
  const noFuel = outOfFuel(record, action)
  if (noFuel !== undefined) return noFuel
  const stack = next.stack!
  const wanted = count === undefined ? stack.count : math.min(stack.count, count - action.done)
  const moved = record.cargo.insert({ name: stack.name, count: wanted, quality: stack.quality.name })
  if (moved === 0) return action.done > 0 ? { finish: true, reason: "cargo-full" } : { finish: true, error: "cargo-full" }
  face(record, next.position, "idle")
  if (moved >= stack.count) next.destroy()
  else stack.count -= moved
  action.done += moved
  return { after: PICKUP_TICKS }
}

registerActionHandler("pickup", {
  start: (record, action) => (groundItems(record, action.params.item).length > 0 ? { after: PICKUP_TICKS } : { finish: true }),
  step: (record, action) => pickupStep(record, action),
})

registerActionHandler("drop", {
  start: (record, action) => (action.params.item === undefined ? { finish: true, error: "invalid-target" } : { after: DROP_TICKS }),
  step: (record, action) => {
    const item = action.params.item!
    const amount = math.min(action.params.count ?? math.huge, record.cargo.get_item_count(item))
    if (amount <= 0) return { finish: true }
    const noFuel = outOfFuel(record, action)
    if (noFuel !== undefined) return noFuel
    const removed = record.cargo.remove({ name: item, count: amount })
    record.entity.surface.spill_item_stack({
      position: record.entity.position,
      stack: { name: item, count: removed },
      force: record.entity.force,
      enable_looted: true,
    })
    action.done = removed
    return { finish: true }
  },
})

/** Получатель передачи — другая машина в пределах досягаемости (или код ошибки). */
function receiver(record: RobotRecord, action: ActionState): RobotRecord | ActionError {
  const target = action.params.target
  const other = target?.valid ? findRobot(target) : undefined
  if (other === undefined || other.id === record.id) return "invalid-target"
  if (distanceToEntity(record.entity.position, other.entity) > REACH) return "out-of-reach"
  return other
}

registerActionHandler("give", {
  start: (record, action) => {
    const other = receiver(record, action)
    if (typeof other === "string") return { finish: true, error: other }
    face(record, other.entity.position, "idle")
    return { after: GIVE_TICKS }
  },
  step: (record, action) => {
    const other = receiver(record, action)
    if (typeof other === "string") return { finish: true, error: other }
    const item = action.params.item
    if (item === undefined) return { finish: true, error: "invalid-target" }
    const amount = math.min(action.params.count ?? math.huge, record.cargo.get_item_count(item))
    if (amount <= 0) return { finish: true }
    const noFuel = outOfFuel(record, action)
    if (noFuel !== undefined) return noFuel
    const moved = other.cargo.insert({ name: item, count: amount })
    if (moved > 0) record.cargo.remove({ name: item, count: moved })
    action.done = moved
    return moved < amount ? { finish: true, reason: "target-full" } : { finish: true }
  },
})

/** Ремкомплект в грузе (любой предмет-инструмент ремонта). */
function repairTool(record: RobotRecord): LuaItemStack | undefined {
  for (let i = 0; i < record.cargo.length; i++) {
    const stack = record.cargo[i]
    if (stack.valid_for_read && stack.is_repair_tool) return stack
  }
  return undefined
}

function repairTarget(record: RobotRecord, action: ActionState): LuaEntity | ActionError {
  const target = action.params.target
  if (target === undefined || !target.valid || target.health === undefined) return "invalid-target"
  if (target !== record.entity && distanceToEntity(record.entity.position, target) > REACH) return "out-of-reach"
  return target
}

registerActionHandler("repair", {
  start: (record, action) => {
    const target = repairTarget(record, action)
    if (typeof target === "string") return { finish: true, error: target }
    if (target.health! >= target.max_health) return { finish: true }
    if (repairTool(record) === undefined) return { finish: true, error: "not-enough-items" }
    face(record, target.position, "idle")
    return { after: REPAIR_STEP_TICKS }
  },
  step: (record, action) => {
    const target = repairTarget(record, action)
    if (typeof target === "string") return { finish: true, error: target }
    const missing = target.max_health - target.health!
    if (missing <= 0) return { finish: true }
    const tool = repairTool(record)
    if (tool === undefined) return action.done > 0 ? { finish: true, reason: "not-enough-items" } : { finish: true, error: "not-enough-items" }
    const noFuel = outOfFuel(record, action)
    if (noFuel !== undefined) return noFuel
    const speed = tool.prototype.speed ?? 1
    // Столько здоровья за шаг, сколько ремкомплект чинит за REPAIR_STEP_TICKS тиков, но не больше прочности.
    const heal = math.min(missing, speed * REPAIR_STEP_TICKS, tool.durability ?? math.huge)
    target.health = target.health! + heal
    tool.drain_durability(heal)
    action.done += heal
    return target.health! >= target.max_health ? { finish: true } : { after: REPAIR_STEP_TICKS }
  },
})

/** Лучшее топливо в грузе (больше всего энергии за штуку). */
function bestFuel(record: RobotRecord): string | undefined {
  let best: string | undefined
  for (const { name } of record.cargo.get_contents()) {
    if (fuelValue(name) > 0 && (best === undefined || fuelValue(name) > fuelValue(best))) best = name
  }
  return best
}

// Заправка не тратит энергию: иначе пустая машина не смогла бы заправиться.
registerActionHandler("refuel", {
  // Mk2+ — аккумулятор: заправлять нечего (charge).
  start: (record) => (robotBattery(record) !== undefined ? { finish: true, error: "invalid-target" } : { after: REFUEL_TICKS }),
  step: (record: RobotRecord, action: ActionState): StepOutcome => {
    const item = action.params.item ?? bestFuel(record)
    if (item === undefined || fuelValue(item) <= 0) return { finish: true, error: "not-enough-items" }
    const have = record.cargo.get_item_count(item)
    if (have <= 0) return { finish: true, error: "not-enough-items" }
    const moved = record.fuel.insert({ name: item, count: math.min(action.params.count ?? have, have) })
    if (moved > 0) record.cargo.remove({ name: item, count: moved })
    action.done = moved
    return moved === 0 ? { finish: true, error: "target-full" } : { finish: true }
  },
})
