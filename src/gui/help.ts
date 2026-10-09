// Справка в игре (18.5; решения — DESIGN.md, «Справка в игре»): ярлык на панели быстрого доступа и клавиша F1.
// Две колонки: слева поиск и список (начало: «Первые шаги», «Частые ошибки»; разделы API и их функции), справа —
// объявление в цвете, описание и пример раздела. «Выделить пример» — текст примера выделен для Ctrl+C (курсор
// в поле ввода игра не сообщает, вставить «в место курсора» нельзя). Язык — игрока: данные из docs/API.md
// на русском и английском (tools/dts/generate.mjs → help.generated.ts).
import { FrameGuiElement, LocalisedString, LuaGuiElement, LuaPlayer, ListBoxGuiElement, ScrollPaneGuiElement, TextBoxGuiElement, TextFieldGuiElement } from "factorio:runtime"
import { onEvent } from "../events"
import { mapCase, trim } from "../lang/runtime/strings"
import { HELP_INPUT, HELP_SHORTCUT } from "../names"
import { addCode } from "./codeView"
import { guiOf, onGuiChange, onGuiClick, onGuiSelection, titlebar } from "./common"
import { FIRST_PROGRAM, HELP, HelpEntry } from "./help.generated"
import { FOLDER_COLOR } from "./tree"

const FRAME = "automaton-help"
const LIST_WIDTH = 240
const PAGE_WIDTH = 660
const HEIGHT = 580

type HelpItem = { page: "first-steps" | "errors" } | { section: number; entry?: number }

export interface HelpWindow {
  frame: FrameGuiElement
  search: TextFieldGuiElement
  list: ListBoxGuiElement
  items: HelpItem[]
  page: ScrollPaneGuiElement
  /** 0 — русский, 1 — английский (язык игрока). */
  lang: 0 | 1
  /** Пример открытой страницы: блок в цвете и поле для Ctrl+C. */
  exampleView?: LuaGuiElement
  exampleBox?: TextBoxGuiElement
}

function windowOf(player: LuaPlayer): HelpWindow | undefined {
  const window = guiOf(player).help
  return window !== undefined && window.frame.valid ? window : undefined
}

export function closeHelp(player: LuaPlayer): void {
  player.gui.screen[FRAME]?.destroy()
  guiOf(player).help = undefined
  player.set_shortcut_toggled(HELP_SHORTCUT, false)
}

export function toggleHelp(player: LuaPlayer): void {
  if (windowOf(player) !== undefined) closeHelp(player)
  else openHelp(player)
}

export function openHelp(player: LuaPlayer, query = ""): void {
  player.gui.screen[FRAME]?.destroy()
  const frame = player.gui.screen.add({ type: "frame", name: FRAME, direction: "vertical" })
  frame.auto_center = true
  titlebar(frame, ["automaton-help.title"], "help-close")
  const body = frame.add({ type: "flow", direction: "horizontal" })
  body.style.horizontal_spacing = 12
  const left = body.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const searchRow = left.add({ type: "flow", direction: "horizontal" })
  searchRow.style.vertical_align = "center"
  searchRow.add({ type: "label", caption: ["automaton-gui.search"] })
  const search = searchRow.add({ type: "textfield", text: query, tags: { action: "help-search" } })
  search.style.width = LIST_WIDTH - 60
  const list = left.add({ type: "list-box", items: [], tags: { action: "help-select" } })
  list.style.width = LIST_WIDTH
  list.style.height = HEIGHT - 36
  const right = body.add({ type: "frame", style: "inside_shallow_frame_with_padding", direction: "vertical" })
  const page = right.add({ type: "scroll-pane", horizontal_scroll_policy: "auto", vertical_scroll_policy: "auto" })
  page.style.width = PAGE_WIDTH
  page.style.height = HEIGHT
  const window: HelpWindow = { frame, search, list, items: [], page, lang: player.locale === "ru" ? 0 : 1 }
  guiOf(player).help = window
  // Окно программ открыто — не становиться «открытым окном» игрока (иначе игра закроет то); иначе Esc закрывает справку.
  if (player.opened === undefined) player.opened = frame
  player.set_shortcut_toggled(HELP_SHORTCUT, true)
  refreshList(window)
  showItem(window, 0)
  search.focus()
}

function header(text: LocalisedString): LocalisedString {
  return ["", `[color=${FOLDER_COLOR}]`, text, "[/color]"]
}

/** Насколько запись подходит к поиску: 0 — имя совпадает, 1 — начинается с запроса, 2 — содержит, 3 — член; -1 — нет. */
function score(entry: HelpEntry, query: string): number {
  const name = mapCase(entry.name, false)
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  return entry.keys.includes(query) ? 3 : -1
}

/**
 * Список. Без поиска — начало («Первые шаги», «Частые ошибки») и разделы с функциями; при поиске — найденные
 * функции по степени совпадения (сначала по имени, потом по полям и методам), с разделом в подписи.
 */
