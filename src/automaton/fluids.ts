// Жидкости (этап 7): бак машины и действия «набрать» (pump), «залить» (fill), «слить» (drain).
// Бак держит одну жидкость с температурой (смешивание одной жидкости — средняя температура по объёму).
//
// pump: вода — с клетки воды рядом (у берега), нефть — с месторождения рядом. Нефть качается как
// нефтевышкой: цикл раз в mining_time секунд даёт продукт × выработку (запас / норма), запас бесконечного
// месторождения падает на infinite_depletion за цикл, но не ниже минимума — выработка падает, как в игре.
// fill / drain — в здание и из здания в пределах досягаемости (котёл, резервуар, химзавод, нефтезавод…):
// через fluidbox здания, поэтому жидкость попадает только туда, куда её примет само здание.
//
// Коды ошибок — те же, что у предметов (бак — «груз»): бак полон или занят другой жидкостью — cargo-full,
// в баке нет нужного — not-enough-items, здание не принимает — target-full, нечего качать — no-resource.
import { LuaEntity, MapPosition } from "factorio:runtime"
import { ActionState, distanceToEntity, face, registerActionHandler, StepOutcome } from "./actions"
import { spend } from "./energy"
import { MINE_REACH } from "./mining"
import { RobotRecord } from "./registry"
import { addToTank, EPSILON, takeFromTank, tankFree, tankOf } from "./tank"
import { REACH } from "./transfer"

/** Скорость набора воды и перелива в здание и из здания, ед/с. */
export const WATER_PER_SECOND = 500
export const TRANSFER_PER_SECOND = 500
/** Нефть — как у нефтевышки: скорость добычи 1. */
export const OIL_PUMP_SPEED = 1
/** Шаг перелива, тиков. */
export const FLUID_STEP_TICKS = 10
/** Насос машины: 50 кВт, пока качает или переливает. */
export const PUMP_WATTS = 50_000

/** Энергия на шаг насоса; false — кончилась. */
function pumpEnergy(record: RobotRecord, ticks: number): boolean {
  return spend(record, (PUMP_WATTS * ticks) / 60)
}

/** Итог: если что-то уже сделано — успех с причиной, иначе ошибка. */
function stop(action: ActionState, why: "no-resource" | "cargo-full" | "target-full" | "not-enough-items" | "out-of-reach" | "no-fuel"): StepOutcome {
  return action.done > EPSILON ? { finish: true, reason: why } : { finish: true, error: why }
}

function remaining(action: ActionState): number {
  return action.params.count === undefined ? math.huge : action.params.count - action.done
}

// ---------- Набрать: вода и нефть ----------

/** Даёт ли месторождение эту жидкость. */
function fluidResource(resource: LuaEntity, fluid: string): boolean {
  const props = resource.prototype.mineable_properties
  return props.minable && (props.products ?? []).some((p) => p.type === "fluid" && p.name === fluid)
}

/** Месторождение жидкости в досягаемости добычи. */
function findFluidResource(record: RobotRecord, fluid: string): LuaEntity | undefined {
  const position = record.entity.position
  let best: LuaEntity | undefined
  let bestDistance = math.huge
  for (const resource of record.entity.surface.find_entities_filtered({ type: "resource", position, radius: MINE_REACH + 2 })) {
    const d = distanceToEntity(position, resource)
    if (d <= MINE_REACH && d < bestDistance && fluidResource(resource, fluid)) {
      best = resource
      bestDistance = d
    }
  }
  return best
}

/** Клетка с этой жидкостью (вода у берега) в досягаемости добычи; центр клетки. */
export function findFluidTile(record: RobotRecord, fluid: string): MapPosition | undefined {
  const position = record.entity.position
  let best: MapPosition | undefined
  let bestDistance = math.huge
  for (const tile of record.entity.surface.find_tiles_filtered({ position, radius: MINE_REACH + 1 })) {
    if (tile.prototype.fluid?.name !== fluid) continue
    const { x, y } = tile.position
    // До края клетки, как досягаемость до здания.
    const dx = math.max(x - position.x, 0, position.x - (x + 1))
    const dy = math.max(y - position.y, 0, position.y - (y + 1))
    const d = math.sqrt(dx * dx + dy * dy)
    if (d <= MINE_REACH && d < bestDistance) {
      best = { x: x + 0.5, y: y + 0.5 }
      bestDistance = d
    }
  }
  return best
}

/** Тики одного цикла нефтевышки на этом месторождении. */
function oilCycleTicks(resource: LuaEntity): number {
  return math.max(1, math.ceil((resource.prototype.mineable_properties.mining_time / OIL_PUMP_SPEED) * 60))
}

/** Один цикл откачки месторождения: продукт × выработка, запас падает (как у нефтевышки). */
function pumpCycle(record: RobotRecord, action: ActionState, resource: LuaEntity): number {
  const prototype = resource.prototype
  const fluid = action.params.item!
  let produced = 0
  for (const product of prototype.mineable_properties.products ?? []) {
    if (product.type !== "fluid" || product.name !== fluid) continue
    const base = product.amount ?? ((product.amount_min ?? 0) + (product.amount_max ?? 0)) / 2
    produced += prototype.infinite_resource ? (base * resource.amount) / prototype.normal_resource_amount! : base
  }
  const n = addToTank(record, fluid, math.min(produced, remaining(action)), defaultTemperature(fluid))
  if (prototype.infinite_resource) {
    resource.amount = math.max(prototype.minimum_resource_amount ?? 0, resource.amount - (prototype.infinite_depletion_resource_amount ?? 1))
  } else if (resource.amount <= 1) {
    resource.deplete()
  } else {
    resource.amount -= 1
  }
  return n
}

