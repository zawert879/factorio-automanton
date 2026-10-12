// Действие «добыть»: машина копает месторождение рядом, по единице за шаг, как персонаж киркой.
// Время единицы — mining_time ресурса / скорость добычи машины. Продукты с вероятностью — через
// генератор случайных чисел из storage (одинаково у всех игроков). Кончилась клетка месторождения —
// переходит на соседнюю в пределах досягаемости. Жидкие ресурсы (нефть) качает pump (fluids.ts); ресурсу,
// которому нужна жидкость (уран — серная кислота), она идёт из бака: fluid_amount / 10 на единицу, как у бура.
// Деревья и скалы (21.2) добываются целиком за один шаг (mining_time дерева или скалы): все продукты — в груз,
// что не влезло — на землю рядом. По предмету руда важнее: шахтёр на угольном поле не разбивает скалу рядом.
import { LuaEntity } from "factorio:runtime"
import { ActionState, distanceToEntity, face, registerActionHandler, StepOutcome } from "./actions"
import { MINING_WATTS, spend } from "./energy"
import { isFlyer, robotMiningSpeed } from "./models"
import { RobotRecord } from "./registry"
import { EPSILON, takeFromTank, tankOf } from "./tank"

/** Досягаемость до месторождения (как у персонажа). Скорость добычи — у модели (src/automaton/models.ts). */
export const MINE_REACH = 2.7

export function initMining(): void {
  storage.rng ??= game.create_random_generator(20261008)
}

export function isTree(entity: LuaEntity): boolean {
  return entity.type === "tree"
}

/** Скала — простая сущность, которую игра считает камнем (фильтр «камни» у планировщика сноса). */
export function isRock(entity: LuaEntity): boolean {
  return entity.type === "simple-entity" && entity.prototype.count_as_rock_for_filtered_deconstruction === true
}

/** Дерево или скала: добываются целиком, за раз. */
export function isNatural(entity: LuaEntity): boolean {
  return isTree(entity) || isRock(entity)
}

/** Предметы, которые дают дерево или скала (имена без повторов, по порядку продуктов). */
export function naturalProducts(name: string): string[] {
  const result: string[] = []
  for (const product of prototypes.entity[name]?.mineable_properties.products ?? []) {
    if (product.type === "item" && !result.includes(product.name)) result.push(product.name)
  }
  return result
}

/** Даёт ли источник (клетка месторождения, дерево, скала) этот предмет (или любой, если предмет не указан). */
function yields(source: LuaEntity, item: string | undefined): boolean {
  if (source.type !== "resource" && !isNatural(source)) return false
  const props = source.prototype.mineable_properties
  if (!props.minable) return false
  const products = props.products ?? []
  if (products.some((p) => p.type === "fluid")) return false
  return item === undefined || products.some((p) => p.name === item)
}

/** Скала больше клетки: искать с запасом, а досягаемость мерить до её края. */
const SEARCH_MARGIN = 3

/** Ближайший источник предмета в пределах досягаемости: клетка месторождения, а если её нет — дерево или скала. */
function findSource(record: RobotRecord, item: string | undefined): LuaEntity | undefined {
  const position = record.entity.position
  let best: LuaEntity | undefined
  let bestRank = math.huge
  const found = record.entity.surface.find_entities_filtered({ type: ["resource", "tree", "simple-entity"], position, radius: MINE_REACH + SEARCH_MARGIN })
  for (const source of found) {
    const d = distanceToEntity(position, source)
    // Руда всегда раньше деревьев и скал: к расстоянию последних — заведомо больший сдвиг.
    const rank = source.type === "resource" ? d : d + MINE_REACH + SEARCH_MARGIN
    if (d <= MINE_REACH && rank < bestRank && yields(source, item)) {
      best = source
      bestRank = rank
    }
  }
  return best
}

/** Сколько жидкости (из бака) нужно на единицу добычи: как у бура — fluid_amount на 10 единиц. */
export function fluidPerUnit(resource: LuaEntity): number {
  return (resource.prototype.mineable_properties.fluid_amount ?? 0) / 10
}

/** Шаг добычи: единица руды или дерево (скала) целиком. */
function unitTicks(record: RobotRecord, resource: LuaEntity): number {
  return math.max(1, math.ceil((resource.prototype.mineable_properties.mining_time / robotMiningSpeed(record)) * 60))
}

/** Источник для действия: заданный (если ещё есть и рядом) или ближайший подходящий; у me.mine(tree) — только он. */
function sourceFor(record: RobotRecord, action: ActionState): LuaEntity | undefined {
  const target = action.params.target
  const near = target?.valid === true && distanceToEntity(record.entity.position, target) <= MINE_REACH
  if (action.params.only) return near ? target : undefined
  if (near && yields(target!, action.params.item)) return target
  return findSource(record, action.params.item)
}

