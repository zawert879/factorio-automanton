// Статус над машиной: значок проблемы (кончилось топливо, нет пути, некуда положить, ошибка)
// и облачко с текстом (say). Значок ставится, когда поездка или действие кончились неудачей,
// и снимается при новом приказе или успехе. Объекты rendering привязаны к машине и исчезают вместе с ней.
import type { RobotRecord } from "./registry"

export type Problem = "fuel" | "no-path" | "full" | "warning" | "danger"

const SPRITES: Record<Problem, string> = {
  fuel: "utility/fuel_icon",
  "no-path": "utility/no_path_icon",
  full: "utility/destination_full_icon",
  warning: "utility/warning_icon",
  danger: "utility/danger_icon",
}

/** Какой значок показать по коду ошибки поездки или действия (undefined — не проблема). */
export function problemFor(code: string | undefined): Problem | undefined {
  if (code === undefined || code === "cancelled") return undefined
  if (code === "no-fuel") return "fuel"
  if (code === "no-path" || code === "stuck") return "no-path"
  if (code === "cargo-full" || code === "target-full") return "full"
  if (code === "internal-error") return "danger"
  return "warning"
}

export function showProblem(record: RobotRecord, problem: Problem | undefined): void {
  if (problem === undefined) {
    if (record.problem?.valid) record.problem.destroy()
    record.problem = undefined
    return
  }
  if (record.problem?.valid) {
    record.problem.sprite = SPRITES[problem]
    return
  }
  record.problem = rendering.draw_sprite({
    sprite: SPRITES[problem],
    target: { entity: record.entity, offset: [0, -2.1] },
    surface: record.entity.surface,
    x_scale: 0.45,
    y_scale: 0.45,
    render_layer: "entity-info-icon",
  })
}

/** Облачко с текстом над машиной на seconds секунд (новое заменяет прежнее). */
export function say(record: RobotRecord, text: string, seconds = 3): void {
  if (record.bubble?.valid) record.bubble.destroy()
  record.bubble = rendering.draw_text({
    text,
    surface: record.entity.surface,
    target: { entity: record.entity, offset: [0, -2.6] },
    color: { r: 1, g: 1, b: 1 },
    scale: 1.2,
    alignment: "center",
    time_to_live: math.max(1, math.floor(seconds * 60)),
  })
}
