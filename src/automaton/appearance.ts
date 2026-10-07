// Тело машины: накладка-анимация rendering поверх прозрачного юнита (у юнита нет анимации простоя).
// Анимация выбирается по занятию машины (простой, бег, добыча) и направлению — 8 направлений.
// Едущие машины раз в TURN_CHECK_TICKS тиков разворачиваются по направлению движения.
import { LuaEntity, LuaRenderObject } from "factorio:runtime"
import { onTick } from "../events"
import { Activity, BODY_DIRECTIONS, bodyAnimationName } from "../names"
import type { RobotRecord } from "./registry"

const TURN_CHECK_TICKS = 10

/** Направление анимации (0 — север, по часовой стрелке) по ориентации сущности (0..1, 0 — север). */
export function directionOf(orientation: number): number {
  return math.floor(orientation * BODY_DIRECTIONS + 0.5) % BODY_DIRECTIONS
}

export function drawBody(entity: LuaEntity, activity: Activity, direction: number): LuaRenderObject {
  return rendering.draw_animation({
    animation: bodyAnimationName(activity, direction),
    target: { entity },
    surface: entity.surface,
    render_layer: "object",
  })
}

/** Сменить анимацию тела; направление по умолчанию — прежнее. */
export function setActivity(record: RobotRecord, activity: Activity, direction: number = record.direction): void {
  if (record.activity === activity && record.direction === direction) return
  record.activity = activity
  record.direction = direction
  if (record.body.valid) record.body.animation = bodyAnimationName(activity, direction)
}

export function registerAppearance(): void {
  onTick((tick) => {
    if (tick % TURN_CHECK_TICKS !== 0) return
    for (const [key, order] of Object.entries(storage.movement.orders)) {
      if (order?.dispatchedTick === undefined) continue
      const record = storage.robots.byId[tonumber(key)!]
      if (record === undefined || !record.entity.valid) continue
      setActivity(record, "run", directionOf(record.entity.orientation))
    }
  })
}
