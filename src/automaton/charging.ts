// Зарядка (8.2): машина Mk2+ едет к зарядной станции (заданной или ближайшей видимой) и заряжает
// аккумулятор из её буфера — станция копит энергию из электросети. Mk1 жжёт топливо, заряжать нечего.
import { LuaEntity } from "factorio:runtime"
import { CHARGING_STATION } from "../names"
import { ActionState, distanceToEntity, face, registerActionHandler, StepOutcome } from "./actions"
import { robotBattery, robotVision } from "./models"
import { isMoving, lastMoveResult, moveRobot } from "./movement"
import { RobotRecord } from "./registry"

/** Заряжает, стоя не дальше этого от станции. */
export const CHARGE_REACH = 3
/** Мощность зарядки, Вт: аккумулятор Mk2 (10 МДж) — за 10 секунд. */
export const CHARGE_WATTS = 1_000_000
const CHARGE_STEP_TICKS = 10
const MOVE_CHECK_TICKS = 20

/** Ближайшая станция своей команды в поле зрения. */
export function nearestStation(record: RobotRecord): LuaEntity | undefined {
  const position = record.entity.position
  let best: LuaEntity | undefined
  let bestDistance = math.huge
  const found = record.entity.surface.find_entities_filtered({
    name: CHARGING_STATION,
    position,
    radius: robotVision(record),
    force: record.entity.force,
  })
  for (const station of found) {
    const d = distanceToEntity(position, station)
    if (d < bestDistance) {
      best = station
      bestDistance = d
    }
  }
  return best
}

function chargeStep(record: RobotRecord, action: ActionState): StepOutcome {
  const station = action.params.target
  const battery = robotBattery(record)!
  if (station === undefined || !station.valid) return { finish: true, error: "invalid-target" }
  if (distanceToEntity(record.entity.position, station) > CHARGE_REACH) {
    if (isMoving(record)) return { after: MOVE_CHECK_TICKS }
    // Доехать не вышло (или машину увели): если поездка ещё не начиналась — поехать.
    if (action.params.position === undefined) {
      action.params.position = station.position
      moveRobot(record, { entity: station }, { radius: 2 })
      return { after: MOVE_CHECK_TICKS }
    }
    const result = lastMoveResult(record)
    return { finish: true, error: result === "no-fuel" ? "no-fuel" : "out-of-reach" }
  }
  face(record, station.position, "idle")
  const need = battery - record.energy
  if (need <= 1) return { finish: true }
  const transfer = math.min(need, station.energy, (CHARGE_WATTS * CHARGE_STEP_TICKS) / 60)
  if (transfer > 0) {
    station.energy -= transfer
    record.energy += transfer
    action.done += transfer
  }
  // Станция пуста — ждём, пока сеть её наполнит.
  return { after: CHARGE_STEP_TICKS }
}

registerActionHandler("charge", {
  start: (record, action) => {
    if (robotBattery(record) === undefined) return { finish: true, error: "invalid-target" }
    action.params.target ??= nearestStation(record)
    const station = action.params.target
    if (station === undefined || !station.valid || station.name !== CHARGING_STATION) return { finish: true, error: "invalid-target" }
    return chargeStep(record, action)
  },
  step: (record, action) => chargeStep(record, action),
})
