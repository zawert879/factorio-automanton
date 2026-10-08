// Диалог имени метки или зоны: появляется сразу после установки метки или выделения зоны.
import { LuaPlayer, PlayerIndex } from "factorio:runtime"
import { onEvent } from "../events"

export type NamingTarget = { kind: "marker"; id: number } | { kind: "zone"; name: string }

/** Переименование по виду цели: метки и зоны регистрируют свои (без взаимного импорта модулей). */
const renamers: Partial<Record<NamingTarget["kind"], (this: void, target: NamingTarget, name: string) => void>> = {}

export function registerRenamer(kind: NamingTarget["kind"], rename: (this: void, target: NamingTarget, name: string) => void): void {
  renamers[kind] = rename
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
    caption: [target.kind === "marker" ? "automaton.name-marker" : "automaton.name-zone"],
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
  const name = (field?.text ?? "").trim()
  const target = targets()[player.index]
  frame.destroy()
  targets()[player.index] = undefined
  if (target === undefined || name === "") return
  renamers[target.kind]?.(target, name)
}

export function registerNaming(): void {
  onEvent(defines.events.on_gui_click, (e) => {
    if (e.element.valid && e.element.name === OK) confirm(game.get_player(e.player_index)!)
  })
  onEvent(defines.events.on_gui_confirmed, (e) => {
    if (e.element.valid && e.element.name === FIELD) confirm(game.get_player(e.player_index)!)
  })
}

