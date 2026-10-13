// Словарь имён для справки F1 (24.1, раздел «Имена»): какие здания (по классам программ), предметы и жидкости есть
// в игре — строится из прототипов, поэтому с модами точнее, чем docs/NAMES.md (там только базовая игра).
// Отбор — как у выгрузки для docs/NAMES.md (src/test/namesDump.ts): то, что мод убрал, и служебное не показывается.
import { LocalisedString, LuaForce } from "factorio:runtime"
import { HOST_CLASSES } from "../lang/hostClasses"
import { MARKER_ENTITIES, modelOf } from "../names"
import { classOfPrototype } from "../program/handles"

export interface NameRow {
  name: string
  sprite: string
  title: LocalisedString
  /** Класс здания (у зданий). */
  cls?: string
}

export interface NameCategory {
  key: string
  caption: LocalisedString
  rows: NameRow[]
}

const TOOL_TYPES: Record<string, boolean> = {
  blueprint: true,
  "blueprint-book": true,
  "deconstruction-item": true,
  "upgrade-item": true,
  "selection-tool": true,
  "copy-paste-tool": true,
  "spidertron-remote": true,
}
const NOT_BUILDINGS: Record<string, boolean> = { "construction-robot": true, "logistic-robot": true, "combat-robot": true }

/** Категории словаря: классы зданий (порядок — как в API), группы предметов, жидкости. */
export function nameCategories(): NameCategory[] {
  const byClass = new LuaMap<string, NameRow[]>()
  for (const [name, entity] of prototypes.entity) {
    const items = entity.items_to_place_this
    if (entity.hidden || items === undefined || items.length === 0 || entity.flags?.["player-creation"] !== true || NOT_BUILDINGS[entity.type]) continue
    if (MARKER_ENTITIES.includes(name) || modelOf(name) !== undefined) continue
    const cls = classOfPrototype(entity.type, name)
    const list = byClass.get(cls) ?? []
    list.push({ name, sprite: `entity/${name}`, title: entity.localised_name, cls })
    byClass.set(cls, list)
  }
  const result: NameCategory[] = []
  for (const [cls, parent] of HOST_CLASSES) {
    if (cls !== "Building" && parent !== "Building") continue
    const rows = byClass.get(cls)
    if (rows !== undefined) result.push({ key: `class:${cls}`, caption: cls === "Building" ? ["automaton-help.names-other"] : cls, rows })
  }
  // «Building» объявлен раньше подклассов — здания без своего класса переносим в конец.
  const other = result.findIndex((c) => c.key === "class:Building")
  // В два шага: в Lua индекс push (#result + 1) вычисляется раньше splice — получилась бы дыра.
  if (other >= 0) {
    const [building] = result.splice(other, 1)
    result.push(building)
  }

  const byGroup = new LuaMap<string, NameRow[]>()
  const groups: string[] = []
  const items: { row: NameRow; key: string; group: string }[] = []
  for (const [name, item] of prototypes.item) {
    if (item.hidden || item.parameter || TOOL_TYPES[item.type] || item.flags?.["only-in-cursor"] === true) continue
    items.push({ row: { name, sprite: `item/${name}`, title: item.localised_name }, key: `${item.group.order}|${item.subgroup.order}|${item.order}|${name}`, group: item.group.name })
  }
  table.sort(items, (a, b) => a.key < b.key)
  for (const { row, group } of items) {
    if (!byGroup.has(group)) {
      byGroup.set(group, [])
      groups.push(group)
    }
    byGroup.get(group)!.push(row)
  }
  for (const group of groups) result.push({ key: `items:${group}`, caption: ["", ["automaton-help.names-items"], ": ", prototypes.item_group[group]!.localised_name], rows: byGroup.get(group)! })

  const fluids: NameRow[] = []
  for (const [name, fluid] of prototypes.fluid) {
    if (fluid.hidden || fluid.parameter) continue
    fluids.push({ name, sprite: `fluid/${name}`, title: fluid.localised_name })
  }
  result.push({ key: "fluids", caption: ["automaton-help.names-fluids"], rows: fluids })
  return result
}

/** Есть ли у команды: предмет или здание делается открытым рецептом (у руды и прочего без рецепта — да). */
export function available(force: LuaForce, name: string): boolean {
  const entity = prototypes.entity[name]
  const item = entity?.items_to_place_this?.[0]?.name ?? name
  const recipe = force.recipes[item]
  return recipe === undefined || recipe.enabled
}
