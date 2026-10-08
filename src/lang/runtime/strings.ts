// Методы строк. Строки — UTF-8; длина и индексы — в символах (кодовых точках), а не байтах.
// Для строк из одних ASCII-символов — быстрый путь по байтам.
import { charge, err, Fn, LIMITS, newArray, Val } from "./core"
import { formatNumber, toNumber, toStringValue } from "./values"

const NON_ASCII = "[" + string.char(128) + "-" + string.char(255) + "]"
const NOT_CONTINUATION = "[^" + string.char(128) + "-" + string.char(191) + "]"
const UTF8_CHAR = "[%z" + string.char(1) + "-" + string.char(127, 194) + "-" + string.char(244) + "][" + string.char(128) + "-" + string.char(191) + "]*"

export function isAscii(this: void, s: string): boolean {
  const [position] = string.find(s, NON_ASCII)
  return position === undefined
}

/** Длина в символах. */
export function ulen(this: void, s: string): number {
  if (isAscii(s)) return s.length
  const [, count] = string.gsub(s, NOT_CONTINUATION, "")
  return count
}

/** Символы строки (Lua-массив с 1). */
export function chars(this: void, s: string): string[] {
  const result: string[] = []
  if (isAscii(s)) {
    for (let i = 1; i <= s.length; i++) result.push(string.sub(s, i, i))
  } else {
    for (const [c] of string.gmatch(s, UTF8_CHAR)) result.push(c)
  }
  return result
}

/** Символ с индексом JS (с 0) или undefined. */
export function charAt(this: void, s: string, index: number): string | undefined {
  if (index < 0 || index !== math.floor(index)) return undefined
  if (isAscii(s)) return index < s.length ? string.sub(s, index + 1, index + 1) : undefined
  return chars(s)[index]
}

export function encodeCodePoint(this: void, cp: number): string {
  if (cp < 0x80) return string.char(cp)
  if (cp < 0x800) return string.char(0xc0 + math.floor(cp / 0x40), 0x80 + (cp % 0x40))
  if (cp < 0x10000) return string.char(0xe0 + math.floor(cp / 0x1000), 0x80 + (math.floor(cp / 0x40) % 0x40), 0x80 + (cp % 0x40))
  return string.char(
    0xf0 + math.floor(cp / 0x40000),
    0x80 + (math.floor(cp / 0x1000) % 0x40),
    0x80 + (math.floor(cp / 0x40) % 0x40),
    0x80 + (cp % 0x40),
  )
}

export function decodeChar(this: void, c: string): number {
  const b = string.byte(c, 1)
  if (b < 0x80) return b
  if (b < 0xe0) return (b - 0xc0) * 0x40 + (string.byte(c, 2) - 0x80)
  if (b < 0xf0) return (b - 0xe0) * 0x1000 + (string.byte(c, 2) - 0x80) * 0x40 + (string.byte(c, 3) - 0x80)
  return (b - 0xf0) * 0x40000 + (string.byte(c, 2) - 0x80) * 0x1000 + (string.byte(c, 3) - 0x80) * 0x40 + (string.byte(c, 4) - 0x80)
}

function checked(s: string): string {
  if (s.length > LIMITS.string) err("string-too-long")
  return s
}

/** Подстрока по индексам символов [from, to) (с 0). */
function substringChars(s: string, from: number, to: number): string {
  if (to <= from) return ""
  if (isAscii(s)) return string.sub(s, from + 1, to)
  const list = chars(s)
  const parts: string[] = []
  for (let i = from; i < to && i < list.length; i++) parts.push(list[i])
  return parts.join("")
}

/** Индекс символа по позиции байта (с 1). */
function charIndex(s: string, bytePosition: number): number {
  return ulen(string.sub(s, 1, bytePosition - 1))
}

/** Позиция байта (с 1) символа с индексом index (с 0). */
function bytePosition(s: string, index: number): number {
  if (index <= 0) return 1
  if (isAscii(s)) return index + 1
  let position = 1
  let count = 0
  for (const [c] of string.gmatch(s, UTF8_CHAR)) {
    if (count === index) return position
    position += c.length
    count++
  }
  return s.length + 1
}

function integer(x: Val, fallback: number): number {
  if (x === undefined) return fallback
  const n = toNumber(x)
  if (n !== n) return 0
  if (n === math.huge || n === -math.huge) return n
  return n < 0 ? math.ceil(n) : math.floor(n)
}

function indexOf(s: string, search: string, from: number): number {
  const start = bytePosition(s, math.max(from, 0))
  const [position] = string.find(s, search, start, true)
  if (position === undefined) return -1
  return isAscii(s) ? position - 1 : charIndex(s, position)
}

