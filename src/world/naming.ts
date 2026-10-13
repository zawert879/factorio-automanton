// Диалог имени метки, табло или зоны: появляется сразу после установки или выделения зоны;
// переименовать потом — /am-name, наведя курсор на метку или табло, а зону — клик «Программатором» (21.8).
// У зоны в диалоге ещё «Удалить»: метку и табло удаляют, разобрав их.
import { trim } from "../lang/runtime/strings"
import { LocalisedString, LuaEntity, LuaPlayer, PlayerIndex } from "factorio:runtime"
import { onEvent } from "../events"

export type NamingTarget = { kind: "marker"; id: number } | { kind: "zone"; name: string } | { kind: "display"; id: number }

/** Переименование по виду цели: метки и зоны регистрируют свои (без взаимного импорта модулей). */
const renamers: Partial<Record<NamingTarget["kind"], (this: void, target: NamingTarget, name: string, player: LuaPlayer) => void>> = {}

export function registerRenamer(
  kind: NamingTarget["kind"],
  rename: (this: void, target: NamingTarget, name: string, player: LuaPlayer) => void,
): void {
  renamers[kind] = rename
}

/** Удаление из диалога — кнопка «Удалить» есть только у видов, которые его регистрируют (зона). */
const removers: Partial<Record<NamingTarget["kind"], (this: void, target: NamingTarget) => void>> = {}

export function registerRemover(kind: NamingTarget["kind"], remove: (this: void, target: NamingTarget) => void): void {
  removers[kind] = remove
}

/** Что можно переименовать, наведя курсор (/am-name): сущность → цель и текущее имя. */
const lookups: Array<(this: void, entity: LuaEntity) => { target: NamingTarget; name: string } | undefined> = []

export function registerNameable(lookup: (this: void, entity: LuaEntity) => { target: NamingTarget; name: string } | undefined): void {
  lookups.push(lookup)
}

const FRAME = "automaton-naming"
const FIELD = "automaton-naming-field"
const OK = "automaton-naming-ok"
const DELETE = "automaton-naming-delete"

/** Что сейчас переименовывает игрок (диалог открыт). */
function targets(): Record<number, NamingTarget | undefined> {
  storage.naming ??= {}
  return storage.naming
}

/** note — строка под полем (зона: программы находят её по имени). */
export function askName(playerIndex: number, target: NamingTarget, current: string, note?: LocalisedString): void {
  const player = game.get_player(playerIndex as PlayerIndex)
  if (player === undefined) return
  player.gui.screen[FRAME]?.destroy()
  const frame = player.gui.screen.add({
    type: "frame",
    name: FRAME,
    caption: [`automaton.name-${target.kind}`],
    direction: "vertical",
  })
  frame.auto_center = true
  const row = frame.add({ type: "flow", direction: "horizontal" })
  const field = row.add({ type: "textfield", name: FIELD, text: current })
  field.focus()
  field.select_all()
  row.add({ type: "button", name: OK, caption: ["gui.confirm"] })
  if (removers[target.kind] !== undefined) {
    const remove = row.add({ type: "button", name: DELETE, caption: ["automaton.name-delete"], style: "red_button" })
    remove.tooltip = [`automaton.name-delete-${target.kind}`]
  }
  if (note !== undefined) {
    const label = frame.add({ type: "label", caption: note })
    label.style.single_line = false
    label.style.maximal_width = 400
    label.style.font_color = { r: 0.7, g: 0.68, b: 0.64 }
  }
  targets()[playerIndex] = target
}

export function confirmName(player: LuaPlayer): void {
  const frame = player.gui.screen[FRAME]
  if (frame === undefined) return
  const field = frame.children[0][FIELD] as unknown as { text: string } | undefined
  const name = trim(field?.text ?? "")
  const target = targets()[player.index]
  frame.destroy()
  targets()[player.index] = undefined
  if (target === undefined || name === "") return
  renamers[target.kind]?.(target, name, player)
}

export function removeNamed(player: LuaPlayer): void {
  const target = targets()[player.index]
  player.gui.screen[FRAME]?.destroy()
  targets()[player.index] = undefined
  if (target !== undefined) removers[target.kind]?.(target)
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
    if (!e.element.valid) return
    if (e.element.name === OK) confirmName(game.get_player(e.player_index)!)
    else if (e.element.name === DELETE) removeNamed(game.get_player(e.player_index)!)
  })
  onEvent(defines.events.on_gui_confirmed, (e) => {
    if (e.element.valid && e.element.name === FIELD) confirmName(game.get_player(e.player_index)!)
  })
}

