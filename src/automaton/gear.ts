// Снаряжение (этап 22): оружие боевых моделей (22.2) и броня наземных (22.4). Что стоит — вариант сущности машины
// (22.1): оружие — по имени варианта (предмет «внутри» машины, при подборе и гибели отдаётся — registry.ts).
// Поставить и снять: игрок в окне машины (src/gui/machine.ts) и программа — действие equip: надевает из груза,
// снятое кладёт в груз.
import { LuaInventory, LuaItemStack } from "factorio:runtime"
import { ActionState, registerActionHandler, StepOutcome } from "./actions"
import { ammoFits, weaponOf } from "./combat"
import { HANDLING_JOULES, spend } from "./energy"
import { GEAR_ARMORS, GEAR_WEAPONS, modelOf } from "../names"
import { RobotRecord } from "./registry"
import { gearOf, swapGear } from "./variants"
import { updateShield } from "./shields"

/** Смена снаряжения — около секунды. */
export const EQUIP_TICKS = 60

/** Куда класть снятое (и патроны, которые к новому оружию не подходят); броня — стопкой, с сеткой снаряжения. */
export type Give = (this: void, stack: LuaItemStack | { name: string; count: number }) => void

/** Положить в инвентарь, что не влезло — на землю у машины. */
export function giveTo(record: RobotRecord, inventory: LuaInventory | undefined): Give {
  return (stack) => {
    const count = stack.count
    const moved = inventory === undefined ? 0 : inventory.insert(stack)
    if (moved >= count) return
    const position = record.entity.position
    // Стопка целиком (броня — по одной) — как есть, с данными; иначе — остаток.
    if (moved === 0) record.entity.surface.spill_item_stack({ position, stack, enable_looted: true })
    else record.entity.surface.spill_item_stack({ position, stack: { name: stack.name, count: count - moved }, enable_looted: true })
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

/** Годится ли предмет в слот брони этой машины (броня — у наземных моделей). */
export function fitsArmorSlot(record: RobotRecord, item: string): boolean {
  return modelOf(record.model)?.flying !== true && GEAR_ARMORS.includes(item)
}

/** Слот брони машины (в записях до 22.4 его нет — создать). */
export function armorSlot(record: RobotRecord): LuaInventory | undefined {
  if (modelOf(record.model)?.flying) return undefined
  if (!record.armor?.valid) record.armor = game.create_inventory(1)
  return record.armor
}

/**
 * Надеть броню из стопки from (сетка снаряжения переезжает вместе с ней) или снять (undefined). Прежняя броня —
 * в give стопкой. false — машина не подменилась.
 */
export function setArmor(record: RobotRecord, from: LuaItemStack | undefined, give: Give): boolean {
  const slot = armorSlot(record)
  if (slot === undefined) return false
  const name = from !== undefined && from.valid_for_read ? from.name : undefined
  if (!swapGear(record, gearOf(record).weapon, name)) return false
  const old = slot[0]
  if (old.valid_for_read) {
    give(old)
    old.clear()
  }
  if (name !== undefined) slot[0].transfer_stack(from!)
  updateShield(record, true)
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
  if (action.params.slot === "armor") {
    if (modelOf(record.model)?.flying) return { finish: true, error: "invalid-target" }
    if (item !== undefined && !fitsArmorSlot(record, item)) return { finish: true, error: "invalid-target" }
    const current = gearOf(record).armor
    if (item !== undefined && item !== current && record.cargo.get_item_count(item) < 1) return { finish: true, error: "not-enough-items" }
    if (item === undefined && current !== undefined && record.cargo.count_empty_stacks() < 1) return { finish: true, error: "cargo-full" }
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
    if (action.params.slot === "armor") {
      if (gearOf(record).armor !== item) {
        let stack: LuaItemStack | undefined
        if (item !== undefined) [stack] = record.cargo.find_item_stack(item)
        if (!setArmor(record, stack, giveTo(record, record.cargo))) return { finish: true, error: "invalid-target" }
      }
      action.done = 1
      return { finish: true }
    }
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
