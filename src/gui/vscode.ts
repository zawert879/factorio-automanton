// Окно «VS Code» (25.1): шаги настройки по порядку — Node.js, параметр запуска, папка программ этой карты и полный
// путь к ней для системы игрока, открыть в VS Code. Открывается кнопкой «VS Code…» в окне программ; один раз игроку
// предлагается само (строка в окне программ). Строки для копирования — поля: клик выделяет всё, дальше Ctrl+C.
import { LocalisedString, LuaGuiElement, LuaPlayer, TextFieldGuiElement } from "factorio:runtime"
import { onGuiChange, onGuiClick, titlebar } from "./common"
import { FOLDER_OS, FolderOs, folderPath } from "../program/folderPath"
import { syncFolder, writeVsCodeFolder } from "../program/sync"

const FRAME = "automaton-vscode"
const WIDTH = 600
const NODE_URL = "https://nodejs.org"
const LAUNCH_OPTION = "--enable-lua-udp 27155"

/** Настройка VS Code у игрока: система для пути, когда записана папка, ответил ли на предложение. */
export interface VsCodeState {
  os?: FolderOs
  /** Тик, когда игрок записал папку этой карты. */
  written?: number
  /** Ответил на предложение в окне программ («Настроить» или «Не сейчас»). */
  offered?: boolean
}

export function vscodeState(player: LuaPlayer): VsCodeState {
  storage.vscode ??= {}
  let state = storage.vscode[player.index]
  if (state === undefined) {
    state = {}
    storage.vscode[player.index] = state
  }
  return state
}

/** Игрок уже ответил на предложение VS Code в окне программ. */
export function vscodeOffered(player: LuaPlayer): boolean {
  return storage.vscode?.[player.index]?.offered === true
}

export function closeVsCode(player: LuaPlayer): void {
  player.gui.screen[FRAME]?.destroy()
}

function wrapped(parent: LuaGuiElement, caption: LocalisedString, dim = false): void {
  const label = parent.add({ type: "label", caption })
  label.style.single_line = false
  label.style.maximal_width = WIDTH - 60
  if (dim) label.style.font_color = { r: 0.7, g: 0.68, b: 0.64 }
}

/** Поле для Ctrl+C: клик выделяет всё, правка откатывается. */
function copyField(parent: LuaGuiElement, text: string, width: number): void {
  const field = parent.add({ type: "textfield", text, tags: { action: "vscode-copy", text } })
  field.style.width = width
}

/** Шаг: номер или отметка «сделано» слева, заголовок и содержимое справа. */
function step(parent: LuaGuiElement, number: number, caption: LocalisedString, done: boolean): LuaGuiElement {
  const row = parent.add({ type: "flow", direction: "horizontal" })
  row.style.horizontal_spacing = 10
  const mark = row.add({ type: "flow", direction: "vertical" })
  mark.style.width = 22
  mark.style.top_padding = 2
  if (done) {
    const check = helpers.is_valid_sprite_path("utility/check_mark_green") ? "utility/check_mark_green" : "utility/status_working"
    const sprite = mark.add({ type: "sprite", sprite: check })
    sprite.style.size = 16
    sprite.style.stretch_image_to_widget_size = true
  }
  else mark.add({ type: "label", caption: `${number}.`, style: "bold_label" })
  const body = row.add({ type: "flow", direction: "vertical" })
  body.style.vertical_spacing = 4
  body.add({ type: "label", caption, style: "bold_label" })
  return body
}

export function openVsCode(player: LuaPlayer): void {
  const old = player.gui.screen[FRAME]
  const location = old?.location
  old?.destroy()
  const state = vscodeState(player)
  const os = state.os ?? "windows"
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical" })
  titlebar(frame, ["automaton-vscode.title"], "vscode-close")
  const panel = frame.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  panel.style.width = WIDTH
  // Отступы между шагами задаёт поток: у рамки vertical_spacing нет.
  const inside = panel.add({ type: "flow", direction: "vertical" })
  inside.style.vertical_spacing = 12
  wrapped(inside, ["automaton-vscode.intro"])

  const node = step(inside, 1, ["automaton-vscode.node"], false)
  copyField(node, NODE_URL, 220)
  wrapped(node, ["automaton-vscode.node-note"], true)

  const launch = step(inside, 2, ["automaton-vscode.launch"], false)
  copyField(launch, LAUNCH_OPTION, 220)
  wrapped(launch, ["automaton-vscode.launch-note"], true)

  const folder = step(inside, 3, ["automaton-vscode.folder"], state.written !== undefined)
  const buttons = folder.add({ type: "flow", direction: "horizontal" })
  buttons.style.vertical_align = "center"
  buttons.add({ type: "button", caption: ["automaton-vscode.write"], style: "green_button", tags: { action: "vscode-write" } })
  buttons.add({ type: "empty-widget" }).style.width = 12
  for (const option of FOLDER_OS) {
    const button = buttons.add({ type: "button", caption: [`automaton-vscode.os-${option}`], tags: { action: "vscode-os", os: option } })
    button.toggled = option === os
    button.style.minimal_width = 80
  }
  if (state.written !== undefined) wrapped(folder, ["automaton-vscode.written"])
  copyField(folder, folderPath(os, syncFolder(player.force.name)), WIDTH - 60)
  wrapped(folder, [`automaton-vscode.open-${os}`], true)
  wrapped(folder, ["automaton-vscode.data-note"], true)

  const open = step(inside, 4, ["automaton-vscode.open"], false)
  wrapped(open, ["automaton-vscode.open-note"], true)

  wrapped(inside, ["automaton-vscode.copy-hint"], true)
  // Только типы — для своей папки без утилиты (раньше — кнопка в окне программ; обработчик там же).
  const types = inside.add({ type: "button", caption: ["automaton-vscode.types"], tags: { action: "programs-types" } })
  types.tooltip = ["automaton-vscode.types-tooltip"]
  if (location !== undefined) frame.location = location
  else frame.auto_center = true
  frame.bring_to_front()
}

export function registerVsCodeWindow(): void {
  onGuiClick("vscode-close", (player) => closeVsCode(player))
  onGuiClick("vscode-write", (player) => {
    writeVsCodeFolder(player)
    vscodeState(player).written = game.tick
    openVsCode(player)
  })
  onGuiClick("vscode-os", (player, element) => {
    vscodeState(player).os = (element.tags as { os: FolderOs }).os
    openVsCode(player)
  })
  onGuiClick("vscode-copy", (_player, element) => {
    const field = element as TextFieldGuiElement
    field.focus()
    field.select_all()
  })
  onGuiChange("vscode-copy", (_player, element) => {
    const field = element as TextFieldGuiElement
    const text = (field.tags as { text: string }).text
    if (field.text !== text) field.text = text
  })
}
