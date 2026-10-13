// Снаряжение (этап 22): оружие боевых моделей (22.2) и броня наземных (22.4). Что стоит — вариант сущности машины
// (22.1): оружие — по имени варианта (предмет «внутри» машины, при подборе и гибели отдаётся — registry.ts).
// Поставить и снять: игрок в окне машины (src/gui/machine.ts) и программа — действие equip: надевает из груза,
// снятое кладёт в груз.
import { LuaInventory } from "factorio:runtime"
import { ActionState, registerActionHandler, StepOutcome } from "./actions"
import { ammoFits, weaponOf } from "./combat"
import { HANDLING_JOULES, spend } from "./energy"
import { GEAR_WEAPONS, modelOf } from "../names"
import { RobotRecord } from "./registry"
import { gearOf, swapGear } from "./variants"

/** Смена снаряжения — около секунды. */
export const EQUIP_TICKS = 60

/** Куда класть снятое (и патроны, которые к новому оружию не подходят). */
export type Give = (this: void, stack: { name: string; count: number }) => void

/** Положить в инвентарь, что не влезло — на землю у машины. */
export function giveTo(record: RobotRecord, inventory: LuaInventory | undefined): Give {
  return (stack) => {
    const moved = inventory === undefined ? 0 : inventory.insert(stack)
    if (moved < stack.count) {
      record.entity.surface.spill_item_stack({ position: record.entity.position, stack: { name: stack.name, count: stack.count - moved }, enable_looted: true })
    }
  }
}

/** Годится ли предмет в слот оружия этой машины. */
export function fitsWeaponSlot(record: RobotRecord, item: string): boolean {
  return modelOf(record.model)?.weapon !== undefined && GEAR_WEAPONS.includes(item)
}

/**
 * Поставить оружие (item) или вернуть встроенное (undefined). Прежнее оружие и патроны, которые к новому не подходят,
 * — в give. false — машина не подменилась (её нет).
 */
export function setWeapon(record: RobotRecord, item: string | undefined, give: Give): boolean {
  const current = gearOf(record)
  if (current.weapon === item) return true
  if (!swapGear(record, item, current.armor)) return false
  if (current.weapon !== undefined) give({ name: current.weapon, count: 1 })
  const stack = record.weapon?.[0]
  const weapon = weaponOf(record)
  if (stack !== undefined && stack.valid_for_read && weapon !== undefined && !ammoFits(weapon, stack.name)) {
    give({ name: stack.name, count: stack.count })
    stack.clear()
  }
  return true
}

/** Проверки действия equip: что надеть есть в грузе, снятому есть место. */
function equipCheck(record: RobotRecord, action: ActionState): StepOutcome | undefined {
  const item = action.params.item
  if (action.params.slot === "weapon") {
    if (modelOf(record.model)?.weapon === undefined) return { finish: true, error: "invalid-target" }
    if (item !== undefined && !fitsWeaponSlot(record, item)) return { finish: true, error: "invalid-target" }
    const current = gearOf(record).weapon
    if (item !== undefined && item !== current && record.cargo.get_item_count(item) < 1) return { finish: true, error: "not-enough-items" }
    if (item === undefined && current !== undefined && !record.cargo.can_insert({ name: current, count: 1 })) return { finish: true, error: "cargo-full" }
    return undefined
  }
  return { finish: true, error: "invalid-target" }
}

registerActionHandler("equip", {
  start: (record, action) => equipCheck(record, action) ?? { after: EQUIP_TICKS },
  step: (record, action) => {
    const problem = equipCheck(record, action)
    if (problem !== undefined) return problem
    if (!spend(record, HANDLING_JOULES)) return { finish: true, error: "no-fuel" }
    const item = action.params.item
    if (gearOf(record).weapon !== item) {
      if (item !== undefined) record.cargo.remove({ name: item, count: 1 })
      if (!setWeapon(record, item, giveTo(record, record.cargo))) {
        if (item !== undefined) record.cargo.insert({ name: item, count: 1 })
        return { finish: true, error: "invalid-target" }
      }
    }
    action.done = 1
    return { finish: true }
  },
})
