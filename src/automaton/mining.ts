// Действие «добыть»: машина копает месторождение рядом, по единице за шаг, как персонаж киркой.
// Время единицы — mining_time ресурса / скорость добычи машины. Продукты с вероятностью — через
// генератор случайных чисел из storage (одинаково у всех игроков). Кончилась клетка месторождения —
// переходит на соседнюю в пределах досягаемости. Жидкие ресурсы и ресурсы, требующие жидкости, — этап 7.
import { LuaEntity } from "factorio:runtime"
import { ActionState, distanceToEntity, face, registerActionHandler, StepOutcome } from "./actions"
import { RobotRecord } from "./registry"

/** Досягаемость до месторождения (как у персонажа) и скорость добычи машины Mk1. */
export const MINE_REACH = 2.7
export const MINING_SPEED = 0.5

export function initMining(): void {
  storage.rng ??= game.create_random_generator(20261008)
}

/** Даёт ли ресурс этот предмет (или любой, если предмет не указан). */
function yields(resource: LuaEntity, item: string | undefined): boolean {
  const props = resource.prototype.mineable_properties
  if (!props.minable || props.required_fluid !== undefined) return false
  const products = props.products ?? []
  if (products.some((p) => p.type === "fluid")) return false
  return item === undefined || products.some((p) => p.name === item)
}

/** Ближайшая клетка месторождения в пределах досягаемости, дающая предмет. */
function findResource(record: RobotRecord, item: string | undefined): LuaEntity | undefined {
  const position = record.entity.position
  let best: LuaEntity | undefined
  let bestDistance = math.huge
  for (const resource of record.entity.surface.find_entities_filtered({ type: "resource", position, radius: MINE_REACH + 1 })) {
    const d = distanceToEntity(position, resource)
    if (d <= MINE_REACH && d < bestDistance && yields(resource, item)) {
      best = resource
      bestDistance = d
    }
  }
  return best
}

function unitTicks(resource: LuaEntity): number {
  return math.max(1, math.ceil((resource.prototype.mineable_properties.mining_time / MINING_SPEED) * 60))
}

/** Клетка месторождения для действия: заданная (если ещё есть и рядом) или ближайшая подходящая. */
function resourceFor(record: RobotRecord, action: ActionState): LuaEntity | undefined {
  const target = action.params.target
  if (target?.valid && target.type === "resource" && distanceToEntity(record.entity.position, target) <= MINE_REACH && yields(target, action.params.item)) {
    return target
  }
  return findResource(record, action.params.item)
}

/** Подготовить следующую единицу: найти клетку, проверить место в грузе, повернуться. */
function nextUnit(record: RobotRecord, action: ActionState): StepOutcome {
  if (action.params.count !== undefined && action.done >= action.params.count) return { finish: true }
  const resource = resourceFor(record, action)
  // Если что-то уже добыто — это успех с причиной остановки; если ничего — ошибка.
  const stop = (why: "no-resource" | "cargo-full" | "out-of-reach"): StepOutcome =>
    action.done > 0 ? { finish: true, reason: why } : { finish: true, error: why }
  if (resource === undefined) {
    // Указанной цели нет рядом — «далеко»; не нашлось ничего — «нечего добывать».
    const target = action.params.target
    return stop(target?.valid && target.type === "resource" ? "out-of-reach" : "no-resource")
  }
  const sample = action.params.item ?? resource.prototype.mineable_properties.products?.[0]?.name
  if (sample !== undefined && !record.cargo.can_insert({ name: sample, count: 1 })) return stop("cargo-full")
  action.params.target = resource
  face(record, resource.position, "mine")
  return { after: unitTicks(resource) }
}

/** Добыть одну единицу из клетки: продукты в груз, запас клетки — на единицу меньше. */
function mineUnit(record: RobotRecord, action: ActionState, resource: LuaEntity): void {
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

registerActionHandler("mine", {
  start: (record, action) => nextUnit(record, action),
  step: (record, action) => {
    const resource = action.params.target
    // За время шага клетку могли истощить или машину увести.
    if (resource?.valid && distanceToEntity(record.entity.position, resource) <= MINE_REACH) mineUnit(record, action, resource)
    return nextUnit(record, action)
  },
})
