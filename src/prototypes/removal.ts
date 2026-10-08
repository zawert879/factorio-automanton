// Удаление ванили (этап 6): конвейеры, манипуляторы, буры (и нефтевышка), логистические роботы и сундуки
// (кроме сундука хранения), прибрежный насос — их работу делают автоматоны. Работает по типам прототипов, поэтому
// задевает и такие же здания других модов. Вызывается в data-final-fixes.
//
// 6.1 Прототипы не удаляются, а скрываются (hidden): на их имена ссылаются достижения, симуляции,
//     обновления зданий; рецепты отключаются, из технологий убираются.
// 6.2 Удалённый ингредиент рецепта заменяется ингредиентами его собственного рецепта (зелёная наука:
//     манипулятор и конвейер → схема, шестерни, пластины). В конце — проверка: ни один видимый рецепт
//     не ссылается на удалённое, иначе загрузка игры останавливается с ошибкой.
// 6.3 Технологии без единого оставшегося эффекта скрываются; ссылки на них в чужих prerequisites
//     заменяются их собственными prerequisites (дерево не рвётся).
// Подсказки (tips and tricks), которые говорят об удалённом, убираются.
import { PrototypeData } from "factorio:common"
import { REMOVED_ENTITY_TYPES } from "../names"

declare const data: PrototypeData

/** Бонусы технологий, которые без удалённых зданий бессмысленны. */
const REMOVED_MODIFIERS: Record<string, boolean> = {
  "inserter-stack-size-bonus": true,
  "bulk-inserter-capacity-bonus": true,
  "belt-stack-size-bonus": true,
}

type Proto = Record<string, any>
const raw = data.raw as unknown as Record<string, Record<string, Proto> | undefined>

function hide(proto: Proto): void {
  proto.hidden = true
  proto.hidden_in_factoriopedia = true
}

/** Ингредиенты и результаты рецепта в 2.0: { type, name, amount } (у результатов возможны amount_min/max). */
interface Stack {
  type: string
  name: string
  amount?: number
  amount_min?: number
  amount_max?: number
}

