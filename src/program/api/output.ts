// Вывод (4.5): print / console.log — в консоль машины, say — облачко, chat — чат команды, alert — оповещение.
import { say as showBubble } from "../../automaton/status"
import { defineHostObject, host, hostMethods, Val } from "../../lang/runtime/core"
import { inspect, setHostInspector } from "../../lang/runtime/inspect"
import { formatNumber } from "../../lang/runtime/values"
import { currentMachine, currentRobot } from "../context"
import { resolveInventory } from "../handles"
import { appendConsole } from "../machines"
import { text, ticks } from "./common"

const CHAT_INTERVAL_TICKS = 5 * 60
const MAX_LINE = 1000
/** Строк консоли из одного print (многострочный текст, например JSON.stringify(x, null, 2)). */
const MAX_LINES = 30

/** Значение для консоли — как console.log в Node (src/lang/runtime/inspect.ts). */
export function formatValue(value: Val): string {
  return inspect(value)
}

/** Машина по id: «Robot(АМ-7 #7)». */
function robotText(id: number): string {
  return `Robot(${storage.robots.byId[id]?.name ?? "?"} #${id})`
}

// Объекты игры в выводе — понятным текстом (типы — как в automaton.d.ts).
setHostInspector((x, inner) => {
  switch (x.__h) {
    case "entity":
      return `Entity(${x.__name} #${x.__id} @ ${formatNumber(x.__x)}, ${formatNumber(x.__y)})`
    case "robot":
      return robotText(x.__id)
    case "me":
      return robotText(currentRobot().id)
    case "marker":
      return `Marker(${x.__name})`
    case "zone":
      return `Zone(${x.__name})`
    case "display":
      return `Display(${storage.displays.byId[x.__id]?.name ?? `#${x.__id}`})`
    case "task":
      return `Task(${x.__queue} #${x.__id}: ${inner(x.__data)})`
    case "message": {
      const mail = x.__mail
      return `Message(${robotText(mail.from)}, ${inner(mail.topic)}: ${inner(mail.data)})`
    }
    case "inventory": {
      // Содержимое — если его видно (своё или здание в поле зрения).
      const [ok, inventory] = pcall(resolveInventory, x)
      if (!ok) return "Inventory(…)"
      const items = (inventory as ReturnType<typeof resolveInventory>).get_contents().map((c) => `${c.name}: ${c.count}`)
      return items.length === 0 ? "Inventory {}" : `Inventory { ${items.join(", ")} }`
    }
  }
  return undefined
})

function printValues(...values: Val[]): void {
  const parts: string[] = []
  const count = select("#", ...values)
  for (let i = 1; i <= count; i++) parts.push(formatValue(select(i, ...values)[0]))
  // Многострочное — построчно (в консоли машины строка не переносится).
  const lines = parts.join(" ").split("\n")
  const machine = currentMachine()
  for (let i = 0; i < math.min(lines.length, MAX_LINES); i++) {
    const line = lines[i]
    appendConsole(machine, line.length > MAX_LINE ? string.sub(line, 1, MAX_LINE) + "…" : line)
  }
  if (lines.length > MAX_LINES) appendConsole(machine, `… ещё ${lines.length - MAX_LINES} строк`)
}

host.print = printValues
defineHostObject("console")
hostMethods.console.log = (_o: Val, _k: Val, ...values: Val[]) => printValues(...values)

host.say = (message: Val, seconds: Val) => {
  const content = string.sub(text(message), 1, 200)
  showBubble(currentRobot(), content, ticks(seconds, 3) / 60)
  // Облачко исчезает — в консоли машины (окно машины) его видно и потом.
  appendConsole(currentMachine(), `say: ${content}`)
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
    player.add_custom_alert(robot.entity, { type: "item", name: robot.model }, [`automaton.alert`, robot.name, content], true)
  }
}