// Регистр: латиница и кириллица (основной блок и Ѐ–Џ, ѐ–џ).
function mapCase(s: string, upper: boolean): string {
  if (isAscii(s)) return upper ? string.upper(s) : string.lower(s)
  const parts: string[] = []
  for (const c of chars(s)) {
    let cp = decodeChar(c)
    if (upper) {
      if (cp >= 0x61 && cp <= 0x7a) cp -= 0x20
      else if (cp >= 0x430 && cp <= 0x44f) cp -= 0x20
      else if (cp >= 0x450 && cp <= 0x45f) cp -= 0x50
    } else {
      if (cp >= 0x41 && cp <= 0x5a) cp += 0x20
      else if (cp >= 0x410 && cp <= 0x42f) cp += 0x20
      else if (cp >= 0x400 && cp <= 0x40f) cp += 0x50
    }
    parts.push(encodeCodePoint(cp))
  }
  return parts.join("")
}

function pad(s: string, length: Val, filler: Val, atStart: boolean): string {
  const target = integer(length, 0)
  const current = ulen(s)
  if (target <= current) return s
  if (target > LIMITS.string) err("string-too-long")
  const fill = filler === undefined ? " " : toStringValue(filler)
  if (fill === "") return s
  const fillChars = chars(fill)
  const parts: string[] = []
  for (let i = 0; i < target - current; i++) parts.push(fillChars[i % fillChars.length])
  const padding = parts.join("")
  return checked(atStart ? padding + s : s + padding)
}

