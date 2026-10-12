// Модули (21.4): машины ставят модули из груза в слоты зданий и снимают их обратно — действия «положить» и «взять»
// с флагом modules (src/automaton/transfer.ts). Чертёж просит модули запросом (item-request-proxy с insert_plan у
// здания): поставленный машиной модуль встаёт в тот слот, который просит чертёж, и вычёркивается из запроса —
// строительные дроны второй раз его не понесут. Остальные модули — в свободные слоты.
import { BlueprintInsertPlan, InventoryPosition, LuaEntity, LuaInventory } from "factorio:runtime"
import { RobotRecord } from "./registry"

export function isModule(item: string): boolean {
  return prototypes.item[item]?.type === "module"
}

/** Слоты модулей здания; у здания без них (каменная печь) — undefined. */
export function moduleSlots(entity: LuaEntity): LuaInventory | undefined {
  const inventory = entity.get_module_inventory()
  return inventory !== undefined && inventory.length > 0 ? inventory : undefined
}

/** Что просит план чертежа (у призрака — его insert_plan, у здания — запрос рядом с ним): предмет → сколько. */
export function requestedItems(plan: readonly BlueprintInsertPlan[] | undefined): { name: string; count: number }[] {
  const result: { name: string; count: number }[] = []
  for (const entry of plan ?? []) {
    let count = entry.items.grid_count ?? 0
    for (const position of entry.items.in_inventory ?? []) count += position.count ?? 1
    if (count <= 0) continue
    const existing = result.find((r) => r.name === entry.id.name)
    if (existing !== undefined) existing.count += count
    else result.push({ name: entry.id.name, count })
  }
  return result
}

/** Запрос чертежа к зданию: что ещё не доставлено. */
export function entityRequests(entity: LuaEntity): { name: string; count: number }[] {
  const proxy = entity.item_request_proxy
  return proxy?.valid ? requestedItems(proxy.insert_plan) : []
}

/**
 * Поставить wanted модулей item в слоты: сначала в те, что просит чертёж (их — из запроса долой; пустой запрос
 * снимается), потом в свободные. Возвращает, сколько поставлено.
 */
export function installModules(target: LuaEntity, slots: LuaInventory, item: string, wanted: number): number {
  let moved = 0
  const proxy = target.item_request_proxy
  if (proxy?.valid) {
    const kept: BlueprintInsertPlan[] = []
    for (const entry of proxy.insert_plan) {
      if (entry.id.name !== item) {
        kept.push(entry)
        continue
      }
      const left: InventoryPosition[] = []
      for (const position of entry.items.in_inventory ?? []) {
        const slot = position.inventory === slots.index ? slots[position.stack] : undefined
        if (moved < wanted && slot !== undefined && !slot.valid_for_read && slot.set_stack({ name: item, count: 1 })) moved++
        else left.push(position)
      }
      if (left.length > 0 || (entry.items.grid_count ?? 0) > 0) kept.push({ id: entry.id, items: { in_inventory: left, grid_count: entry.items.grid_count } })
    }
    if (kept.length === 0 && proxy.removal_plan.length === 0) proxy.destroy()
    else proxy.insert_plan = kept
  }
  if (moved < wanted) moved += slots.insert({ name: item, count: wanted - moved })
  return moved
}

/** Снять модули в груз: item (или все), не больше count. Что не влезло в груз — остаётся в слотах. */
export function removeModules(record: RobotRecord, slots: LuaInventory, item: string | undefined, count: number | undefined): number {
  let moved = 0
  for (let i = 0; i < slots.length; i++) {
    if (count !== undefined && moved >= count) break
    const stack = slots[i]
    if (!stack.valid_for_read || (item !== undefined && stack.name !== item)) continue
    const amount = count === undefined ? stack.count : math.min(stack.count, count - moved)
    const inserted = record.cargo.insert({ name: stack.name, count: amount, quality: stack.quality.name })
    if (inserted <= 0) break
    stack.count -= inserted
    moved += inserted
  }
  return moved
}
