// Общее для окон мода: разбор событий GUI по действию (tags.action элемента), заголовок окна.
import { FrameGuiElement, LocalisedString, LuaGuiElement, LuaPlayer, PlayerIndex } from "factorio:runtime"
import { onEvent } from "../events"
import type { ExportWindow, ImportWindow } from "./exchange"
import type { MachineWindow } from "./machine"
import type { PickerWindow } from "./picker"
import type { ProgramsWindow } from "./programs"

/** Открытые окна игрока (в storage: ссылки на элементы GUI переживают сохранение). */
export interface GuiState {
  machine?: MachineWindow
  programs?: ProgramsWindow
  picker?: PickerWindow
  /** Обмен программами строкой (18.3). */
  exportWindow?: ExportWindow
  importWindow?: ImportWindow
  /** Недавно выбранные программы (окно выбора), новые первыми. */
  recent?: number[]
  /** «Обновить из папки»: программы без файлов, о которых спросили «удалить?». */
  refreshMissing?: string[]
}

export function guiOf(player: LuaPlayer): GuiState {
  storage.gui ??= {}
  let state = storage.gui[player.index]
  if (state === undefined) {
    state = {}
    storage.gui[player.index] = state
  }
  return state
}

type Handler = (this: void, player: LuaPlayer, element: LuaGuiElement) => void

const handlers: Record<"click" | "change" | "confirm" | "selection" | "checked", Record<string, Handler>> = {
  click: {},
  change: {},
  confirm: {},
  selection: {},
  checked: {},
}

export function onGuiClick(action: string, handler: Handler): void {
  handlers.click[action] = handler
}
export function onGuiChange(action: string, handler: Handler): void {
  handlers.change[action] = handler
}
export function onGuiConfirm(action: string, handler: Handler): void {
  handlers.confirm[action] = handler
}
export function onGuiSelection(action: string, handler: Handler): void {
  handlers.selection[action] = handler
}
export function onGuiChecked(action: string, handler: Handler): void {
  handlers.checked[action] = handler
}

function dispatch(kind: keyof typeof handlers, element: LuaGuiElement | undefined, playerIndex: PlayerIndex): void {
  if (element === undefined || !element.valid) return
  const action = (element.tags as Record<string, unknown>)?.action
  if (typeof action !== "string") return
  const handler = handlers[kind][action]
  const player = game.get_player(playerIndex)
  if (handler !== undefined && player !== undefined) handler(player, element)
}

export function registerGuiEvents(): void {
  onEvent(defines.events.on_gui_click, (e) => dispatch("click", e.element, e.player_index))
  onEvent(defines.events.on_gui_text_changed, (e) => dispatch("change", e.element, e.player_index))
  onEvent(defines.events.on_gui_confirmed, (e) => dispatch("confirm", e.element, e.player_index))
  onEvent(defines.events.on_gui_selection_state_changed, (e) => dispatch("selection", e.element, e.player_index))
  onEvent(defines.events.on_gui_checked_state_changed, (e) => dispatch("checked", e.element, e.player_index))
}

/** Заголовок окна: подпись, перетаскивание, кнопка закрытия. */
export function titlebar(frame: LuaGuiElement, caption: LocalisedString, closeAction: string): LuaGuiElement {
  const bar = frame.add({ type: "flow", direction: "horizontal" })
  bar.drag_target = frame as FrameGuiElement
  const title = bar.add({ type: "label", caption, style: "frame_title", ignored_by_interaction: true })
  const dragger = bar.add({ type: "empty-widget", style: "draggable_space_header", ignored_by_interaction: true })
  dragger.style.height = 24
  dragger.style.horizontally_stretchable = true
  bar.add({
    type: "sprite-button",
    sprite: "utility/close",
    style: "frame_action_button",
    tags: { action: closeAction },
  })
  return title
}

/** Строка «подпись: значение» в таблице из двух столбцов. */
export function row(table: LuaGuiElement, caption: LocalisedString): LuaGuiElement {
  table.add({ type: "label", caption, style: "bold_label" })
  return table.add({ type: "label", caption: "" })
}

/**
 * Обновление мода (on_configuration_changed): окна мода закрываются — их элементы и записи в storage
 * от старой версии и могут не знать новых полей.
 */
export function closeModWindows(): void {
  for (const [, player] of game.players) {
    for (const child of player.gui.screen.children) {
      if (string.sub(child.name, 1, 9) === "automaton") child.destroy()
    }
  }
  for (const [, state] of pairs(storage.gui ?? {})) {
    if (state === undefined) continue
    state.machine = undefined
    state.programs = undefined
    state.picker = undefined
    state.exportWindow = undefined
    state.importWindow = undefined
    state.refreshMissing = undefined
  }
}
