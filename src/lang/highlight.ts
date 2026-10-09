// Подсветка кода программ для просмотра в редакторе игры: исходник → строки из отрезков с видом
// (ключевое слово, строка, комментарий…) → rich text Factorio. Чистый модуль: работает в игре и в тестах.
// Разбор — лексером языка (src/lang/lexer.ts), комментарии и пробелы — промежутки между токенами.
import { tokenize, Token } from "./lexer"
import { ulen } from "./runtime/strings"

export type Paint = "plain" | "keyword" | "control" | "constant" | "number" | "string" | "comment" | "function" | "type" | "error"

export interface Segment {
  text: string
  paint: Paint
}

/** Ключевые слова управления (как import / if / return в VS Code) — свой цвет. */
const CONTROL = new Set([
  "if", "else", "while", "for", "do", "return", "break", "continue", "switch", "case", "default",
  "try", "catch", "finally", "throw", "import", "export",
])
const CONSTANTS = new Set(["true", "false", "null", "this", "super", "undefined", "NaN", "Infinity"])
/** Слова-ключевые только по месту (`let x`, `for (x of a)`, `type T =`): иначе это обычные имена. */
const CONTEXTUAL = new Set([
  "let", "type", "interface", "readonly", "keyof", "async", "implements", "declare", "namespace",
  "abstract", "private", "public", "protected", "static", "satisfies", "is", "infer",
])
const CONTEXTUAL_CONTROL = new Set(["of", "from", "as", "await", "yield"])
const TYPES = new Set(["number", "string", "boolean", "any", "unknown", "never", "object", "bigint", "symbol"])
/** После этих слов имя — тип (класс, интерфейс, псевдоним). */
const TYPE_INTRO = new Set(["class", "interface", "type", "extends", "implements", "new"])

function isProperty(prev: Token | undefined): boolean {
  return prev !== undefined && prev.kind === "punctuator" && (prev.value === "." || prev.value === "?.")
}

/** За контекстным словом идёт то, что делает его ключевым: имя, литерал, { или [. */
function startsOperand(next: Token | undefined): boolean {
  if (next === undefined) return false
  if (next.kind === "punctuator") return next.value === "{" || next.value === "["
  return next.kind !== "eof"
}

function isPascalCase(name: string): boolean {
  return string.match(name, "^[A-Z]")[0] !== undefined && string.match(name, "[a-z]")[0] !== undefined
}

function paintToken(tokens: Token[], k: number): Paint {
  const token = tokens[k]
  const prev = tokens[k - 1]
  const next = tokens[k + 1]
  const call = next !== undefined && next.kind === "punctuator" && next.value === "("
  switch (token.kind) {
    case "number":
      return "number"
    case "string":
    case "template":
    case "template-head":
    case "template-middle":
    case "template-tail":
      return "string"
    case "punctuator":
      return "plain"
    case "keyword":
      if (isProperty(prev)) return call ? "function" : "plain"
      if (CONSTANTS.has(token.value)) return "constant"
      return CONTROL.has(token.value) ? "control" : "keyword"
    case "identifier": {
      const name = token.value
      if (isProperty(prev)) return call ? "function" : "plain"
      if (CONSTANTS.has(name)) return "constant"
      if (CONTEXTUAL.has(name) && startsOperand(next)) return "keyword"
      if (CONTEXTUAL_CONTROL.has(name) && startsOperand(next)) return "control"
      if (prev !== undefined && (prev.kind === "keyword" || prev.kind === "identifier") && TYPE_INTRO.has(prev.value)) return "type"
      if (prev !== undefined && prev.kind === "keyword" && prev.value === "function") return "function"
      if (isPascalCase(name)) return "type"
      if (call) return "function"
      if (TYPES.has(name)) return "type"
      return "plain"
    }
  }
  return "plain"
}

