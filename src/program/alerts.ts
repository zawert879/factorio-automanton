// Оповещения (5.6): значок у миникарты для всей команды, клик ведёт к машине. Застряла, нет топлива,
// ошибка программы, программа в карантине. Одно и то же — не чаще раза в 10 секунд с машины.
import { LocalisedString } from "factorio:runtime"
import { onActionFinished } from "../automaton/actions"
import { onMoveFinished } from "../automaton/movement"
import { RobotRecord } from "../automaton/registry"

export type AlertKind = "error" | "stuck" | "no-fuel" | "quarantine"

const REPEAT_TICKS = 600
const last = new LuaMap<string, number>()

export function alertRobot(robot: RobotRecord, kind: AlertKind, detail: LocalisedString = ""): void {
  if (!robot.entity.valid) return
  const key = `${robot.id}:${kind}`
  const previous = last.get(key)
  if (previous !== undefined && game.tick - previous < REPEAT_TICKS) return
  last.set(key, game.tick)
  for (const player of robot.entity.force.players) {
    player.add_custom_alert(robot.entity, { type: "item", name: robot.model }, [`automaton.alert-${kind}`, robot.name, detail], true)
  }
}

/** Машина с программой (а не управляемая командами отладки). */
function programmed(robot: RobotRecord): boolean {
  const status = storage.machines[robot.id]?.machine.status
  return status === "ready" || status === "waiting"
}

export function registerAlerts(): void {
  onMoveFinished((robot, result) => {
    if ((result === "stuck" || result === "no-fuel") && programmed(robot)) alertRobot(robot, result)
  })
  onActionFinished((robot, result) => {
    if (result.error === "no-fuel" && programmed(robot)) alertRobot(robot, "no-fuel")
  })
}
