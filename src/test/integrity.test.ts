// Целостность после удаления ванили (6.5): всё дерево технологий исследуемо, все науки получаемы,
// ни один видимый рецепт или технология не ссылается на удалённое, старт freeplay — с автоматонами.
//
// «Получаемо» — замыкание от сырья: месторождения (руда, нефть), деревья и камни, жидкости озёр
// (воду и нефть возят машины — этап 7) → рецепты, доступные со старта или открытые достижимыми
// технологиями → продукты, отработанное топливо, продукты запуска ракеты.
import { findProgram } from "../program/store"
import { LuaTechnologyPrototype } from "factorio:runtime"
import { compile } from "../lang/codegen"
import { STARTER_PROGRAMS } from "../program/examples.generated"
import { MARKER, REMOVED_ENTITY_TYPES, TECH, WORKER_MK1 } from "../names"
import { describe, expect, test } from "./testing"

interface Reach {
  items: LuaSet<string>
  fluids: LuaSet<string>
  technologies: LuaSet<string>
}

function addProducts(reach: Reach, products: readonly { type: string; name: string }[] | undefined): boolean {
  let changed = false
  for (const product of products ?? []) {
    const set = product.type === "fluid" ? reach.fluids : reach.items
    if (!set.has(product.name)) {
      set.add(product.name)
      changed = true
    }
  }
  return changed
}

/** Сырьё: что можно добыть руками или машиной без рецептов. */
function rawMaterials(reach: Reach): void {
  for (const [, entity] of prototypes.entity) {
    const mineable = entity.mineable_properties
    if (!mineable.minable) continue
    if (entity.type === "resource" || entity.type === "tree" || entity.type === "simple-entity" || entity.type === "fish") {
      addProducts(reach, mineable.products)
    }
  }
  for (const [, tile] of prototypes.tile) if (tile.fluid !== undefined) reach.fluids.add(tile.fluid.name)
}

function triggerReachable(reach: Reach, technology: LuaTechnologyPrototype): boolean {
  const trigger = technology.research_trigger as unknown as Record<string, any> | undefined
  if (trigger === undefined) {
    return technology.research_unit_ingredients.every((i) => reach.items.has(i.name))
  }
  switch (trigger.type) {
    case "craft-item":
    case "send-item-to-orbit":
      return reach.items.has(trigger.item.name ?? trigger.item)
    case "craft-fluid":
      return reach.fluids.has(trigger.fluid)
    case "build-entity": {
      const entity = prototypes.entity[trigger.entity.name ?? trigger.entity]
      return (entity?.items_to_place_this ?? []).some((i) => reach.items.has(i.name))
    }
    default:
      return true
  }
}

/** Замыкание достижимости: технологии ↔ рецепты ↔ предметы. */
function computeReach(): Reach {
  const reach: Reach = { items: new LuaSet(), fluids: new LuaSet(), technologies: new LuaSet() }
  rawMaterials(reach)
  const unlocked = new LuaSet<string>()
  for (const [name, recipe] of prototypes.recipe) if (recipe.enabled) unlocked.add(name)
  let changed = true
  while (changed) {
    changed = false
    for (const [name, recipe] of prototypes.recipe) {
      if (!unlocked.has(name)) continue
      const ready = recipe.ingredients.every((i) => (i.type === "fluid" ? reach.fluids : reach.items).has(i.name))
      if (ready && addProducts(reach, recipe.products)) changed = true
    }
    for (const [name] of prototypes.item) {
      if (!reach.items.has(name)) continue
      const item = prototypes.item[name]!
      if (item.burnt_result !== undefined && !reach.items.has(item.burnt_result.name)) {
        reach.items.add(item.burnt_result.name)
        changed = true
      }
      if (addProducts(reach, item.rocket_launch_products)) changed = true
    }
    for (const [name, technology] of prototypes.technology) {
      if (reach.technologies.has(name)) continue
      const prerequisitesDone = Object.keys(technology.prerequisites).every((p) => reach.technologies.has(p))
      if (!prerequisitesDone || !triggerReachable(reach, technology)) continue
      reach.technologies.add(name)
      changed = true
      for (const effect of technology.effects) if (effect.type === "unlock-recipe") unlocked.add(effect.recipe)
    }
  }
  return reach
}

/** Предметы, которые ставят удалённые здания (скрытые предметы самой игры, вроде rocket-part, — не в счёт). */
function removedItems(): LuaSet<string> {
  const result = new LuaSet<string>()
  const types = new LuaSet<string>()
  for (const type of REMOVED_ENTITY_TYPES) types.add(type)
  for (const [name, item] of prototypes.item) {
    const entity = item.place_result
    if (entity === undefined) continue
    if (types.has(entity.type) || (entity.type === "logistic-container" && entity.logistic_mode !== "storage")) result.add(name)
  }
  return result
}

