// Вывод (4.5): print / console.log — в консоль машины, say — облачко, chat — чат команды, alert — оповещение.
import { say as showBubble } from "../../automaton/status"
import { defineHostObject, host, hostMethods, Val } from "../../lang/runtime/core"
import { lib } from "../../lang/runtime/library"
import { toStringValue } from "../../lang/runtime/values"
import { WORKER_MK1 } from "../../names"
import { currentMachine, currentRobot } from "../context"
import { appendConsole } from "../machines"
import { text, ticks } from "./common"

const CHAT_INTERVAL_TICKS = 5 * 60
const MAX_LINE = 1000

/** Значение для консоли: строки как есть, объекты и массивы — JSON, объекты игры — «имя#id». */
export function formatValue(value: Val): string {
  if (type(value) !== "table" || value.__t === "host" || value.__f !== undefined || value.__cls !== undefined) return toStringValue(value)
  const [ok, json] = pcall(lib.JSON.stringify, value, undefined, undefined)
  return ok && json !== undefined ? (json as string) : toStringValue(value)
}

function printValues(...values: Val[]): void {
  const parts: string[] = []
  const count = select("#", ...values)
  for (let i = 1; i <= count; i++) parts.push(formatValue(select(i, ...values)[0]))
  let line = parts.join(" ")
  if (line.length > MAX_LINE) line = string.sub(line, 1, MAX_LINE) + "…"
  appendConsole(currentMachine(), line)
}

host.print = printValues
defineHostObject("console")
hostMethods.console.log = (_o: Val, _k: Val, ...values: Val[]) => printValues(...values)

host.say = (message: Val, seconds: Val) => {
  showBubble(currentRobot(), string.sub(text(message), 1, 200), ticks(seconds, 3) / 60)
}

host.chat = (message: Val) => {
  const robot = currentRobot()
  const machine = currentMachine()
  if (machine.lastChatTick !== undefined && game.tick - machine.lastChatTick < CHAT_INTERVAL_TICKS) {
    appendConsole(machine, "chat: не чаще раза в 5 секунд")
    return
  }
  machine.lastChatTick = game.tick
  robot.entity.force.print(["automaton.chat", robot.name, string.sub(text(message), 1, 500)])
}

host.alert = (message: Val) => {
  const robot = currentRobot()
  const content = string.sub(text(message), 1, 200)
  for (const player of robot.entity.force.players) {
    player.add_custom_alert(robot.entity, { type: "item", name: WORKER_MK1 }, [`automaton.alert`, robot.name, content], true)
  }
}
