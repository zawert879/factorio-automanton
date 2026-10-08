// Стандартная библиотека: Math, Object, Array, JSON, Number, String, parseInt и др.
// Вызывается из кода программ напрямую: LIB.Math.floor(x) (имена проверены при компиляции).
import { charge, err, LIMITS, newArray, program, Q, Val } from "./core"
import { append, isArray } from "./arrays"
import { iter, newDict } from "./collections"
import { encodeCodePoint, ulen } from "./strings"
import { formatNumber, isErrorClass, parseNumber, propertyKey, toNumber, toStringValue, truthy } from "./values"

function num(x: Val): number {
  return type(x) === "number" ? x : toNumber(x)
}

function roundHalfUp(x: number): number {
  return math.floor(x + 0.5)
}

/** log по основанию с точными значениями на степенях основания (Math.log2(8) === 3). */
function logBase(x: number, base: number): number {
  const r = math.log(x) / math.log(base)
  const rounded = roundHalfUp(r)
  return math.abs(r - rounded) < 1e-9 && base ** rounded === x ? rounded : r
}

const MathLib = {
  abs: (x: Val) => math.abs(num(x)),
  floor: (x: Val) => math.floor(num(x)),
  ceil: (x: Val) => math.ceil(num(x)),
  round: (x: Val) => {
    const n = num(x)
    return n !== n || math.abs(n) === math.huge ? n : roundHalfUp(n)
  },
  trunc: (x: Val) => {
    const n = num(x)
    return n < 0 ? math.ceil(n) : math.floor(n)
  },
  sign: (x: Val) => {
    const n = num(x)
    return n > 0 ? 1 : n < 0 ? -1 : n
  },
  min: (...values: Val[]) => {
    let result = math.huge
    const count = select("#", ...values)
    for (let i = 1; i <= count; i++) {
      const [v] = select(i, ...values)
      const n = num(v)
      if (n !== n) return n
      if (n < result) result = n
    }
    return result
  },
  max: (...values: Val[]) => {
    let result = -math.huge
    const count = select("#", ...values)
    for (let i = 1; i <= count; i++) {
      const [v] = select(i, ...values)
      const n = num(v)
      if (n !== n) return n
      if (n > result) result = n
    }
    return result
  },
  sqrt: (x: Val) => {
    const n = num(x)
    return n < 0 ? 0 / 0 : math.sqrt(n)
  },
  cbrt: (x: Val) => {
    const n = num(x)
    return n < 0 ? -((-n) ** (1 / 3)) : n ** (1 / 3)
  },
  pow: (x: Val, y: Val) => num(x) ** num(y),
  exp: (x: Val) => math.exp(num(x)),
  log: (x: Val) => {
    const n = num(x)
    return n < 0 ? 0 / 0 : math.log(n)
  },
  log2: (x: Val) => {
    const n = num(x)
    return n < 0 ? 0 / 0 : logBase(n, 2)
  },
  log10: (x: Val) => {
    const n = num(x)
    return n < 0 ? 0 / 0 : logBase(n, 10)
  },
  sin: (x: Val) => math.sin(num(x)),
  cos: (x: Val) => math.cos(num(x)),
  tan: (x: Val) => math.tan(num(x)),
  asin: (x: Val) => math.asin(num(x)),
  acos: (x: Val) => math.acos(num(x)),
  atan: (x: Val) => math.atan(num(x)),
  atan2: (y: Val, x: Val) => math.atan2(num(y), num(x)),
  hypot: (...values: Val[]) => {
    let sum = 0
    const count = select("#", ...values)
    for (let i = 1; i <= count; i++) {
      const [v] = select(i, ...values)
      sum += num(v) ** 2
    }
    return math.sqrt(sum)
  },
  random: () => math.random(),
}

// ---------- Object ----------

/** Собственные ключи объекта программы (отсортированы: порядок одинаков у всех игроков). */
export function ownKeys(this: void, o: Val): string[] {
  const keys: string[] = []
  const t = type(o)
  if (t === "nil") err("bad-argument", "Cannot convert undefined to object")
  if (t === "string") {
    for (let i = 0; i < ulen(o); i++) keys.push(tostring(i))
    return keys
  }
  if (t !== "table") return keys
  if (o.__n !== undefined) {
    for (let i = 0; i < o.__n; i++) keys.push(tostring(i))
    return keys
  }
  if (o.__t !== undefined || o.__f !== undefined) return keys
  for (const [k] of pairs(o as LuaTable<string, Val>)) {
    if (type(k) === "string" && string.sub(k, 1, 2) !== "__") keys.push(k)
  }
  table.sort(keys)
  return keys
}

