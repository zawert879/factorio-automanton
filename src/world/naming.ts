// Диалог имени метки, табло или зоны: появляется сразу после установки или выделения зоны;
// переименовать потом — /am-name, наведя курсор на метку или табло.
import { trim } from "../lang/runtime/strings"
import { LuaEntity, LuaPlayer, PlayerIndex } from "factorio:runtime"
import { onEvent } from "../events"

export type NamingTarget = { kind: "marker"; id: number } | { kind: "zone"; name: string } | { kind: "display"; id: number }

/** Переименование по виду цели: метки и зоны регистрируют свои (без взаимного импорта модулей). */
const renamers: Partial<Record<NamingTarget["kind"], (this: void, target: NamingTarget, name: string) => void>> = {}

export function registerRenamer(kind: NamingTarget["kind"], rename: (this: void, target: NamingTarget, name: string) => void): void {
  renamers[kind] = rename
}

/** Что можно переименовать, наведя курсор (/am-name): сущность → цель и текущее имя. */
const lookups: Array<(this: void, entity: LuaEntity) => { target: NamingTarget; name: string } | undefined> = []

export function registerNameable(lookup: (this: void, entity: LuaEntity) => { target: NamingTarget; name: string } | undefined): void {
  lookups.push(lookup)
}

const FRAME = "automaton-naming"
const FIELD = "automaton-naming-field"
const OK = "automaton-naming-ok"

/** Что сейчас переименовывает игрок (диалог открыт). */
function targets(): Record<number, NamingTarget | undefined> {
  storage.naming ??= {}
  return storage.naming
}

export function askName(playerIndex: number, target: NamingTarget, current: string): void {
  const player = game.get_player(playerIndex as PlayerIndex)
  if (player === undefined) return
  player.gui.screen[FRAME]?.destroy()
  const frame = player.gui.screen.add({
    type: "frame",
    name: FRAME,
    caption: [`automaton.name-${target.kind}`],
    direction: "horizontal",
  })
  frame.auto_center = true
  const field = frame.add({ type: "textfield", name: FIELD, text: current })
  field.focus()
  field.select_all()
  frame.add({ type: "button", name: OK, caption: ["gui.confirm"] })
  targets()[playerIndex] = target
}

function confirm(player: LuaPlayer): void {
  const frame = player.gui.screen[FRAME]
  if (frame === undefined) return
  const field = frame[FIELD] as unknown as { text: string } | undefined
  const name = trim(field?.text ?? "")
  const target = targets()[player.index]
  frame.destroy()
  targets()[player.index] = undefined
  if (target === undefined || name === "") return
  renamers[target.kind]?.(target, name)
}

export function registerNaming(): void {
  commands.add_command("am-name", ["automaton.name-help"], (command) => {
    const player = command.player_index === undefined ? undefined : game.get_player(command.player_index)
    const selected = player?.selected
    if (player === undefined || selected === undefined) return
    for (const lookup of lookups) {
      const found = lookup(selected)
      if (found !== undefined) return askName(player.index, found.target, found.name)
    }
    player.print(["automaton.name-help"])
  })
  onEvent(defines.events.on_gui_click, (e) => {
    if (e.element.valid && e.element.name === OK) confirm(game.get_player(e.player_index)!)
  })
  onEvent(defines.events.on_gui_confirmed, (e) => {
    if (e.element.valid && e.element.name === FIELD) confirm(game.get_player(e.player_index)!)
  })
}