/** Промежуток между токенами: пробелы, комментарии (и символы, которых нет в языке). */
function gapSegments(text: string, out: Segment[]): void {
  let i = 0
  const length = text.length
  while (i < length) {
    const lineComment = text.indexOf("//", i)
    const blockComment = text.indexOf("/*", i)
    let start = -1
    if (lineComment >= 0 && (blockComment < 0 || lineComment < blockComment)) start = lineComment
    else if (blockComment >= 0) start = blockComment
    if (start < 0) {
      out.push({ text: text.substring(i), paint: "plain" })
      return
    }
    if (start > i) out.push({ text: text.substring(i, start), paint: "plain" })
    let end: number
    if (start === lineComment) {
      const newline = text.indexOf("\n", start)
      end = newline < 0 ? length : newline
    } else {
      const close = text.indexOf("*/", start + 2)
      end = close < 0 ? length : close + 2
    }
    out.push({ text: text.substring(start, end), paint: "comment" })
    i = end
  }
}

/** Шаблонная строка: текст — строкой, `${` и `}` подстановок — обычным цветом. */
function templateSegments(token: Token, text: string, out: Segment[]): void {
  let from = 0
  let to = text.length
  const opens = token.kind === "template-middle" || token.kind === "template-tail"
  const closes = token.kind === "template-head" || token.kind === "template-middle"
  if (opens) {
    out.push({ text: "}", paint: "plain" })
    from = 1
  }
  if (closes) to -= 2
  out.push({ text: text.substring(from, to), paint: "string" })
  if (closes) out.push({ text: "${", paint: "plain" })
}

/** Исходник → строки (по "\n"; число строк — как у поля ввода) из отрезков с видом. */
export function highlight(source: string): Segment[][] {
  const tokens = tokenize(source).tokens
  const flat: Segment[] = []
  let pos = 0
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k]
    if (token.kind === "eof") break
    const start = token.start.offset!
    const end = token.end.offset!
    if (start > pos) gapSegments(source.substring(pos, start), flat)
    const text = source.substring(start, end)
    if (token.kind.startsWith("template")) templateSegments(token, text, flat)
    else flat.push({ text, paint: paintToken(tokens, k) })
    pos = end
  }
  if (pos < source.length) gapSegments(source.substring(pos), flat)

  const lines: Segment[][] = [[]]
  for (const segment of flat) {
    const parts = segment.text.split("\n")
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) lines.push([])
      const [text] = string.gsub(parts[p], "\r", "")
      if (text !== "") lines[lines.length - 1].push({ text, paint: segment.paint })
    }
  }
  return lines
}

/** Пометить ошибкой отрезок строки, на который попадает столбец (в символах, с 1); пробел — следующий за ним. */
export function markError(line: Segment[], column: number): Segment[] {
  let at = 1
  let found = false
  return line.map((segment) => {
    const length = ulen(segment.text)
    const blank = string.match(segment.text, "^%s*$")[0] !== undefined
    const hit = !found && !blank && column < at + length
    at += length
    if (!hit) return segment
    found = true
    return { text: segment.text, paint: "error" as Paint }
  })
}

/**
 * Текст для подписи с rich text: «[» не начинает тег (за ней — пустой тег шрифта), табуляция — два пробела
 * (в шрифте её нет).
 */
export function escapeRichText(text: string): string {
  const [noTabs] = string.gsub(text, "\t", "  ")
  const [escaped] = string.gsub(noTabs, "%[", "[[font=automaton-code][/font]")
  return escaped
}

/** Строка кода в rich text: соседние отрезки одного вида — одним тегом цвета, обычный текст — без тега. */
export function richLine(line: Segment[], colors: Record<Paint, string | undefined>): string {
  const parts: string[] = []
  let k = 0
  while (k < line.length) {
    const paint = line[k].paint
    let text = ""
    while (k < line.length && (line[k].paint === paint || string.match(line[k].text, "^%s*$")[0] !== undefined)) {
      text += line[k].text
      k++
    }
    const color = colors[paint]
    const escaped = escapeRichText(text)
    parts.push(color === undefined ? escaped : `[color=${color}]${escaped}[/color]`)
  }
  return parts.join("")
}
