// Действия «положить» и «взять»: обмен предметами между грузом машины и зданием в пределах
// досягаемости (10 клеток, как у персонажа). Перекладка занимает TRANSFER_TICKS.
//
// Положить: топливо — в топливный слот (если здание жжёт этот вид топлива), остальное — во вход
// здания: сырьё печи, ингредиенты сборщика, наука лаборатории, патроны турели, сундук, вагон, багажник.
// Взять: сначала выход (результат печи, продукция сборщика), потом хранилище, потом остальные слоты —
// как персонаж, который может взять из любого слота.
// Частичный результат — успех с причиной (target-full, cargo-full); ошибка — когда нельзя ничего.
import { LuaEntity, LuaInventory } from "factorio:runtime"
import { ActionState, distanceToEntity, face, registerActionHandler, StepOutcome } from "./actions"
import { RobotRecord } from "./registry"

export const REACH = 10
export const TRANSFER_TICKS = 30

const INPUT_INVENTORIES: Record<string, defines.inventory[]> = {
  furnace: [defines.inventory.furnace_source],
  "assembling-machine": [defines.inventory.assembling_machine_input],
  "rocket-silo": [defines.inventory.rocket_silo_input, defines.inventory.rocket_silo_rocket],
  lab: [defines.inventory.lab_input],
  "ammo-turret": [defines.inventory.turret_ammo],
  "artillery-turret": [defines.inventory.artillery_turret_ammo],
  container: [defines.inventory.chest],
  "logistic-container": [defines.inventory.chest],
  "cargo-wagon": [defines.inventory.cargo_wagon],
  car: [defines.inventory.car_trunk],
  "spider-vehicle": [defines.inventory.spider_trunk],
}

const OUTPUT_INVENTORIES: Record<string, defines.inventory[]> = {
  furnace: [defines.inventory.furnace_result, defines.inventory.furnace_source],
  "assembling-machine": [defines.inventory.assembling_machine_output, defines.inventory.assembling_machine_input],
  "rocket-silo": [defines.inventory.rocket_silo_output],
  lab: [defines.inventory.lab_input],
  "ammo-turret": [defines.inventory.turret_ammo],
  "artillery-turret": [defines.inventory.artillery_turret_ammo],
  container: [defines.inventory.chest],
  "logistic-container": [defines.inventory.chest],
  "cargo-wagon": [defines.inventory.cargo_wagon],
  car: [defines.inventory.car_trunk],
  "spider-vehicle": [defines.inventory.spider_trunk],
}

/** Горит ли этот предмет в горелке здания. */
function isFuelFor(entity: LuaEntity, item: string): boolean {
  const burner = entity.burner
  const prototype = prototypes.item[item]
  if (burner === undefined || prototype === undefined || prototype.fuel_value <= 0) return false
  return burner.fuel_categories[prototype.fuel_category ?? ""] !== undefined
}

/**
 * Инвентари здания по списку номеров, без повторов. Номера defines.inventory у разных типов зданий
 * совпадают (топливо = сундук = патроны турели = 1, вход печи = вход сборщика = 2), поэтому топливные
 * слоты добавляются отдельно и только у зданий с горелкой, а одинаковые инвентари отбрасываются.
 */
function existing(entity: LuaEntity, ids: defines.inventory[], into: LuaInventory[] = []): LuaInventory[] {
  for (const id of ids) {
    const inventory = entity.get_inventory(id)
    if (inventory !== undefined && !into.some((other) => other === inventory)) into.push(inventory)
  }
  return into
}

/** Куда класть предмет в это здание — по порядку. */
export function inputInventoriesFor(entity: LuaEntity, item: string): LuaInventory[] {
  const result = isFuelFor(entity, item) ? existing(entity, [defines.inventory.fuel]) : []
  return existing(entity, INPUT_INVENTORIES[entity.type] ?? [], result)
}

/** Откуда брать предмет из здания — по порядку: выход, хранилище, остальное. */
export function outputInventoriesFor(entity: LuaEntity): LuaInventory[] {
  const result = existing(entity, OUTPUT_INVENTORIES[entity.type] ?? [])
  return entity.burner === undefined ? result : existing(entity, [defines.inventory.fuel, defines.inventory.burnt_result], result)
}

/** Цель действия годится: есть, в пределах досягаемости. Иначе — ошибка. */
function checkTarget(record: RobotRecord, action: ActionState): StepOutcome | undefined {
  const target = action.params.target
  if (target === undefined || !target.valid || target === record.entity) return { finish: true, error: "invalid-target" }
  if (distanceToEntity(record.entity.position, target) > REACH) return { finish: true, error: "out-of-reach" }
  return undefined
}

function put(record: RobotRecord, action: ActionState): StepOutcome {
  const target = action.params.target!
  const item = action.params.item
  if (item === undefined) return { finish: true, error: "invalid-target" }
  const have = record.cargo.get_item_count(item)
  const wanted = math.min(action.params.count ?? have, have)
  let moved = 0
  for (const inventory of inputInventoriesFor(target, item)) {
    if (moved >= wanted) break
    moved += inventory.insert({ name: item, count: wanted - moved })
  }
  if (moved > 0) record.cargo.remove({ name: item, count: moved })
  action.done = moved
  return moved < wanted ? { finish: true, reason: "target-full" } : { finish: true }
}

function take(record: RobotRecord, action: ActionState): StepOutcome {
  const target = action.params.target!
  const item = action.params.item
  if (item === undefined) return { finish: true, error: "invalid-target" }
  const sources = outputInventoriesFor(target)
  let available = 0
  for (const inventory of sources) available += inventory.get_item_count(item)
  const wanted = math.min(action.params.count ?? available, available)
  if (wanted <= 0) return { finish: true }
  // Сначала забрать из здания, потом положить в груз ровно столько, сколько забрано; что не влезло — вернуть.
  let taken = 0
  for (const inventory of sources) {
    if (taken >= wanted) break
    taken += inventory.remove({ name: item, count: wanted - taken })
  }
  const moved = taken > 0 ? record.cargo.insert({ name: item, count: taken }) : 0
  if (moved < taken) {
    let back = taken - moved
    for (const inventory of sources) {
      if (back <= 0) break
      back -= inventory.insert({ name: item, count: back })
    }
  }
  action.done = moved
  if (moved === 0) return { finish: true, error: "cargo-full" }
  return moved < wanted ? { finish: true, reason: "cargo-full" } : { finish: true }
}

function transferHandler(transfer: (record: RobotRecord, action: ActionState) => StepOutcome) {
  return {
    start: (record: RobotRecord, action: ActionState): StepOutcome => {
      const problem = checkTarget(record, action)
      if (problem !== undefined) return problem
      face(record, action.params.target!.position, "idle")
      return { after: TRANSFER_TICKS }
    },
    // За время перекладки цель могли уничтожить или машину увести — проверить снова.
    step: (record: RobotRecord, action: ActionState): StepOutcome => checkTarget(record, action) ?? transfer(record, action),
  }
}

registerActionHandler("put", transferHandler(put))
registerActionHandler("take", transferHandler(take))