/** Подготовить следующую единицу: найти клетку, проверить место в грузе, повернуться. */
function nextUnit(record: RobotRecord, action: ActionState): StepOutcome {
  if (action.params.count !== undefined && action.done >= action.params.count) return { finish: true }
  const resource = sourceFor(record, action)
  // Если что-то уже добыто — это успех с причиной остановки; если ничего — ошибка.
  const stop = (why: "no-resource" | "cargo-full" | "out-of-reach" | "not-enough-items" | "invalid-target"): StepOutcome =>
    action.done > 0 ? { finish: true, reason: why } : { finish: true, error: why }
  if (resource === undefined) {
    // Указанной цели нет рядом — «далеко», её уже нет — «нет цели»; не нашлось ничего — «нечего добывать».
    const target = action.params.target
    if (action.params.only) return stop(target?.valid ? "out-of-reach" : "invalid-target")
    return stop(target?.valid && target.type === "resource" ? "out-of-reach" : "no-resource")
  }
  const sample = action.params.item ?? resource.prototype.mineable_properties.products?.[0]?.name
  if (sample !== undefined && !record.cargo.can_insert({ name: sample, count: 1 })) return stop("cargo-full")
  const required = resource.prototype.mineable_properties.required_fluid
  if (required !== undefined) {
    const tank = tankOf(record)
    if (tank.fluid !== required || tank.amount + EPSILON < fluidPerUnit(resource)) return stop("not-enough-items")
  }
  action.params.target = resource
  face(record, resource.position, "mine")
  return { after: unitTicks(record, resource) }
}

/** Добыть одну единицу из клетки: продукты в груз, запас клетки — на единицу меньше. */
function mineUnit(record: RobotRecord, action: ActionState, resource: LuaEntity): void {
  const required = resource.prototype.mineable_properties.required_fluid
  if (required !== undefined && takeFromTank(record, required, fluidPerUnit(resource)) + EPSILON < fluidPerUnit(resource)) return
  const rng = storage.rng
  for (const product of resource.prototype.mineable_properties.products ?? []) {
    if (product.type !== "item") continue
    if (product.probability !== undefined && rng() >= product.probability) continue
    const amount =
      product.amount ?? math.floor((product.amount_min ?? 1) + rng() * ((product.amount_max ?? 1) - (product.amount_min ?? 1) + 1))
    if (amount <= 0) continue
    const inserted = record.cargo.insert({ name: product.name, count: amount })
    if (action.params.item === undefined || product.name === action.params.item) action.done += inserted
  }
  if (!resource.prototype.infinite_resource) {
    if (resource.amount > 1) resource.amount -= 1
    else resource.deplete()
  }
}

/** Срубить дерево или разбить скалу: все продукты — в груз, что не влезло — на землю у неё. */
function mineWhole(record: RobotRecord, action: ActionState, source: LuaEntity): void {
  const rng = storage.rng
  const { surface, position } = source
  for (const product of source.prototype.mineable_properties.products ?? []) {
    if (product.type !== "item") continue
    if (product.probability !== undefined && rng() >= product.probability) continue
    const amount =
      product.amount ?? math.floor((product.amount_min ?? 1) + rng() * ((product.amount_max ?? 1) - (product.amount_min ?? 1) + 1))
    if (amount <= 0) continue
    const inserted = record.cargo.insert({ name: product.name, count: amount })
    if (inserted < amount) surface.spill_item_stack({ position, stack: { name: product.name, count: amount - inserted }, enable_looted: true })
    if (action.params.item === undefined || product.name === action.params.item) action.done += inserted
  }
  source.destroy({ raise_destroy: true })
}

registerActionHandler("mine", {
  // Летающие не добывают.
  start: (record, action) => (isFlyer(record) ? { finish: true, error: "invalid-target" } : nextUnit(record, action)),
  step: (record, action) => {
    const resource = action.params.target
    // За время шага клетку могли истощить или машину увести.
    if (resource?.valid && distanceToEntity(record.entity.position, resource) <= MINE_REACH) {
      if (!spend(record, (unitTicks(record, resource) / 60) * MINING_WATTS)) {
        return action.done > 0 ? { finish: true, reason: "no-fuel" } : { finish: true, error: "no-fuel" }
      }
      if (resource.type === "resource") mineUnit(record, action, resource)
      else {
        mineWhole(record, action, resource)
        if (action.params.only) return { finish: true }
      }
    }
    return nextUnit(record, action)
  },
})
