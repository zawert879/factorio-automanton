// Назначение программ без окна машины (17.4): копирование настроек (программа и параметры) клавишами
// копирования и вставки настроек игры (по умолчанию Shift+ПКМ и Shift+ЛКМ, вариант 3C) и рамка
// «Программатора» правой кнопкой — выбрать программу для всех машин в рамке, с Shift — остановить их (3D).
import { LuaEntity, LuaPlayer, PlayerIndex } from "factorio:runtime"
import { RobotRecord } from "../automaton/registry"
import { Val } from "../lang/runtime/core"
import { modelOf, PROGRAMMER } from "../names"
import { assignProgram, machineOf, stopMachine } from "../program/machines"
import { onEvent } from "../events"
import { openPicker } from "./picker"

/** Скопированные настройки машины у игрока. */
export interface CopiedSettings {
  programId: number
  args: Val
}

function clipboard(): Record<number, CopiedSettings | undefined> {
  storage.clipboard ??= {}
  return storage.clipboard
}

/** Параметры машины — простые данные из JSON: глубокая копия. */
function copyValue(value: Val): Val {
  if (type(value) !== "table") return value
  const copy: Record<string, Val> = {}
  for (const [k, v] of pairs(value as Record<string, Val>)) copy[k] = copyValue(v)
  return copy
}

/** Машина команды игрока под курсором (или в списке сущностей). */
function robotOf(player: LuaPlayer, entity: LuaEntity | undefined) {
  if (entity === undefined || !entity.valid || modelOf(entity.name) === undefined || entity.force !== player.force) return undefined
  return storage.robots.byId[storage.robots.idByUnit[entity.unit_number!] ?? -1]
}

function say(player: LuaPlayer, text: LocalisedText): void {
  player.create_local_flying_text({ text, create_at_cursor: true })
}
type LocalisedText = Parameters<LuaPlayer["create_local_flying_text"]>[0]["text"]

/** Скопировать программу и параметры машины в буфер игрока. Результат — имя программы (нет программы — undefined). */
export function copySettings(playerIndex: number, robot: RobotRecord): string | undefined {
  const record = machineOf(robot.id)
  const program = record.programId === undefined ? undefined : storage.programs.byId[record.programId]
  if (program === undefined) return undefined
  clipboard()[playerIndex] = { programId: program.id, args: copyValue(record.args) }
  return program.name
}

/** Вставить скопированное машине: параметры и программа (запускается заново). Результат — имя программы. */
export function pasteSettings(playerIndex: number, robot: RobotRecord): string | undefined {
  const copied = clipboard()[playerIndex]
  const program = copied === undefined ? undefined : storage.programs.byId[copied.programId]
  if (program === undefined || program.library || program.force !== robot.entity.force.name) return undefined
  machineOf(robot.id).args = copyValue(copied!.args)
  assignProgram(robot, program)
  return program.name
}

/** Остановить машины (рамка «Программатора» с Shift). Результат — сколько остановлено. */
export function stopRobots(robots: RobotRecord[]): number {
  let stopped = 0
  for (const robot of robots) {
    const record = machineOf(robot.id)
    if (record.programId === undefined || record.machine.status === "done") continue
    stopMachine(record)
    stopped++
  }
  return stopped
}

export function registerAssignTools(): void {
  script.on_event("automaton-copy-settings", (e) => {
    const player = game.get_player(e.player_index)
    const robot = player === undefined ? undefined : robotOf(player, player.selected)
    if (player === undefined || robot === undefined) return
    const name = copySettings(player.index, robot)
    say(player, name === undefined ? ["automaton-gui.settings-nothing", robot.name] : ["automaton-gui.settings-copied", name])
  })
  script.on_event("automaton-paste-settings", (e) => {
    const player = game.get_player(e.player_index)
    const robot = player === undefined ? undefined : robotOf(player, player.selected)
    if (player === undefined || robot === undefined) return
    const name = pasteSettings(player.index, robot)
    if (name !== undefined) say(player, ["automaton-gui.settings-pasted", name, robot.name])
  })

  // «Программатор»: рамка правой кнопкой — выбрать программу машинам, с Shift — остановить их.
  onEvent(defines.events.on_player_reverse_selected_area, (e) => {
    if (e.item !== PROGRAMMER) return
    const player = game.get_player(e.player_index as PlayerIndex)!
    const ids: number[] = []
    for (const entity of e.entities) {
      const robot = robotOf(player, entity)
      if (robot !== undefined) ids.push(robot.id)
    }
    if (ids.length === 0) say(player, ["automaton-gui.no-machines-selected"])
    else openPicker(player, ids, true)
  })
  onEvent(defines.events.on_player_alt_reverse_selected_area, (e) => {
    if (e.item !== PROGRAMMER) return
    const player = game.get_player(e.player_index as PlayerIndex)!
    const robots: RobotRecord[] = []
    for (const entity of e.entities) {
      const robot = robotOf(player, entity)
      if (robot !== undefined) robots.push(robot)
    }
    say(player, ["automaton-gui.machines-stopped", stopRobots(robots)])
  })
}
