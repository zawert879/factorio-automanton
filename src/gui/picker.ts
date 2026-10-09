// Окно выбора программы (17.4, вариант 3B): для одной машины (кнопка программы в окне машины) или для
// нескольких (рамка «Программатора» правой кнопкой). Поиск, папки, недавние наверху, у каждой программы —
// сколько машин уже работает по ней. Библиотеки не предлагаются: запускать их нечего.
import { trim } from "../lang/runtime/strings"
import { FrameGuiElement, ListBoxGuiElement, LocalisedString, LuaGuiElement, LuaPlayer, TextFieldGuiElement } from "factorio:runtime"
import { assignProgram, machineOf } from "../program/machines"
import { programsOf } from "../program/store"
import { guiOf, onGuiChange, onGuiClick, onGuiSelection, titlebar } from "./common"
import { folderItem, programTree, TreeEntry } from "./tree"

const FRAME = "automaton-picker"
const RECENT = 5

/** Строка списка: без программы, недавняя программа, строка дерева. */
type PickerEntry = { none: true } | { recent: number } | TreeEntry

export interface PickerWindow {
  frame: FrameGuiElement
  search: TextFieldGuiElement
  list: ListBoxGuiElement
  /** Подсказка, когда у команды нет ни одной программы (новая игра). */
  empty: LuaGuiElement
  entries: PickerEntry[]
  robotIds: number[]
}

const pickedListeners: Array<(this: void, player: LuaPlayer) => void> = []

/** Программа выбрана (окно машины обновляет кнопку программы). */
export function onProgramPicked(listener: (this: void, player: LuaPlayer) => void): void {
  pickedListeners.push(listener)
}

export function closePicker(player: LuaPlayer): void {
  const state = guiOf(player)
  if (state.picker?.frame.valid) state.picker.frame.destroy()
  state.picker = undefined
}

/**
 * Открыть выбор программы для машин команды игрока. modal — окно становится открытым окном игрока
 * (Esc закрывает его); из окна машины — нет: иначе закрылось бы окно машины.
 */
export function openPicker(player: LuaPlayer, robotIds: number[], modal = false): void {
  closePicker(player)
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, robotIds.length === 1 ? ["automaton-gui.picker-title"] : ["automaton-gui.picker-title-many", robotIds.length], "picker-close")
  const body = frame.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const searchRow = body.add({ type: "flow", direction: "horizontal" })
  searchRow.style.vertical_align = "center"
  searchRow.add({ type: "label", caption: ["automaton-gui.search"] })
  const search = searchRow.add({ type: "textfield", text: "", tags: { action: "picker-search" } })
  search.style.width = 300
  const empty = body.add({ type: "label", caption: ["automaton-gui.picker-empty"] })
  empty.style.single_line = false
  empty.style.maximal_width = 380
  const list = body.add({ type: "list-box", items: [], tags: { action: "picker-select" } })
  list.style.width = 380
  list.style.height = 420
  const window: PickerWindow = { frame, search, list, empty, entries: [], robotIds }
  guiOf(player).picker = window
  refresh(window, player)
  if (modal) player.opened = frame
  search.focus()
}

function refresh(window: PickerWindow, player: LuaPlayer): void {
  const programs = programsOf(player.force.name).filter((p) => !p.library)
  window.empty.visible = programs.length === 0
  // Сколько машин работает по каждой программе.
  const counts: Record<number, number | undefined> = {}
  for (const [, record] of pairs(storage.machines)) {
    if (record.programId !== undefined && !record.parked) counts[record.programId] = (counts[record.programId] ?? 0) + 1
  }
  const countText = (id: number): LocalisedString => ["automaton-gui.picker-count", counts[id] ?? 0]
  const entries: PickerEntry[] = [{ none: true }]
  const items: LocalisedString[] = [["automaton-gui.no-program"]]
  // Недавние — когда поиск пуст.
  if (trim(window.search.text) === "") {
    const recent = (guiOf(player).recent ?? []).filter((id) => programs.some((p) => p.id === id))
    if (recent.length > 0) {
      entries.push({ folder: "" })
      items.push(["", "[color=#a9a9a9]", ["automaton-gui.picker-recent"], "[/color]"])
      for (const id of recent) {
        const program = storage.programs.byId[id]!
        entries.push({ recent: id })
        items.push(["", `    ${program.name}  `, countText(id)])
      }
    }
  }
  for (const row of programTree(programs, window.search.text)) {
    entries.push(row.entry)
    items.push(row.program === undefined ? folderItem(row) : ["", `${row.indent}${row.short}  `, countText(row.program.id)])
  }
  window.entries = entries
  window.list.items = items
}

function windowOf(player: LuaPlayer): PickerWindow | undefined {
  const window = guiOf(player).picker
  return window !== undefined && window.frame.valid ? window : undefined
}

/** Назначить программу машинам окна (undefined — убрать программу). */
function pick(player: LuaPlayer, window: PickerWindow, programId: number | undefined): void {
  const program = programId === undefined ? undefined : storage.programs.byId[programId]
  for (const id of window.robotIds) {
    const robot = storage.robots.byId[id]
    if (robot === undefined || !robot.entity.valid || robot.entity.force !== player.force) continue
    if (program === undefined && machineOf(id).programId === undefined) continue
    assignProgram(robot, program)
  }
  if (program !== undefined) {
    const state = guiOf(player)
    state.recent = [program.id, ...(state.recent ?? []).filter((id) => id !== program.id)].slice(0, RECENT)
  }
  closePicker(player)
  for (const listener of pickedListeners) listener(player)
}

export function registerPicker(): void {
  onGuiClick("picker-close", (player) => closePicker(player))
  onGuiChange("picker-search", (player) => {
    const window = windowOf(player)
    if (window !== undefined) refresh(window, player)
  })
  onGuiSelection("picker-select", (player, element) => {
    const window = windowOf(player)
    const selected = (element as ListBoxGuiElement).selected_index
    if (window === undefined || selected === 0) return
    const entry = window.entries[selected - 1]
    if (entry === undefined) return
    if ("none" in entry) pick(player, window, undefined)
    else if ("recent" in entry) pick(player, window, entry.recent)
    else if ("id" in entry) pick(player, window, entry.id)
    // Папка или заголовок: выбор снять.
    else window.list.selected_index = 0
  })
}
