// Лексер языка программ (подмножество TypeScript). Чистый модуль: без API игры — работает в игре
// при публикации программы и в тестах вне игры. Строки — байты UTF-8 (так их видит Lua), а столбцы
// считаются в символах: русский текст не сдвигает позиции ошибок.

export type TokenKind =
  | "identifier"
  | "keyword"
  | "number"
  | "string"
  /** Шаблонная строка без подстановок: `abc`. */
  | "template"
  /** Начало шаблона до первой подстановки: `abc${ */
  | "template-head"
  /** Середина между подстановками: }abc${ */
  | "template-middle"
  /** Конец после последней подстановки: }abc` */
  | "template-tail"
  | "punctuator"
  | "eof"

export interface Position {
  line: number
  column: number
  /** Смещение в байтах от начала исходника (у позиций токенов; конец — после токена). */
  offset?: number
}

export interface Token {
  kind: TokenKind
  /** Текст токена: имя, знак, исходник числа; для строк и шаблонов — уже раскрытое значение. */
  value: string
  /** Значение числового литерала. */
  number?: number
  start: Position
  end: Position
  /** Перед токеном был перевод строки (для необязательных точек с запятой). */
  newlineBefore: boolean
}

export interface Diagnostic {
  code: string
  params: (string | number)[]
  line: number
  column: number
  /** Модуль, в котором ошибка (имя программы), если не в самой программе. */
  module?: string
}

export const KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in",
  "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof",
  "var", "void", "while", "with",
])

/** Знаки, от длинных к коротким: берётся самый длинный подходящий. */
const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=",
  "&=", "|=", "^=", "**", "<<", ">>",
  "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~",
  "?", ":", "=", ".", "@", "#",
]

const CH = {
  tab: 9, lf: 10, vt: 11, ff: 12, cr: 13, space: 32,
  bang: 33, dquote: 34, dollar: 36, squote: 39, star: 42, dot: 46, slash: 47,
  zero: 48, one: 49, seven: 55, nine: 57,
  A: 65, F: 70, Z: 90, backslash: 92, underscore: 95, backtick: 96,
  a: 97, b: 98, e: 101, f: 102, n: 110, o: 111, r: 114, t: 116, u: 117, v: 118, x: 120, z: 122,
  lbrace: 123, rbrace: 125,
}

function isDigit(c: number): boolean {
  return c >= CH.zero && c <= CH.nine
}

function isHex(c: number): boolean {
  return isDigit(c) || (c >= CH.a && c <= CH.f) || (c >= CH.A && c <= CH.F)
}

/** Начало имени из ASCII: буква, _, $. Символы вне ASCII проверяются отдельно (isUnicodeLetter). */
function isIdStart(c: number): boolean {
  return (c >= CH.a && c <= CH.z) || (c >= CH.A && c <= CH.Z) || c === CH.underscore || c === CH.dollar
}

/**
 * Символ вне ASCII годится в имя: от U+00C0 (латиница с диакритикой, кириллица и другие алфавиты),
 * кроме блоков знаков препинания, стрелок, математических и прочих символов.
 */
function isUnicodeLetter(code: number): boolean {
  if (code < 0xc0 || code === 0xd7 || code === 0xf7) return false
  if (code >= 0x2000 && code <= 0x2bff) return false
  if (code >= 0x3000 && code <= 0x303f) return false
  if (code >= 0xfe00 && code <= 0xfe6f) return false
  return true
}

/** Декодировать символ UTF-8 по смещению: [код, длина в байтах]. */
function decodeUtf8(source: string, index: number): [number, number] {
  const c = source.charCodeAt(index)
  if (c < 0x80) return [c, 1]
  const size = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1
  let code = size === 4 ? c - 0xf0 : size === 3 ? c - 0xe0 : size === 2 ? c - 0xc0 : c
  for (let k = 1; k < size; k++) code = code * 64 + ((source.charCodeAt(index + k) ?? 0x80) - 0x80)
  return [code, size]
}

/** Код символа Юникода → байты UTF-8. */
export function utf8(code: number): string {
  if (code < 0x80) return string.char(code)
  if (code < 0x800) return string.char(0xc0 + math.floor(code / 64), 0x80 + (code % 64))
  if (code < 0x10000) {
    return string.char(0xe0 + math.floor(code / 4096), 0x80 + (math.floor(code / 64) % 64), 0x80 + (code % 64))
  }
  return string.char(
    0xf0 + math.floor(code / 262144),
    0x80 + (math.floor(code / 4096) % 64),
    0x80 + (math.floor(code / 64) % 64),
    0x80 + (code % 64),
  )
}

