// Окно «VS Code» (25.1): шаги настройки по порядку — Node.js, параметр запуска, папка программ этой карты и полный
// путь к ней для системы игрока, открыть в VS Code. Открывается кнопкой «VS Code…» в окне программ; один раз игроку
// предлагается само (строка в окне программ). Строки для копирования — поля: клик выделяет всё, дальше Ctrl+C.
// Связь (25.2): утилита раз в 10 с стучится в игру — шаг «Открыть в VS Code» показывает, на связи ли она; окно
// пересобирается, только когда меняется состояние связи (иначе выделение в поле сбрасывалось бы каждую секунду).
import { Color, LocalisedString, LuaGuiElement, LuaPlayer, TextFieldGuiElement } from "factorio:runtime"
import { onTick } from "../events"
import { onGuiChange, onGuiClick, titlebar } from "./common"
import { FOLDER_OS, FolderOs, folderPath } from "../program/folderPath"
import { mapName, syncFolder, vscodeState, writeVsCodeFolder } from "../program/sync"
import { LinkStatus, linkStatus } from "../program/vscodeState"

const FRAME = "automaton-vscode"
const WIDTH = 600
const NODE_URL = "https://nodejs.org"
const LAUNCH_OPTION = "--enable-lua-udp 27155"

/** Игрок уже ответил на предложение VS Code в окне программ. */
export function vscodeOffered(player: LuaPlayer): boolean {
  return storage.vscode?.[player.index]?.offered === true
}

export function closeVsCode(player: LuaPlayer): void {
  player.gui.screen[FRAME]?.destroy()
}

const DIM: Color = { r: 0.7, g: 0.68, b: 0.64 }

/** Состояние связи — цветом: на связи — зелёный, ждём — жёлтый, что-то не так — красноватый. */
const LINK_COLORS: Record<LinkStatus, Color> = {
  connected: { r: 0.45, g: 0.9, b: 0.45 },
  "wrong-map": { r: 1, g: 0.5, b: 0.4 },
  lost: { r: 1, g: 0.8, b: 0.35 },
  waiting: { r: 1, g: 0.8, b: 0.35 },
  silent: { r: 1, g: 0.5, b: 0.4 },
  none: DIM,
}

function wrapped(parent: LuaGuiElement, caption: LocalisedString, color?: Color): void {
  const label = parent.add({ type: "label", caption })
  label.style.single_line = false
  label.style.maximal_width = WIDTH - 60
  if (color !== undefined) label.style.font_color = color
}

function linkOf(player: LuaPlayer): LinkStatus {
  return linkStatus(vscodeState(player.index), game.tick, mapName())
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
  const state = vscodeState(player.index)
  const os = state.os ?? "windows"
  const link = linkOf(player)
  // Node.js и параметр запуска игра не видит — их подтверждает первый же запрос утилиты.
  const reached = state.contact !== undefined
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical", tags: { link } })
  titlebar(frame, ["automaton-vscode.title"], "vscode-close")
  const panel = frame.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  panel.style.width = WIDTH
  // Отступы между шагами задаёт поток: у рамки vertical_spacing нет.
  const inside = panel.add({ type: "flow", direction: "vertical" })
  inside.style.vertical_spacing = 12
  wrapped(inside, ["automaton-vscode.intro"])

  const node = step(inside, 1, ["automaton-vscode.node"], reached)
  copyField(node, NODE_URL, 220)
  wrapped(node, ["automaton-vscode.node-note"], DIM)

  const launch = step(inside, 2, ["automaton-vscode.launch"], reached)
  copyField(launch, LAUNCH_OPTION, 220)
  wrapped(launch, ["automaton-vscode.launch-note"], DIM)

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
  wrapped(folder, [`automaton-vscode.open-${os}`], DIM)
  wrapped(folder, ["automaton-vscode.data-note"], DIM)

  const open = step(inside, 4, ["automaton-vscode.open"], link === "connected")
  wrapped(open, ["automaton-vscode.open-note"], DIM)
  if (link !== "none") wrapped(open, [`automaton-vscode.link-${link}`, state.contactMap ?? ""], LINK_COLORS[link])

  wrapped(inside, ["automaton-vscode.copy-hint"], DIM)
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
    vscodeState(player.index).written = game.tick
    openVsCode(player)
  })
  onGuiClick("vscode-os", (player, element) => {
    vscodeState(player.index).os = (element.tags as { os: FolderOs }).os
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
  // Состояние связи меняется со временем (ping пришёл, пропал, минута без ответа) — окно пересобирается при смене.
  onTick((tick) => {
    if (tick % 60 !== 0) return
    for (const player of game.connected_players) {
      const frame = player.gui.screen[FRAME]
      if (frame !== undefined && (frame.tags as { link?: string }).link !== linkOf(player)) openVsCode(player)
    }
  })
}
