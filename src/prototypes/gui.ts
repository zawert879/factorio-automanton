// Интерфейс (этап 5): клавиша открытия окна машины, моноширинный шрифт и стили редактора кода.
import { PrototypeData } from "factorio:common"
import { CustomInputPrototype, FontPrototype } from "factorio:prototype"

declare const data: PrototypeData

// Клик «открыть» (по умолчанию левая кнопка мыши) по машине открывает её окно.
const open: CustomInputPrototype = {
  type: "custom-input",
  name: "automaton-open",
  key_sequence: "",
  linked_game_control: "open-gui",
  consuming: "none",
}

// Семейство automaton-mono объявлено в locale/*/info.json мода: DejaVu Sans Mono (есть кириллица).
const codeFont: FontPrototype = { type: "font", name: "automaton-code", from: "automaton-mono", size: 14 }
const consoleFont: FontPrototype = { type: "font", name: "automaton-console", from: "automaton-mono", size: 13 }

// Копирование и вставка настроек машины (программа и параметры) — теми же клавишами, что у зданий
// (по умолчанию Shift+ПКМ и Shift+ЛКМ): игра сама настройки машин не копирует.
const copySettings: CustomInputPrototype = {
  type: "custom-input",
  name: "automaton-copy-settings",
  key_sequence: "",
  linked_game_control: "copy-entity-settings",
  consuming: "none",
}
const pasteSettings: CustomInputPrototype = {
  type: "custom-input",
  name: "automaton-paste-settings",
  key_sequence: "",
  linked_game_control: "paste-entity-settings",
  consuming: "none",
}

data.extend([open, copySettings, pasteSettings, codeFont, consoleFont])

const styles = data.raw["gui-style"]!.default as Record<string, unknown>
// Редактор кода: размер задаётся по экрану игрока; отступы фиксированы — номера строк рядом
// (такое же поле, только для чтения) совпадают с кодом построчно. Rich text в полях с кодом выключен:
// "[item=iron-plate]" в строке программы — текст, а не иконка.
styles.automaton_code = {
  type: "textbox_style",
  font: "automaton-code",
  rich_text_setting: "disabled",
  top_padding: 4,
  bottom_padding: 4,
  left_padding: 6,
  right_padding: 6,
  minimal_width: 400,
  minimal_height: 200,
}
styles.automaton_line_numbers = {
  type: "textbox_style",
  parent: "automaton_code",
  width: 64,
  minimal_width: 64,
  font_color: { r: 0.18, g: 0.18, b: 0.18 },
  disabled_font_color: { r: 0.18, g: 0.18, b: 0.18 },
}
styles.automaton_types = {
  type: "textbox_style",
  font: "automaton-code",
  rich_text_setting: "disabled",
  width: 760,
  height: 560,
}
styles.automaton_console_line = {
  type: "label_style",
  font: "automaton-console",
  single_line: false,
  maximal_width: 560,
}
// Строка обмена программами (18.3): переносится по ширине окна.
styles.automaton_exchange = {
  type: "textbox_style",
  font: "automaton-code",
  rich_text_setting: "disabled",
  width: 520,
  height: 90,
}
styles.automaton_json = {
  type: "textbox_style",
  font: "automaton-code",
  rich_text_setting: "disabled",
  width: 400,
  height: 120,
}

// Просмотр кода с подсветкой: фон — как у поля ввода в фокусе, строки — подписи с rich text
// (номер и код; клик по строке открывает правку на ней). Высота строки — как в поле ввода.
const textbox = styles.textbox as { active_background: unknown }
styles.automaton_code_view = {
  type: "frame_style",
  graphical_set: textbox.active_background,
  top_padding: 4,
  bottom_padding: 4,
  left_padding: 0,
  right_padding: 6,
}
styles.automaton_code_line = {
  type: "label_style",
  font: "automaton-code",
  font_color: { r: 0.15, g: 0.14, b: 0.12 },
  hovered_font_color: { r: 0.15, g: 0.14, b: 0.12 },
  height: 20,
  single_line: true,
}
styles.automaton_code_number = {
  type: "label_style",
  parent: "automaton_code_line",
  width: 52,
  horizontal_align: "right",
  right_padding: 8,
  font_color: { r: 0.55, g: 0.47, b: 0.33 },
  hovered_font_color: { r: 0.2, g: 0.17, b: 0.1 },
}
