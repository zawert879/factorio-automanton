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

data.extend([open, codeFont, consoleFont])

const styles = data.raw["gui-style"]!.default as Record<string, unknown>
styles.automaton_code = {
  type: "textbox_style",
  font: "automaton-code",
  width: 760,
  height: 560,
}
styles.automaton_console_line = {
  type: "label_style",
  font: "automaton-console",
  single_line: false,
  maximal_width: 560,
}
styles.automaton_json = {
  type: "textbox_style",
  font: "automaton-code",
  width: 400,
  height: 120,
}