function readKey(o: Val, key: string): Val {
  if (type(o) === "table" && o.__n !== undefined) return o[tonumber(key)! + 1]
  if (type(o) === "string") return string.sub(o, tonumber(key)! + 1, tonumber(key)! + 1)
  return o[key]
}

/** Скопировать собственные поля источника в объект (спред, Object.assign). */
export function objectSpread(this: void, target: Val, source: Val): void {
  if (source === undefined) return
  for (const key of ownKeys(source)) target[key] = readKey(source, key)
  charge(0.25)
}

const ObjectLib = {
  keys: (o: Val) => {
    const result = newArray()
    for (const key of ownKeys(o)) append(result, key)
    return result
  },
  values: (o: Val) => {
    const result = newArray()
    for (const key of ownKeys(o)) append(result, readKey(o, key))
    return result
  },
  entries: (o: Val) => {
    const result = newArray()
    for (const key of ownKeys(o)) {
      const pair = newArray()
      append(pair, key)
      append(pair, readKey(o, key))
      append(result, pair)
    }
    return result
  },
  assign: (target: Val, ...sources: Val[]) => {
    if (type(target) !== "table" || target.__n !== undefined || target.__t !== undefined) err("bad-argument", "Object.assign target")
    const count = select("#", ...sources)
    for (let i = 1; i <= count; i++) {
      const [source] = select(i, ...sources)
      objectSpread(target, source)
    }
    return target
  },
  fromEntries: (entries: Val) => {
    charge(1)
    const result: Val = {}
    const items = iter(entries)
    for (let i = 1; i <= items.__n; i++) {
      const pair = items[i]
      if (!isArray(pair)) err("bad-argument", "Object.fromEntries entries must be [key, value] arrays")
      const key = propertyKey(pair[1])
      if (string.sub(key, 1, 2) === "__") err("reserved-key")
      result[key] = pair[2]
    }
    return result
  },
  freeze: (o: Val) => o,
}

// ---------- Array ----------

const ArrayLib = {
  isArray: (x: Val) => isArray(x),
  from: (source: Val, mapFn: Val) => {
    const result = newArray()
    let items: Val
    if (type(source) === "table" && source.__n === undefined && source.__t === undefined && type(source.length) === "number") {
      // Array.from({ length: n }, …)
      const n = math.floor(source.length)
      if (n > LIMITS.array) err("array-too-long")
      items = { __n: n }
    } else {
      items = iter(source)
    }
    const prog = program()
    for (let i = 1; i <= items.__n; i++) {
      Q.n = Q.n - (mapFn !== undefined ? 1 : 0)
      append(result, mapFn !== undefined ? prog.calls(mapFn, undefined, items[i], i - 1) : items[i])
    }
    return result
  },
  of: (...items: Val[]) => {
    const result = newArray()
    const count = select("#", ...items)
    for (let i = 1; i <= count; i++) {
      const [v] = select(i, ...items)
      append(result, v)
    }
    return result
  },
}

// ---------- JSON ----------

function jsonString(s: string): string {
  const [escaped] = string.gsub(s, '[%c"\\]', (c: string) => {
    if (c === '"') return '\\"'
    if (c === "\\") return "\\\\"
    if (c === "\n") return "\\n"
    if (c === "\r") return "\\r"
    if (c === "\t") return "\\t"
    return string.format("\\u%04x", string.byte(c))
  })
  return `"${escaped}"`
}

function stringify(value: Val, indent: string, current: string, seen: LuaTable<Val, boolean>, inArray: boolean, depth: number): string | undefined {
  const t = type(value)
  if (depth > LIMITS.nesting) err("bad-argument", "structure is too deep for JSON")
  if (t === "nil") return inArray ? "null" : undefined
  if (t === "boolean") return value ? "true" : "false"
  if (t === "number") return value !== value || math.abs(value) === math.huge ? "null" : formatNumber(value)
  if (t === "string") return jsonString(value)
  if (t !== "table") return inArray ? "null" : undefined
  if (value.__f !== undefined || value.__hf !== undefined || value.__k !== undefined) return inArray ? "null" : undefined
  if (seen.get(value)) err("json-cycle")
  seen.set(value, true)
  Q.n = Q.n - 1
  const inner = current + indent
  const separator = indent === "" ? "," : ",\n" + inner
  const open = indent === "" ? "" : "\n" + inner
  const close = indent === "" ? "" : "\n" + current
  let result: string
  if (value.__n !== undefined) {
    const parts: string[] = []
    for (let i = 1; i <= value.__n; i++) parts.push(stringify(value[i], indent, inner, seen, true, depth + 1)!)
    result = parts.length === 0 ? "[]" : "[" + open + parts.join(separator) + close + "]"
  } else if (value.__t !== undefined) {
    result = "{}"
  } else {
    const parts: string[] = []
    const keys = ownKeys(value)
    if (value.__cls !== undefined && isErrorClass(value.__cls)) {
      for (const k of ["name", "message", "code"]) if (value[k] !== undefined && !keys.includes(k)) keys.push(k)
      table.sort(keys)
    }
    for (const key of keys) {
      const item = stringify(value[key], indent, inner, seen, false, depth + 1)
      if (item !== undefined) parts.push(jsonString(key) + (indent === "" ? ":" : ": ") + item)
    }
    result = parts.length === 0 ? "{}" : "{" + open + parts.join(separator) + close + "}"
  }
  seen.set(value, undefined as unknown as boolean)
  if (result.length > LIMITS.string) err("string-too-long")
  return result
}