/** Температура жидкости из земли и воды — её температура по умолчанию. */
function defaultTemperature(fluid: string): number {
  return prototypes.fluid[fluid]?.default_temperature ?? 15
}

function pumpStep(record: RobotRecord, action: ActionState): StepOutcome {
  const fluid = action.params.item!
  if (remaining(action) <= EPSILON) return { finish: true }
  if (tankFree(record, fluid) <= EPSILON) return stop(action, "cargo-full")
  const resource = action.params.target
  if (resource !== undefined) {
    if (!resource.valid || distanceToEntity(record.entity.position, resource) > MINE_REACH) return stop(action, "no-resource")
    const ticks = oilCycleTicks(resource)
    if (!pumpEnergy(record, ticks)) return stop(action, "no-fuel")
    action.done += pumpCycle(record, action, resource)
    return remaining(action) <= EPSILON || tankFree(record, fluid) <= EPSILON ? { finish: true } : { after: ticks }
  }
  const tile = action.params.position
  if (tile === undefined || record.entity.surface.get_tile(tile.x, tile.y).prototype.fluid?.name !== fluid) return stop(action, "no-resource")
  if (!pumpEnergy(record, FLUID_STEP_TICKS)) return stop(action, "no-fuel")
  const chunk = (WATER_PER_SECOND * FLUID_STEP_TICKS) / 60
  action.done += addToTank(record, fluid, math.min(chunk, remaining(action)), defaultTemperature(fluid))
  return remaining(action) <= EPSILON || tankFree(record, fluid) <= EPSILON ? { finish: true } : { after: FLUID_STEP_TICKS }
}

registerActionHandler("pump", {
  start: (record, action) => {
    const fluid = action.params.item!
    if (tankFree(record, fluid) <= EPSILON) return { finish: true, error: "cargo-full" }
    const resource = findFluidResource(record, fluid)
    if (resource !== undefined) {
      action.params.target = resource
      face(record, resource.position, "mine")
      // Первый цикл — после его длительности, как у нефтевышки.
      return { after: oilCycleTicks(resource) }
    }
    const tile = findFluidTile(record, fluid)
    if (tile === undefined) return { finish: true, error: "no-resource" }
    action.params.position = tile
    face(record, tile, "mine")
    return { after: FLUID_STEP_TICKS }
  },
  step: (record, action) => pumpStep(record, action),
})

// ---------- Залить в здание и слить из здания ----------

function inReach(record: RobotRecord, target: LuaEntity | undefined): target is LuaEntity {
  return target !== undefined && target.valid && distanceToEntity(record.entity.position, target) <= REACH
}

/** Температура жидкости в здании (первый fluidbox с ней) — нужна, чтобы горячий пар остался горячим. */
function fluidTemperature(entity: LuaEntity, fluid: string): number | undefined {
  const boxes = entity.fluidbox
  for (let i = 1; i <= boxes.length; i++) {
    const content = boxes[i - 1]
    if (content !== undefined && content.name === fluid && content.amount > EPSILON) return content.temperature
  }
  return undefined
}

function fillStep(record: RobotRecord, action: ActionState): StepOutcome {
  const target = action.params.target
  if (!inReach(record, target)) return stop(action, "out-of-reach")
  const tank = tankOf(record)
  if (tank.fluid === undefined || tank.amount <= EPSILON) return stop(action, "not-enough-items")
  if (remaining(action) <= EPSILON) return { finish: true }
  if (!pumpEnergy(record, FLUID_STEP_TICKS)) return stop(action, "no-fuel")
  const chunk = math.min((TRANSFER_PER_SECOND * FLUID_STEP_TICKS) / 60, tank.amount, remaining(action))
  const inserted = target.insert_fluid({ name: tank.fluid, amount: chunk, temperature: tank.temperature })
  if (inserted <= EPSILON) return stop(action, "target-full")
  action.done += takeFromTank(record, tank.fluid, inserted)
  return { after: FLUID_STEP_TICKS }
}

registerActionHandler("fill", {
  start: (record, action) => {
    const target = action.params.target
    if (target === undefined || !target.valid) return { finish: true, error: "invalid-target" }
    if (!inReach(record, target)) return { finish: true, error: "out-of-reach" }
    const tank = tankOf(record)
    if (tank.fluid === undefined || tank.amount <= EPSILON) return { finish: true, error: "not-enough-items" }
    face(record, target.position, "idle")
    return fillStep(record, action)
  },
  step: (record, action) => fillStep(record, action),
})

function drainStep(record: RobotRecord, action: ActionState): StepOutcome {
  const target = action.params.target
  const fluid = action.params.item!
  if (!inReach(record, target)) return stop(action, "out-of-reach")
  if (remaining(action) <= EPSILON) return { finish: true }
  if (tankFree(record, fluid) <= EPSILON) return stop(action, "cargo-full")
  const temperature = fluidTemperature(target, fluid)
  if (temperature === undefined) return stop(action, "not-enough-items")
  if (!pumpEnergy(record, FLUID_STEP_TICKS)) return stop(action, "no-fuel")
  const chunk = math.min((TRANSFER_PER_SECOND * FLUID_STEP_TICKS) / 60, tankFree(record, fluid), remaining(action))
  const removed = target.remove_fluid({ name: fluid, amount: chunk })
  if (removed <= EPSILON) return stop(action, "not-enough-items")
  action.done += addToTank(record, fluid, removed, temperature)
  return { after: FLUID_STEP_TICKS }
}

registerActionHandler("drain", {
  start: (record, action) => {
    const target = action.params.target
    if (target === undefined || !target.valid) return { finish: true, error: "invalid-target" }
    if (!inReach(record, target)) return { finish: true, error: "out-of-reach" }
    face(record, target.position, "idle")
    return drainStep(record, action)
  },
  step: (record, action) => drainStep(record, action),
})