export interface LexResult {
  tokens: Token[]
  diagnostics: Diagnostic[]
}

/** lineBase — сдвиг номеров строк: так строки модуля программы кодируют его номер (src/lang/modules.ts). */
export function tokenize(source: string, lineBase = 0): LexResult {
  const tokens: Token[] = []
  const diagnostics: Diagnostic[] = []
  const length = source.length
  let i = 0
  let line = 1 + lineBase
  let column = 1
  let newlineBefore = false
  /** Стек скобок: "{" — обычная, "${" — подстановка в шаблоне (её "}" продолжает шаблон). */
  const braces: string[] = []

  const at = (offset = 0): number => (i + offset < length ? source.charCodeAt(i + offset) : -1)

  /** С текущего места начинается символ имени (с учётом UTF-8)? Возвращает его длину в байтах или 0. */
  function idCharLength(allowDigit: boolean): number {
    const c = at()
    if (c < 0) return 0
    if (c < 0x80) return isIdStart(c) || (allowDigit && isDigit(c)) ? 1 : 0
    const [code, size] = decodeUtf8(source, i)
    return isUnicodeLetter(code) ? size : 0
  }

  function advance(): number {
    const c = source.charCodeAt(i)
    i++
    if (c === CH.lf) {
      line++
      column = 1
    } else if (c < 0x80 || c >= 0xc0) {
      // Байты-продолжения UTF-8 (0x80..0xBF) не начинают новый символ.
      column++
    }
    return c
  }

  function here(): Position {
    return { line, column, offset: i }
  }

  function report(code: string, params: (string | number)[], position: Position): void {
    diagnostics.push({ code, params, line: position.line, column: position.column })
  }

  function push(kind: TokenKind, value: string, start: Position, num?: number): void {
    tokens.push({ kind, value, number: num, start, end: here(), newlineBefore })
    newlineBefore = false
  }

  /** Пропустить пробелы и комментарии. */
  function skipTrivia(): void {
    while (i < length) {
      const c = at()
      if (c === CH.lf) {
        newlineBefore = true
        advance()
      } else if (c === CH.space || c === CH.tab || c === CH.cr || c === CH.vt || c === CH.ff) {
        advance()
      } else if (c === CH.slash && at(1) === CH.slash) {
        while (i < length && at() !== CH.lf) advance()
      } else if (c === CH.slash && at(1) === CH.star) {
        const start = here()
        advance()
        advance()
        while (i < length && !(at() === CH.star && at(1) === CH.slash)) {
          if (at() === CH.lf) newlineBefore = true
          advance()
        }
        if (i >= length) {
          report("unterminated-comment", [], start)
          return
        }
        advance()
        advance()
      } else {
        return
      }
    }
  }

  /** Экранирование после обратной косой черты (в строках и шаблонах). */
  function escape(start: Position): string {
    const c = advance()
    if (c === CH.n) return "\n"
    if (c === CH.t) return "\t"
    if (c === CH.r) return "\r"
    if (c === CH.b) return "\b"
    if (c === CH.f) return "\f"
    if (c === CH.v) return "\v"
    if (c === CH.zero && !isDigit(at())) return "\0"
    if (c === CH.lf) return ""
    if (c === CH.x) {
      if (isHex(at()) && isHex(at(1))) {
        const hex = source.substring(i, i + 2)
        advance()
        advance()
        return utf8(tonumber(hex, 16)!)
      }
      report("bad-escape", [], start)
      return ""
    }
    if (c === CH.u) {
      let hex: string
      if (at() === CH.lbrace) {
        advance()
        const from = i
        while (i < length && isHex(at())) advance()
        hex = source.substring(from, i)
        if (at() !== CH.rbrace || hex.length === 0) {
          report("bad-escape", [], start)
          return ""
        }
        advance()
      } else {
        hex = source.substring(i, i + 4)
        for (let k = 0; k < 4; k++) {
          if (!isHex(at())) {
            report("bad-escape", [], start)
            return ""
          }
          advance()
        }
      }
      return utf8(tonumber(hex, 16)!)
    }
    // \\ \' \" \` \$ и любой другой символ — сам символ.
    return source.substring(i - 1, i)
  }

  function readString(quote: number, start: Position): void {
    advance()
    let value = ""
    let from = i
    while (true) {
      if (i >= length || at() === CH.lf) {
        report("unterminated-string", [], start)
        value += source.substring(from, i)
        break
      }
      const c = at()
      if (c === quote) {
        value += source.substring(from, i)
        advance()
        break
      }
      if (c === CH.backslash) {
        value += source.substring(from, i)
        advance()
        value += escape(start)
        from = i
      } else {
        advance()
      }
    }
    push("string", value, start)
  }

  /** Текст шаблона до ` (конец) или ${ (подстановка). Начинается сразу после ` или }. */
  function readTemplate(start: Position, first: boolean): void {
    let value = ""
    let from = i
    while (true) {
      if (i >= length) {
        report("unterminated-template", [], start)
        value += source.substring(from, i)
        push(first ? "template" : "template-tail", value, start)
        return
      }
      const c = at()
      if (c === CH.backtick) {
        value += source.substring(from, i)
        advance()
        push(first ? "template" : "template-tail", value, start)
        return
      }
      if (c === CH.dollar && at(1) === CH.lbrace) {
        value += source.substring(from, i)
        advance()
        advance()
        braces.push("${")
        push(first ? "template-head" : "template-middle", value, start)
        return
      }
      if (c === CH.backslash) {
        value += source.substring(from, i)
        advance()
        value += escape(start)
        from = i
      } else {
        advance()
      }
    }
  }

  function readNumber(start: Position): void {
    const from = i
    let base = 10
    if (at() === CH.zero && (at(1) === CH.x || at(1) === CH.x - 32)) base = 16
    else if (at() === CH.zero && (at(1) === CH.b || at(1) === CH.b - 32)) base = 2
    else if (at() === CH.zero && (at(1) === CH.o || at(1) === CH.o - 32)) base = 8
    let text: string
    if (base !== 10) {
      advance()
      advance()
      const digitsFrom = i
      while (i < length && (isHex(at()) || at() === CH.underscore)) advance()
      text = source.substring(digitsFrom, i).replaceAll("_", "")
      const value = tonumber(text, base)
      if (value === undefined || text.length === 0) report("bad-number", [source.substring(from, i)], start)
      push("number", source.substring(from, i), start, value ?? 0)
      return
    }
    while (isDigit(at()) || at() === CH.underscore) advance()
    if (at() === CH.dot && isDigit(at(1))) {
      advance()
      while (isDigit(at()) || at() === CH.underscore) advance()
    } else if (at() === CH.dot && !isIdStart(at(1)) && at(1) !== CH.dot) {
      // «1.» — тоже число
      advance()
    }
    if (at() === CH.e || at() === CH.e - 32) {
      const save = i
      advance()
      if (at() === 43 || at() === 45) advance()
      if (!isDigit(at())) {
        report("bad-number", [source.substring(from, i)], start)
        i = save
      }
      while (isDigit(at())) advance()
    }
    text = source.substring(from, i)
    if (isIdStart(at())) {
      report("bad-number", [text + string.char(at())], start)
    }
    push("number", text, start, tonumber(text.replaceAll("_", "")) ?? 0)
  }

  while (true) {
    skipTrivia()
    if (i >= length) break
    const start = here()
    const c = at()

    if (idCharLength(false) > 0) {
      const from = i
      for (let n = idCharLength(true); n > 0; n = idCharLength(true)) {
        for (let k = 0; k < n; k++) advance()
      }
      const word = source.substring(from, i)
      push(KEYWORDS.has(word) ? "keyword" : "identifier", word, start)
      continue
    }
    if (isDigit(c) || (c === CH.dot && isDigit(at(1)))) {
      readNumber(start)
      continue
    }
    if (c === CH.dquote || c === CH.squote) {
      readString(c, start)
      continue
    }
    if (c === CH.backtick) {
      advance()
      readTemplate(start, true)
      continue
    }
    if (c === CH.lbrace) {
      advance()
      braces.push("{")
      push("punctuator", "{", start)
      continue
    }
    if (c === CH.rbrace) {
      advance()
      const opened = braces.pop()
      if (opened === "${") readTemplate(start, false)
      else push("punctuator", "}", start)
      continue
    }

    let matched: string | undefined
    for (const p of PUNCTUATORS) {
      if (source.substring(i, i + p.length) === p) {
        // «?.5» — это «?» и «.5» (тернарный оператор с числом), а не «?.».
        if (p === "?." && isDigit(at(2))) continue
        matched = p
        break
      }
    }
    if (matched !== undefined) {
      for (let k = 0; k < matched.length; k++) advance()
      push("punctuator", matched, start)
      continue
    }

    const from = i
    advance()
    while (i < length && at() >= 0x80 && at() < 0xc0) advance()
    report("unexpected-character", [source.substring(from, i)], start)
  }

  tokens.push({ kind: "eof", value: "", start: here(), end: here(), newlineBefore: true })
  return { tokens, diagnostics }
}