/** Разбор JSON: значения программ (массивы {__n}, объекты); ключи на __ запрещены. */
function parseJson(text: string): Val {
  let pos = 1
  const fail = (what: string): never => err("json-parse", `${what} at position ${pos - 1}`)
  const skip = (): void => {
    const [, to] = string.find(text, "^[ \t\n\r]*", pos)
    pos = to! + 1
  }
  const parseString = (): string => {
    pos++
    const parts: string[] = []
    while (true) {
      const [from, to] = string.find(text, '["\\]', pos)
      if (from === undefined) fail("unterminated string")
      parts.push(string.sub(text, pos, from! - 1))
      const c = string.sub(text, from!, from!)
      if (c === '"') {
        pos = to! + 1
        return parts.join("")
      }
      const e = string.sub(text, from! + 1, from! + 1)
      pos = from! + 2
      if (e === "n") parts.push("\n")
      else if (e === "t") parts.push("\t")
      else if (e === "r") parts.push("\r")
      else if (e === "b") parts.push("\b")
      else if (e === "f") parts.push("\f")
      else if (e === "/" || e === "\\" || e === '"') parts.push(e)
      else if (e === "u") {
        let cp = tonumber(string.sub(text, pos, pos + 3), 16)
        if (cp === undefined) fail("bad \\u escape")
        pos += 4
        if (cp! >= 0xd800 && cp! <= 0xdbff && string.sub(text, pos, pos + 1) === "\\u") {
          const low = tonumber(string.sub(text, pos + 2, pos + 5), 16)
          if (low !== undefined && low >= 0xdc00 && low <= 0xdfff) {
            cp = 0x10000 + (cp! - 0xd800) * 0x400 + (low - 0xdc00)
            pos += 6
          }
        }
        parts.push(encodeCodePoint(cp!))
      } else fail("bad escape")
    }
  }
  const parseValue = (depth: number): Val => {
    if (depth > 100) fail("too deep")
    skip()
    const c = string.sub(text, pos, pos)
    if (c === "{") {
      pos++
      charge(1)
      const result: Val = {}
      skip()
      if (string.sub(text, pos, pos) === "}") {
        pos++
        return result
      }
      while (true) {
        skip()
        if (string.sub(text, pos, pos) !== '"') fail("expected string key")
        const key = parseString()
        if (string.sub(key, 1, 2) === "__") err("reserved-key")
        skip()
        if (string.sub(text, pos, pos) !== ":") fail("expected ':'")
        pos++
        result[key] = parseValue(depth + 1)
        skip()
        const d = string.sub(text, pos, pos)
        pos++
        if (d === "}") return result
        if (d !== ",") fail("expected ',' or '}'")
      }
    }
    if (c === "[") {
      pos++
      const result = newArray()
      skip()
      if (string.sub(text, pos, pos) === "]") {
        pos++
        return result
      }
      while (true) {
        append(result, parseValue(depth + 1))
        skip()
        const d = string.sub(text, pos, pos)
        pos++
        if (d === "]") return result
        if (d !== ",") fail("expected ',' or ']'")
      }
    }
    if (c === '"') return parseString()
    if (string.sub(text, pos, pos + 3) === "true") {
      pos += 4
      return true
    }
    if (string.sub(text, pos, pos + 4) === "false") {
      pos += 5
      return false
    }
    if (string.sub(text, pos, pos + 3) === "null") {
      pos += 4
      return undefined
    }
    const [from, to] = string.find(text, "^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
    if (from === undefined) fail("unexpected token")
    const n = tonumber(string.sub(text, from!, to!))
    if (n === undefined) fail("bad number")
    pos = to! + 1
    return n
  }
  const result = parseValue(0)
  skip()
  if (pos <= text.length) fail("unexpected data after JSON")
  return result
}

const JsonLib = {
  stringify: (value: Val, _replacer: Val, space: Val) => {
    let indent = ""
    if (type(space) === "number") indent = string.rep(" ", math.min(math.max(math.floor(space), 0), 10))
    else if (type(space) === "string") indent = string.sub(space, 1, 10)
    return stringify(value, indent, "", new LuaTable(), false, 0)
  },
  parse: (text: Val) => {
    const s = toStringValue(text)
    Q.n = Q.n - math.floor(s.length / 256)
    return parseJson(s)
  },
}

// ---------- Числа ----------

function parseIntJs(value: Val, radix: Val): number {
  let s = string.match(toStringValue(value), "^%s*(.-)%s*$")[0] as string
  let sign = 1
  const first = string.sub(s, 1, 1)
  if (first === "-" || first === "+") {
    if (first === "-") sign = -1
    s = string.sub(s, 2)
  }
  let base = radix === undefined ? 0 : math.floor(num(radix))
  if (base === 0 || base === 16) {
    const prefix = string.lower(string.sub(s, 1, 2))
    if (prefix === "0x") {
      s = string.sub(s, 3)
      base = 16
    }
  }
  if (base === 0) base = 10
  if (base < 2 || base > 36) return 0 / 0
  let result = 0
  let digits = 0
  for (let i = 1; i <= s.length; i++) {
    const c = string.byte(s, i)
    let digit: number
    if (c >= 48 && c <= 57) digit = c - 48
    else if (c >= 97 && c <= 122) digit = c - 87
    else if (c >= 65 && c <= 90) digit = c - 55
    else break
    if (digit >= base) break
    result = result * base + digit
    digits++
  }
  return digits === 0 ? 0 / 0 : sign * result
}

function parseFloatJs(value: Val): number {
  const s = string.match(toStringValue(value), "^%s*(.-)%s*$")[0] as string
  const [infinity] = string.find(s, "^[-+]?Infinity")
  if (infinity !== undefined) return string.sub(s, 1, 1) === "-" ? -math.huge : math.huge
  const [prefix] = string.match(s, "^([-+]?%d*%.?%d*[eE][-+]?%d+)")
  const [simple] = string.match(s, "^([-+]?%d*%.?%d*)")
  const candidate = (prefix as string | undefined) ?? (simple as string | undefined) ?? ""
  const n = tonumber(candidate)
  return n === undefined ? 0 / 0 : n
}

const NumberLib = {
  isInteger: (x: Val) => type(x) === "number" && x === math.floor(x) && math.abs(x) !== math.huge,
  isFinite: (x: Val) => type(x) === "number" && x === x && math.abs(x) !== math.huge,
  isNaN: (x: Val) => type(x) === "number" && x !== x,
  parseInt: parseIntJs,
  parseFloat: parseFloatJs,
}

const StringLib = {
  fromCharCode: (...codes: Val[]) => {
    const parts: string[] = []
    const count = select("#", ...codes)
    for (let i = 1; i <= count; i++) {
      const [code] = select(i, ...codes)
      parts.push(encodeCodePoint(math.floor(num(code)) % 0x110000))
    }
    return parts.join("")
  },
}

/** Библиотечные функции как значения: [1, 2].map(String). */
export const libFunctions: Record<string, (this: void, ...args: Val[]) => Val> = {
  String: (...values: Val[]) => (select("#", ...values) === 0 ? "" : toStringValue(select(1, ...values)[0])),
  Number: (...values: Val[]) => (select("#", ...values) === 0 ? 0 : toNumber(select(1, ...values)[0])),
  Boolean: (x: Val) => truthy(x),
  parseInt: parseIntJs,
  parseFloat: parseFloatJs,
  isNaN: (x: Val) => {
    const n = toNumber(x)
    return n !== n
  },
  isFinite: (x: Val) => {
    const n = toNumber(x)
    return n === n && math.abs(n) !== math.huge
  },
}

export const lib = {
  Math: MathLib,
  Object: ObjectLib,
  Array: ArrayLib,
  JSON: JsonLib,
  Number: NumberLib,
  String: StringLib,
  parseInt: parseIntJs,
  parseFloat: parseFloatJs,
  isNaN: libFunctions.isNaN,
  isFinite: libFunctions.isFinite,
  Boolean: libFunctions.Boolean,
  StringOf: libFunctions.String,
  NumberOf: libFunctions.Number,
}

void parseNumber
void newDict