describe("целостность после удаления ванили", () => {
  test("удалённые здания, их предметы и рецепты скрыты (и в Factoriopedia)", () => {
    const visible: string[] = []
    for (const type of REMOVED_ENTITY_TYPES) {
      for (const [name, entity] of prototypes.get_entity_filtered([{ filter: "type", type: type as never }])) {
        if (!entity.hidden || !entity.hidden_in_factoriopedia) visible.push(name)
        for (const item of entity.items_to_place_this ?? []) if (!prototypes.item[item.name]!.hidden) visible.push(item.name)
      }
    }
    expect(visible.join(", ")).toBe("")
    for (const name of ["transport-belt", "inserter", "burner-mining-drill", "electric-mining-drill", "pumpjack", "offshore-pump", "requester-chest"]) {
      expect(`${name}: ${prototypes.recipe[name]?.hidden}`).toBe(`${name}: true`)
    }
    // Остаются: сундук хранения, помпа, робопорт.
    for (const name of ["storage-chest", "pump", "roboport"]) expect(`${name}: ${prototypes.recipe[name]!.hidden}`).toBe(`${name}: false`)
  })

  test("видимые рецепты не ссылаются на удалённые предметы", () => {
    const removed = removedItems()
    const broken: string[] = []
    for (const [name, recipe] of prototypes.recipe) {
      if (recipe.hidden) continue
      for (const stack of [...recipe.ingredients, ...recipe.products]) {
        if (stack.type === "item" && removed.has(stack.name)) broken.push(`${name} → ${stack.name}`)
      }
    }
    expect(broken.join(", ")).toBe("")
    // Зелёная наука и лаборатория починены: вместо манипулятора и конвейера — их ингредиенты.
    const green = prototypes.recipe["logistic-science-pack"]!.ingredients.map((i) => i.name)
    expect(green.includes("inserter") || green.includes("transport-belt")).toBe(false)
    expect(green.includes("electronic-circuit")).toBe(true)
  })

  test("видимые технологии не зависят от скрытых и не открывают удалённое", () => {
    const broken: string[] = []
    for (const [name, technology] of prototypes.technology) {
      if (technology.hidden) continue
      for (const [prerequisite, p] of pairs(technology.prerequisites)) if (p.hidden) broken.push(`${name} ← ${prerequisite}`)
      for (const effect of technology.effects) {
        if (effect.type === "unlock-recipe" && prototypes.recipe[effect.recipe]!.hidden) broken.push(`${name} → ${effect.recipe}`)
      }
    }
    expect(broken.join(", ")).toBe("")
    expect(prototypes.technology["logistics"]!.hidden).toBe(true)
    expect(prototypes.technology[TECH.radio]!.hidden).toBe(false)
  })

  test("всё дерево исследуемо, все науки получаемы", () => {
    const reach = computeReach()
    const unreachable: string[] = []
    for (const [name, technology] of prototypes.technology) if (!technology.hidden && !reach.technologies.has(name)) unreachable.push(name)
    table.sort(unreachable)
    expect(unreachable.join(", ")).toBe("")
    const packs: string[] = []
    for (const [name, item] of prototypes.get_item_filtered([{ filter: "type", type: "tool" }])) {
      if (!item.hidden && !reach.items.has(name)) packs.push(name)
    }
    expect(packs.join(", ")).toBe("")
    // Машину можно сделать со старта.
    expect(reach.items.has(WORKER_MK1)).toBe(true)
  })

  test("старт freeplay: автоматоны и метки вместо бура и печи", () => {
    if (remote.interfaces["freeplay"]?.["get_created_items"] === undefined) return
    const items = remote.call("freeplay", "get_created_items") as Record<string, number | undefined>
    expect(items[WORKER_MK1]).toBe(2)
    expect(items[MARKER]).toBe(4)
    expect(items["burner-mining-drill"]).toBe(undefined)
    expect(items["stone-furnace"]).toBe(undefined)
  })

  test("стартовые программы опубликованы команде и компилируются", () => {
    expect(storage.startersPublished?.["player"]).toBe(true)
    // Модули — другие стартовые программы (lib/Помощники).
    const resolve = (name: string) => STARTER_PROGRAMS.find((s) => s.name === name)
    for (const starter of STARTER_PROGRAMS) {
      const result = compile(starter.source, { name: starter.name, resolve })
      expect(`${starter.name}: ${result.ok}`).toBe(`${starter.name}: true`)
      expect(`${starter.name}: ${findProgram(starter.name) !== undefined}`).toBe(`${starter.name}: true`)
    }
  })
})
