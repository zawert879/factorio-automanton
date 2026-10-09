// Ошибки компиляции понятным текстом — для окна программ, обмена программами и сообщений.
import { LocalisedString } from "factorio:runtime"
import { escapeRichText } from "../lang/highlight"
import { Diagnostic } from "../lang/lexer"

/** Ошибка компиляции понятным текстом: «[модуль:]строка:столбец текст». */
export function diagnosticText(d: Diagnostic): LocalisedString {
  return ["", `${d.module !== undefined ? `${d.module}:` : ""}${d.line}:${d.column}  `, diagnosticMessage(d)]
}

/** Текст ошибки без места; rich — для подписи с rich text (знаки кода в параметрах — как есть, не теги). */
export function diagnosticMessage(d: Diagnostic, rich = false): LocalisedString {
  const params: LocalisedString[] = d.params.map((p, i) =>
    d.code === "unsupported" && i === 0 ? [`automaton-feature.${p}`] : rich ? escapeRichText(tostring(p)) : tostring(p),
  )
  return [`automaton-diagnostic.${d.code}`, ...params]
}