export const stringMethods: Record<string, Fn> = {
  charAt(s: string, _k: Val, index: Val): string {
    return charAt(s, integer(index, 0)) ?? ""
  },
  charCodeAt(s: string, _k: Val, index: Val): number {
    const c = charAt(s, integer(index, 0))
    return c === undefined ? 0 / 0 : decodeChar(c)
  },
  codePointAt(s: string, _k: Val, index: Val): number | undefined {
    const c = charAt(s, integer(index, 0))
    return c === undefined ? undefined : decodeChar(c)
  },
  at(s: string, _k: Val, index: Val): string | undefined {
    let i = integer(index, 0)
    if (i < 0) i += ulen(s)
    return charAt(s, i)
  },
  indexOf(s: string, _k: Val, search: Val, from: Val): number {
    return indexOf(s, toStringValue(search), integer(from, 0))
  },
  lastIndexOf(s: string, _k: Val, search: Val): number {
    const needle = toStringValue(search)
    let last = -1
    let from = 0
    while (true) {
      const found = indexOf(s, needle, from)
      if (found < 0) return last
      last = found
      from = found + 1
    }
  },
  includes(s: string, _k: Val, search: Val, from: Val): boolean {
    return indexOf(s, toStringValue(search), integer(from, 0)) >= 0
  },
  startsWith(s: string, _k: Val, search: Val, position: Val): boolean {
    const needle = toStringValue(search)
    const start = bytePosition(s, integer(position, 0))
    return string.sub(s, start, start + needle.length - 1) === needle
  },
  endsWith(s: string, _k: Val, search: Val, endPosition: Val): boolean {
    const needle = toStringValue(search)
    const subject = endPosition === undefined ? s : substringChars(s, 0, integer(endPosition, 0))
    return needle === "" || string.sub(subject, -needle.length) === needle
  },
  slice(s: string, _k: Val, start: Val, finish: Val): string {
    const n = ulen(s)
    let from = integer(start, 0)
    let to = integer(finish, n)
    if (from < 0) from = math.max(n + from, 0)
    if (to < 0) to = math.max(n + to, 0)
    return substringChars(s, math.min(from, n), math.min(to, n))
  },
  substring(s: string, _k: Val, start: Val, finish: Val): string {
    const n = ulen(s)
    let from = math.min(math.max(integer(start, 0), 0), n)
    let to = math.min(math.max(integer(finish, n), 0), n)
    if (from > to) [from, to] = [to, from]
    return substringChars(s, from, to)
  },
  substr(s: string, _k: Val, start: Val, length: Val): string {
    const n = ulen(s)
    let from = integer(start, 0)
    if (from < 0) from = math.max(n + from, 0)
    const count = length === undefined ? n - from : math.max(integer(length, 0), 0)
    return substringChars(s, from, math.min(from + count, n))
  },
  toUpperCase(s: string): string {
    return mapCase(s, true)
  },
  toLowerCase(s: string): string {
    return mapCase(s, false)
  },
  trim(s: string): string {
    return string.match(s, "^%s*(.-)%s*$")[0] as string
  },
  trimStart(s: string): string {
    return string.match(s, "^%s*(.*)$")[0] as string
  },
  trimEnd(s: string): string {
    return string.match(s, "^(.-)%s*$")[0] as string
  },
  split(s: string, _k: Val, separator: Val, limit: Val): Val {
    const result = newArray()
    const max = limit === undefined ? math.huge : integer(limit, 0)
    const push = (part: string): boolean => {
      if (result.__n >= max) return false
      result.__n++
      result[result.__n] = part
      return true
    }
    if (separator === undefined) {
      push(s)
      return result
    }
    const sep = toStringValue(separator)
    charge(ulen(s) / 8)
    if (sep === "") {
      for (const c of chars(s)) if (!push(c)) break
      return result
    }
    let start = 1
    while (true) {
      const [from, to] = string.find(s, sep, start, true)
      if (from === undefined) {
        push(string.sub(s, start))
        return result
      }
      if (!push(string.sub(s, start, from - 1))) return result
      start = to! + 1
    }
  },
  repeat(s: string, _k: Val, count: Val): string {
    const n = integer(count, 0)
    if (n < 0 || n === math.huge) err("array-too-long")
    if (s.length * n > LIMITS.string) err("string-too-long")
    return string.rep(s, n)
  },
  padStart(s: string, _k: Val, length: Val, filler: Val): string {
    return pad(s, length, filler, true)
  },
  padEnd(s: string, _k: Val, length: Val, filler: Val): string {
    return pad(s, length, filler, false)
  },
  replace(s: string, _k: Val, search: Val, replacement: Val): string {
    const needle = toStringValue(search)
    const [from, to] = string.find(s, needle, 1, true)
    if (from === undefined) return s
    return checked(string.sub(s, 1, from - 1) + toStringValue(replacement) + string.sub(s, to! + 1))
  },
  replaceAll(s: string, _k: Val, search: Val, replacement: Val): string {
    const needle = toStringValue(search)
    const value = toStringValue(replacement)
    if (needle === "") err("bad-argument", "replaceAll with empty search string")
    const parts: string[] = []
    let start = 1
    while (true) {
      const [from, to] = string.find(s, needle, start, true)
      if (from === undefined) break
      parts.push(string.sub(s, start, from - 1), value)
      start = to! + 1
    }
    parts.push(string.sub(s, start))
    return checked(parts.join(""))
  },
  concat(s: string, _k: Val, ...values: Val[]): string {
    const parts = [s]
    const count = select("#", ...values)
    for (let i = 1; i <= count; i++) {
      const [value] = select(i, ...values)
      parts.push(toStringValue(value))
    }
    return checked(parts.join(""))
  },
  toString(s: string): string {
    return s
  },
  valueOf(s: string): string {
    return s
  },
  normalize(s: string): string {
    return s
  },
  localeCompare(s: string, _k: Val, other: Val): number {
    const o = toStringValue(other)
    return s < o ? -1 : s > o ? 1 : 0
  },
}

export const numberMethods: Record<string, Fn> = {
  toFixed(n: number, _k: Val, digits: Val): string {
    const d = math.min(math.max(integer(digits, 0), 0), 20)
    if (n !== n) return "NaN"
    if (math.abs(n) >= 1e21) return formatNumber(n)
    return string.format(`%.${d}f`, n)
  },
  toString(n: number, _k: Val, radix: Val): string {
    const base = radix === undefined ? 10 : integer(radix, 10)
    if (base === 10 || n !== math.floor(n) || n !== n || math.abs(n) === math.huge) return formatNumber(n)
    if (base < 2 || base > 36) err("bad-argument", "radix must be between 2 and 36")
    const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    let value = math.abs(n)
    const parts: string[] = []
    while (value > 0) {
      const digit = value % base
      parts.unshift(string.sub(digits, digit + 1, digit + 1))
      value = math.floor(value / base)
    }
    return (n < 0 ? "-" : "") + (parts.length > 0 ? parts.join("") : "0")
  },
  toPrecision(n: number, _k: Val, precision: Val): string {
    if (precision === undefined) return formatNumber(n)
    return formatNumber(tonumber(string.format(`%.${math.min(math.max(integer(precision, 1), 1), 17)}g`, n))!)
  },
  valueOf(n: number): number {
    return n
  },
}

export const booleanMethods: Record<string, Fn> = {
  toString(b: boolean): string {
    return b ? "true" : "false"
  },
  valueOf(b: boolean): boolean {
    return b
  },
}