export function removeVanilla(): void {
  // ---------- 6.1 Сущности, предметы, рецепты ----------
  const removedEntities = new Set<string>()
  for (const type of REMOVED_ENTITY_TYPES) {
    for (const [name, proto] of pairs(raw[type] ?? {})) {
      removedEntities.add(name)
      hide(proto)
    }
  }
  for (const [name, proto] of pairs(raw["logistic-container"] ?? {})) {
    if (proto.logistic_mode === "storage") continue
    removedEntities.add(name)
    hide(proto)
  }
  // Улучшение (next_upgrade) требует видимого предмета у цели: у удалённых и ведущих к удалённым — убрать.
  for (const [, prototypes] of pairs(raw as Record<string, Record<string, Proto>>)) {
    for (const [name, proto] of pairs(prototypes)) {
      if (proto.next_upgrade !== undefined && (removedEntities.has(name) || removedEntities.has(proto.next_upgrade))) proto.next_upgrade = undefined
    }
  }

  const removedItems = new Set<string>()
  for (const [itemType] of pairs(defines.prototypes.item as unknown as Record<string, unknown>)) {
    for (const [name, proto] of pairs(raw[itemType] ?? {})) {
      if (typeof proto.place_result === "string" && removedEntities.has(proto.place_result)) {
        removedItems.add(name)
        hide(proto)
      }
    }
  }

  const recipes = raw.recipe ?? {}
  const removedRecipes = new Set<string>()
  /** Рецепт удалённого предмета: из чего его делали (для замены в других рецептах). */
  const sourceOf = new Map<string, { ingredients: Stack[]; amount: number }>()
  for (const [name, recipe] of pairs(recipes)) {
    const results = (recipe.results ?? []) as Stack[]
    const removed = results.find((r) => r.type === "item" && removedItems.has(r.name))
    if (removed === undefined) continue
    removedRecipes.add(name)
    hide(recipe)
    recipe.enabled = false
    if (!sourceOf.has(removed.name)) sourceOf.set(removed.name, { ingredients: recipe.ingredients ?? [], amount: removed.amount ?? 1 })
  }

  // ---------- 6.2 Ремонт рецептов ----------
  /** Ингредиенты на count штук удалённого предмета — его рецепт, раскрытый рекурсивно. */
  function expand(item: string, count: number, depth: number): Stack[] {
    const source = sourceOf.get(item)
    if (source === undefined || depth > 10) error(`automaton: удалённый предмет ${item} нечем заменить в рецептах`)
    const result: Stack[] = []
    for (const ingredient of source.ingredients) {
      const amount = math.ceil(((ingredient.amount ?? 1) * count) / source.amount)
      if (ingredient.type === "item" && removedItems.has(ingredient.name)) for (const s of expand(ingredient.name, amount, depth + 1)) result.push(s)
      else result.push({ ...ingredient, amount })
    }
    return result
  }

  for (const [name, recipe] of pairs(recipes)) {
    if (removedRecipes.has(name)) continue
    const ingredients = (recipe.ingredients ?? []) as Stack[]
    if (!ingredients.some((i) => i.type === "item" && removedItems.has(i.name))) continue
    const merged = new Map<string, Stack>()
    const order: string[] = []
    const add = (stack: Stack) => {
      const key = `${stack.type}/${stack.name}`
      const existing = merged.get(key)
      if (existing === undefined) {
        merged.set(key, { ...stack })
        order.push(key)
      } else existing.amount = (existing.amount ?? 1) + (stack.amount ?? 1)
    }
    for (const ingredient of ingredients) {
      if (ingredient.type === "item" && removedItems.has(ingredient.name)) for (const s of expand(ingredient.name, ingredient.amount ?? 1, 0)) add(s)
      else add(ingredient)
    }
    recipe.ingredients = order.map((key) => merged.get(key)!)
  }

  // ---------- 6.3 Технологии ----------
  const technologies = raw.technology ?? {}
  const removedTechnologies = new Set<string>()
  for (const [name, technology] of pairs(technologies)) {
    const effects = (technology.effects ?? []) as Proto[]
    if (effects.length === 0) continue
    const kept = effects.filter((e) => !(e.type === "unlock-recipe" && removedRecipes.has(e.recipe)) && !REMOVED_MODIFIERS[e.type])
    technology.effects = kept
    if (kept.length === 0) {
      removedTechnologies.add(name)
      hide(technology)
    }
  }
  /** Предпосылки технологии без удалённых: удалённая заменяется своими предпосылками. */
  function prerequisites(list: string[], depth: number): string[] {
    const result: string[] = []
    for (const name of list) {
      if (!removedTechnologies.has(name)) result.push(name)
      else if (depth < 20) for (const p of prerequisites(technologies[name]?.prerequisites ?? [], depth + 1)) result.push(p)
    }
    return result
  }
  for (const [name, technology] of pairs(technologies)) {
    if (removedTechnologies.has(name) || technology.prerequisites === undefined) continue
    const seen = new Set<string>()
    technology.prerequisites = prerequisites(technology.prerequisites, 0).filter((p) => {
      if (seen.has(p)) return false
      seen.add(p)
      return true
    })
  }

  // ---------- Подсказки ----------
  const removedNames = new Set<string>([...removedEntities, ...removedItems])
  /** Упоминает ли значение (подсказку целиком) удалённое: имя целиком или в кавычках внутри кода симуляции. */
  function mentionsRemoved(value: unknown, depth: number): boolean {
    if (typeof value === "string") {
      if (removedNames.has(value)) return true
      for (const name of removedNames) {
        const [position] = string.find(value, `"${name}"`, 1, true)
        if (position !== undefined) return true
      }
      return false
    }
    if (type(value) !== "table" || depth > 12) return false
    for (const [, item] of pairs(value as Record<string, unknown>)) if (mentionsRemoved(item, depth + 1)) return true
    return false
  }
  const tips = raw["tips-and-tricks-item"] ?? {}
  const removedTips = new Set<string>()
  for (const [name, tip] of pairs(tips)) if (mentionsRemoved(tip, 0)) removedTips.add(name)
  // Подсказки, зависящие от удалённых, — тоже (иначе ссылка в никуда).
  let changed = true
  while (changed) {
    changed = false
    for (const [name, tip] of pairs(tips)) {
      if (removedTips.has(name)) continue
      if (((tip.dependencies ?? []) as string[]).some((d) => removedTips.has(d))) {
        removedTips.add(name)
        changed = true
      }
    }
  }
  for (const name of removedTips) tips[name] = undefined as never

  // ---------- Проверка ----------
  for (const [name, recipe] of pairs(recipes)) {
    if (recipe.hidden) continue
    for (const stack of [...((recipe.ingredients ?? []) as Stack[]), ...((recipe.results ?? []) as Stack[])]) {
      if (stack.type === "item" && removedItems.has(stack.name)) error(`automaton: рецепт ${name} ссылается на удалённый предмет ${stack.name}`)
    }
  }
  for (const [name, technology] of pairs(technologies)) {
    if (technology.hidden) continue
    for (const p of (technology.prerequisites ?? []) as string[]) {
      if (removedTechnologies.has(p)) error(`automaton: технология ${name} зависит от удалённой ${p}`)
    }
  }
  log(`automaton: убрано зданий ${removedEntities.size}, предметов ${removedItems.size}, рецептов ${removedRecipes.size}, технологий ${removedTechnologies.size}, подсказок ${removedTips.size}`)
}
