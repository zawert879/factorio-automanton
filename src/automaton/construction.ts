// Наладка и строительство (8.5, 8.6): выбрать рецепт сборщика, поставить здание из груза, разобрать здание
// в груз, повернуть. Всё — в пределах досягаемости (как у персонажа), с короткой задержкой.
import { LuaEntity, MapPosition } from "factorio:runtime"
import { modelOf } from "../names"
import { ActionState, distanceToEntity, face, registerActionHandler, StepOutcome } from "./actions"
import { HANDLING_JOULES, spend } from "./energy"
import { RobotRecord } from "./registry"
import { REACH } from "./transfer"

export const SET_RECIPE_TICKS = 30
export const BUILD_TICKS = 30
export const DECONSTRUCT_TICKS = 30
export const ROTATE_TICKS = 10

function inReach(record: RobotRecord, entity: LuaEntity | undefined): entity is LuaEntity {
  return entity !== undefined && entity.valid && distanceToEntity(record.entity.position, entity) <= REACH
}

function distanceTo(record: RobotRecord, position: MapPosition): number {
  const { x, y } = record.entity.position
  return math.sqrt((position.x - x) ** 2 + (position.y - y) ** 2)
}

/** Начало: цель есть и рядом — повернуться и ждать; иначе ошибка. */
function begin(record: RobotRecord, action: ActionState, ticks: number): StepOutcome {
  const target = action.params.target
  if (target === undefined || !target.valid) return { finish: true, error: "invalid-target" }
  if (!inReach(record, target)) return { finish: true, error: "out-of-reach" }
  face(record, target.position, "idle")
  return { after: ticks }
}

/** Предметы — в груз, что не влезло — на землю рядом с машиной. */
function intoCargo(record: RobotRecord, items: { name: string; count: number; quality?: string }[]): void {
  for (const item of items) {
    const stack = { name: item.name, count: item.count, quality: item.quality }
    const inserted = record.cargo.insert(stack)
    if (inserted < item.count) {
      record.entity.surface.spill_item_stack({ position: record.entity.position, stack: { ...stack, count: item.count - inserted } })
    }
  }
}

// ---------- setRecipe ----------

registerActionHandler("set-recipe", {
  start: (record, action) => {
    const target = action.params.target
    const recipe = action.params.item!
    if (target === undefined || !target.valid || target.type !== "assembling-machine") return { finish: true, error: "invalid-target" }
    const known = (record.entity.force as { recipes: Record<string, { enabled: boolean; category: string } | undefined> }).recipes[recipe]
    if (known === undefined || !known.enabled || target.prototype.crafting_categories?.[known.category] === undefined) {
      return { finish: true, error: "invalid-target" }
    }
    return begin(record, action, SET_RECIPE_TICKS)
  },
  step: (record, action) => {
    const target = action.params.target
    if (!inReach(record, target)) return { finish: true, error: "out-of-reach" }
    if (!spend(record, HANDLING_JOULES)) return { finish: true, error: "no-fuel" }
    // Смена рецепта выдаёт обратно ингредиенты и продукты прежнего — они уходят в груз.
    const [current] = target.get_recipe()
    if (current?.name !== action.params.item) intoCargo(record, target.set_recipe(action.params.item))
    action.done = 1
    return { finish: true }
  },
})

// ---------- build ----------

/** Где и что ставить: здание из предмета, место свободно, досягаемо. */
function buildCheck(record: RobotRecord, action: ActionState): StepOutcome | undefined {
  const item = action.params.item!
  const position = action.params.position!
  const entity = prototypes.item[item]?.place_result
  // Машины ставятся из предмета через заглушку — их строит игрок, а не программа.
  if (entity === undefined || modelOf(item) !== undefined) return { finish: true, error: "invalid-target" }
  if (record.cargo.get_item_count(item) < 1) return { finish: true, error: "not-enough-items" }
  if (distanceTo(record, position) > REACH) return { finish: true, error: "out-of-reach" }
  const free = record.entity.surface.can_place_entity({
    name: entity.name,
    position,
    direction: action.params.direction,
    force: record.entity.force,
    build_check_type: defines.build_check_type.manual,
  })
  if (!free) return { finish: true, error: "target-full" }
  return undefined
}

registerActionHandler("build", {
  start: (record, action) => {
    const problem = buildCheck(record, action)
    if (problem !== undefined) return problem
    face(record, action.params.position!, "idle")
    return { after: BUILD_TICKS }
  },
  step: (record, action) => {
    const problem = buildCheck(record, action)
    if (problem !== undefined) return problem
    if (!spend(record, HANDLING_JOULES)) return { finish: true, error: "no-fuel" }
    const item = action.params.item!
    const built = record.entity.surface.create_entity({
      name: prototypes.item[item]!.place_result!.name,
      position: action.params.position!,
      direction: action.params.direction,
      force: record.entity.force,
      raise_built: true,
    })
    if (built === undefined) return { finish: true, error: "target-full" }
    record.cargo.remove({ name: item, count: 1 })
    action.entity = built
    action.done = 1
    return { finish: true }
  },
})

// ---------- deconstruct ----------

/** Что нельзя разобрать программой: машины, персонажи, месторождения, деревья и камни (это добыча). */
const NOT_DECONSTRUCTIBLE: Record<string, boolean> = { unit: true, character: true, resource: true, tree: true, "simple-entity": true, fish: true }

registerActionHandler("deconstruct", {
  start: (record, action) => {
    const target = action.params.target
    if (target === undefined || !target.valid || NOT_DECONSTRUCTIBLE[target.type] || !target.minable || target.force !== record.entity.force) {
      return { finish: true, error: "invalid-target" }
    }
    return begin(record, action, DECONSTRUCT_TICKS)
  },
  step: (record, action) => {
    const target = action.params.target
    if (!inReach(record, target)) return { finish: true, error: "out-of-reach" }
    if (!spend(record, HANDLING_JOULES)) return { finish: true, error: "no-fuel" }
    // Здание и его содержимое — в груз; не влезает — здание остаётся (как у персонажа).
    if (!target.mine({ inventory: record.cargo, force: false, raise_destroyed: true })) return { finish: true, error: "cargo-full" }
    action.done = 1
    return { finish: true }
  },
})

// ---------- rotate ----------

registerActionHandler("rotate", {
  start: (record, action) => begin(record, action, ROTATE_TICKS),
  step: (record, action) => {
    const target = action.params.target
    if (!inReach(record, target)) return { finish: true, error: "out-of-reach" }
    if (!target.supports_direction || !target.rotate({ reverse: action.params.reverse === true })) return { finish: true, error: "invalid-target" }
    action.done = 1
    return { finish: true }
  },
})