function refreshList(window: HelpWindow): void {
  const query = mapCase(trim(window.search.text), false)
  const items: HelpItem[] = []
  const captions: LocalisedString[] = []
  if (query === "") {
    items.push({ page: "first-steps" }, { page: "errors" })
    captions.push(["", "    ", ["automaton-help.first-steps"]], ["", "    ", ["automaton-help.errors"]])
    HELP.forEach((section, s) => {
      items.push({ section: s })
      captions.push(header(section.title[window.lang]))
      section.entries.forEach((entry, e) => {
        items.push({ section: s, entry: e })
        captions.push(`    ${entry.name}`)
      })
    })
  } else {
    const found: { s: number; e: number; score: number }[] = []
    HELP.forEach((section, s) => section.entries.forEach((entry, e) => {
      const value = score(entry, query)
      if (value >= 0) found.push({ s, e, score: value })
    }))
    found.sort((a, b) => a.score - b.score || a.s - b.s || a.e - b.e)
    for (const { s, e } of found) {
      items.push({ section: s, entry: e })
      captions.push(["", `${HELP[s].entries[e].name}  [color=#a9a9a9]`, HELP[s].title[window.lang], "[/color]"])
    }
  }
  window.items = items
  window.list.items = captions
  if (items.length === 0) {
    window.page.clear()
    paragraph(window, ["automaton-help.nothing"])
  }
}

function paragraph(window: HelpWindow, caption: LocalisedString): LuaGuiElement {
  const label = window.page.add({ type: "label", caption })
  label.style.single_line = false
  label.style.maximal_width = PAGE_WIDTH - 24
  return label
}

function title(window: HelpWindow, caption: LocalisedString): void {
  window.page.add({ type: "label", caption, style: "frame_title" })
}

/** Пример страницы: код в цвете, кнопка «Выделить пример» и скрытое поле с текстом. */
function example(window: HelpWindow, caption: LocalisedString, source: string): void {
  window.page.add({ type: "label", caption, style: "bold_label" })
  window.exampleView = addCode(window.page, source, PAGE_WIDTH - 24)
  let lines = 1
  for (const [_] of string.gmatch(source, "\n")) lines++
  const box = window.page.add({ type: "text-box", text: source, style: "automaton_code" })
  box.read_only = true
  box.word_wrap = false
  box.style.width = PAGE_WIDTH - 24
  box.style.height = lines * 20 + 16
  box.visible = false
  window.exampleBox = box
  const row = window.page.add({ type: "flow", direction: "horizontal" })
  row.style.vertical_align = "center"
  row.add({ type: "button", caption: ["automaton-help.select-example"], tags: { action: "help-select-example" } })
}

function showItem(window: HelpWindow, index: number): void {
  const item = window.items[index]
  if (item === undefined) return
  window.list.selected_index = index + 1
  window.page.clear()
  window.exampleView = undefined
  window.exampleBox = undefined
  if ("page" in item) {
    title(window, [`automaton-help.${item.page}`])
    paragraph(window, [`automaton-help.${item.page}-text`])
    if (item.page === "first-steps") example(window, ["automaton-help.first-program"], FIRST_PROGRAM)
  } else {
    const section = HELP[item.section]
    if (item.entry === undefined) {
      title(window, section.title[window.lang])
      paragraph(window, ["automaton-help.section-entries", section.entries.map((e) => e.name).join(", ")])
    } else {
      const entry = section.entries[item.entry]
      title(window, entry.name)
      addCode(window.page, entry.signature[window.lang], PAGE_WIDTH - 24)
      if (entry.doc[window.lang] !== "") paragraph(window, entry.doc[window.lang])
    }
    if (section.example !== undefined) example(window, ["automaton-help.section-example", section.title[window.lang]], section.example)
  }
  window.page.scroll_to_top()
}

export function registerHelpWindow(): void {
  onEvent(defines.events.on_lua_shortcut, (e) => {
    if (e.prototype_name !== HELP_SHORTCUT) return
    const player = game.get_player(e.player_index)
    if (player !== undefined) toggleHelp(player)
  })
  script.on_event(HELP_INPUT, (e) => {
    const player = game.get_player(e.player_index)
    if (player !== undefined) toggleHelp(player)
  })
  onGuiClick("help-close", (player) => closeHelp(player))
  onGuiChange("help-search", (player) => {
    const window = windowOf(player)
    if (window === undefined) return
    refreshList(window)
    showItem(window, 0)
  })
  onGuiSelection("help-select", (player, element) => {
    const window = windowOf(player)
    const index = (element as ListBoxGuiElement).selected_index
    if (window !== undefined && index > 0) showItem(window, index - 1)
  })
  onGuiClick("help-select-example", (player) => {
    const window = windowOf(player)
    if (window?.exampleBox === undefined || window.exampleView === undefined) return
    window.exampleView.visible = false
    window.exampleBox.visible = true
    window.exampleBox.focus()
    window.exampleBox.select_all()
    player.print(["automaton-help.example-selected"])
  })
}
