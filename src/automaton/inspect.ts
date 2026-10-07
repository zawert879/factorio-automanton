// Чтение состояния зданий: статус, рецепт, прогресс крафта, содержимое входа/выхода/топлива, жидкости.
// Это основа полей Entity в программах (этап 4); правила видимости (только в поле зрения) — там же.
import { LuaEntity, LuaInventory } from "factorio:runtime"
import { inputInventoriesFor, outputInventoriesFor } from "./transfer"

export type EntityStatusName = "working" | "no-input" | "output-full" | "no-fuel" | "no-power" | "no-recipe" | "disabled" | "idle"

const s = defines.entity_status
const STATUS_NAMES: Partial<Record<defines.entity_status, EntityStatusName>> = {
  [s.working]: "working",
  // normal — «в порядке» у зданий, которые ничего не производят (сундук, стена): для программ это простой.
  [s.normal]: "idle",
  [s.no_power]: "no-power",
  [s.low_power]: "no-power",
  [s.no_fuel]: "no-fuel",
  [s.no_recipe]: "no-recipe",
  [s.disabled_by_control_behavior]: "disabled",
  [s.disabled_by_script]: "disabled",
  [s.disabled]: "disabled",
  [s.full_output]: "output-full",
  [s.full_burnt_result_output]: "output-full",
  [s.waiting_for_space_in_destination]: "output-full",
  [s.item_ingredient_shortage]: "no-input",
  [s.fluid_ingredient_shortage]: "no-input",
  [s.no_ingredients]: "no-input",
  [s.no_input_fluid]: "no-input",
  [s.waiting_for_source_items]: "no-input",
  [s.no_research_in_progress]: "no-input",
  [s.no_ammo]: "no-input",
}

/** Статус здания простыми словами. Здания без статуса (сундук, стена) — «простаивает». */
export function entityStatus(entity: LuaEntity): EntityStatusName {
  const status = entity.status
  return status === undefined ? "idle" : (STATUS_NAMES[status] ?? "idle")
}

/** Рецепт сборщика или печи (у печи — текущий или последний). */
export function entityRecipe(entity: LuaEntity): string | undefined {
  if (entity.type !== "assembling-machine" && entity.type !== "furnace" && entity.type !== "rocket-silo") return undefined
  const [recipe] = entity.get_recipe()
  if (recipe !== undefined) return recipe.name
  return entity.type === "furnace" ? entity.previous_recipe?.name.name : undefined
}

/** Прогресс текущего крафта, 0..1 (0 — у зданий, которые не крафтят). */
export function entityProgress(entity: LuaEntity): number {
  if (entity.type === "assembling-machine" || entity.type === "furnace" || entity.type === "rocket-silo") return entity.crafting_progress
  return 0
}

/** Сколько предмета во всех инвентарях здания. */
export function entityItemCount(entity: LuaEntity, item: string): number {
  return entity.get_item_count(item)
}

/** Вход здания (куда кладут сырьё), выход (откуда берут продукцию), топливо. */
export function entityInput(entity: LuaEntity): LuaInventory | undefined {
  return inputInventoriesFor(entity, "")[0]
}

export function entityOutput(entity: LuaEntity): LuaInventory | undefined {
  return outputInventoriesFor(entity)[0]
}

export function entityFuel(entity: LuaEntity): LuaInventory | undefined {
  return entity.burner === undefined ? undefined : entity.get_inventory(defines.inventory.fuel)
}

/** Сколько жидкости в здании (во всех ёмкостях); без имени — любой. */
export function entityFluid(entity: LuaEntity, name?: string): number {
  const boxes = entity.fluidbox
  let total = 0
  for (let i = 0; i < boxes.length; i++) {
    const fluid = boxes[i]
    if (fluid !== undefined && (name === undefined || fluid.name === name)) total += fluid.amount
  }
  return total
}
