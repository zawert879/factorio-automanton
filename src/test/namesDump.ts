// Выгрузка имён (24.1, npm run names): здания (с классом для программ), предметы и жидкости, которые есть в игре
// с модом, — script-output/automaton-names.json. Включается служебным модом automaton-names
// (tools/names/generate.mjs); из выгрузки и локалей игры собираются docs/NAMES.md и подсказки имён для VS Code.
import { classOfPrototype } from "../program/handles"
import { MARKER_ENTITIES, modelOf } from "../names"

/** Предметы-инструменты: в груз и здания не попадают, программам не нужны. */
const TOOL_TYPES: Record<string, boolean> = {
  blueprint: true,
  "blueprint-book": true,
  "deconstruction-item": true,
  "upgrade-item": true,
  "selection-tool": true,
  "copy-paste-tool": true,
  "spidertron-remote": true,
}

/** Ставятся из предмета, но не здания: дроны летают сами. */
const NOT_BUILDINGS: Record<string, boolean> = { "construction-robot": true, "logistic-robot": true, "combat-robot": true }

script.on_nth_tick(1, () => {
  script.on_nth_tick(1, undefined)
  const buildings: Record<string, unknown>[] = []
  for (const [name, entity] of prototypes.entity) {
    const items = entity.items_to_place_this
    if (entity.hidden || items === undefined || items.length === 0 || entity.flags?.["player-creation"] !== true || NOT_BUILDINGS[entity.type]) continue
    // Метки и машины — не здания (zone.find их не находит).
    if (MARKER_ENTITIES.includes(name) || modelOf(name) !== undefined) continue
    buildings.push({ name, type: entity.type, class: classOfPrototype(entity.type, name), item: items[0].name })
  }
  const items: Record<string, unknown>[] = []
  for (const [name, item] of prototypes.item) {
    // Параметры чертежей (parameter-0…9) — не предметы.
    if (item.hidden || item.parameter || TOOL_TYPES[item.type] || item.flags?.["only-in-cursor"] === true) continue
    items.push({
      name,
      type: item.type,
      group: item.group.name,
      groupOrder: item.group.order,
      subgroupOrder: item.subgroup.order,
      order: item.order,
      places: item.place_result?.name,
    })
  }
  const fluids: Record<string, unknown>[] = []
  for (const [name, fluid] of prototypes.fluid) {
    if (fluid.hidden || fluid.parameter) continue
    fluids.push({ name, order: fluid.order })
  }
  const groups: Record<string, unknown>[] = []
  for (const [name, group] of prototypes.item_group) groups.push({ name, order: group.order })
  helpers.write_file("automaton-names.json", helpers.table_to_json({ version: script.active_mods.automaton, buildings, items, fluids, groups }), false)
})
