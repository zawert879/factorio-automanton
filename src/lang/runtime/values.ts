// Преобразования значений как в JavaScript: в строку, в число, typeof, истинность.
import { classes, describe, program, Val } from "./core"

const INTEGER_LIMIT = 2 ** 53

/** Число → строка по правилам JavaScript (Number.prototype.toString): кратчайшая запись. */
export function formatNumber(this: void, n: number): string {
  if (n !== n) return "NaN"
  if (n === math.huge) return "Infinity"
  if (n === -math.huge) return "-Infinity"
  if (n === 0) return "0"
  if (n === math.floor(n) && math.abs(n) < INTEGER_LIMIT) return string.format("%d", n)
  let mantissa = ""
  let exponent = 0
  for (let precision = 0; precision <= 16; precision++) {
    const s = string.format(`%.${precision}e`, n)
    if (tonumber(s) === n || precision === 16) {
      const [m, e] = string.match(s, "^%-?([%d%.]+)e([-+]%d+)$")
      mantissa = string.gsub(m as string, "%.", "")[0]
      exponent = tonumber(e)!
      break
    }
  }
  mantissa = string.gsub(mantissa, "0+$", "")[0]
  if (mantissa === "") mantissa = "0"
  const k = mantissa.length
  const point = exponent + 1
  let body: string
  if (k <= point && point <= 21) body = mantissa + string.rep("0", point - k)
  else if (0 < point && point <= 21) body = mantissa.substring(0, point) + "." + mantissa.substring(point)
  else if (-6 < point && point <= 0) body = "0." + string.rep("0", -point) + mantissa
  else {
    const rest = mantissa.substring(1)
    body = mantissa.substring(0, 1) + (rest !== "" ? "." + rest : "") + "e" + (point - 1 >= 0 ? "+" : "-") + tostring(math.abs(point - 1))
  }
  return n < 0 ? "-" + body : body
}

/** Строка → число по правилам JavaScript (Number("…")). */
export function parseNumber(this: void, s: string): number {
  const [trimmed] = string.match(s, "^%s*(.-)%s*$")
  const t = trimmed as string
  if (t === "") return 0
  if (t === "Infinity" || t === "+Infinity") return math.huge
  if (t === "-Infinity") return -math.huge
  // Lua понимает и то, чего нет в JS («0x1p4», «inf», «nan»): разрешены только формы JS.
  const [decimal] = string.find(t, "^[-+]?%d*%.?%d*[eE]?[-+]?%d*$")
  const [hex] = string.find(t, "^0[xX]%x+$")
  if (decimal === undefined && hex === undefined) return 0 / 0
  const n = tonumber(t)
  return n === undefined ? 0 / 0 : n
}

export function toNumber(this: void, x: Val): number {
  const t = type(x)
  if (t === "number") return x
  if (t === "string") return parseNumber(x)
  if (t === "boolean") return x ? 1 : 0
  if (t === "nil") return 0 / 0
  if (t === "table" && x.__n !== undefined) {
    if (x.__n === 0) return 0
    if (x.__n === 1) return toNumber(x[1])
  }
  return 0 / 0
}

export function typeOf(this: void, x: Val): string {
  const t = type(x)
  if (t === "nil") return "undefined"
  if (t === "table") {
    if (x.__f !== undefined || x.__hf !== undefined || x.__lf !== undefined || x.__k !== undefined) return "function"
    return "object"
  }
  if (t === "userdata") return "object"
  return t
}

export function truthy(this: void, x: Val): boolean {
  return x !== undefined && x !== false && x !== 0 && x !== "" && x === x
}

/** Значение → строка (String(x), шаблонные строки, +). */
export function toStringValue(this: void, x: Val): string {
  return stringOf(x, 0)
}

function stringOf(x: Val, depth: number): string {
  const t = type(x)
  if (t === "string") return x
  if (t === "number") return formatNumber(x)
  if (t === "nil") return "undefined"
  if (t === "boolean") return x ? "true" : "false"
  if (t !== "table") return hostToString(x)
  if (x.__n !== undefined) {
    if (depth > 20) return ""
    const parts: string[] = []
    for (let i = 1; i <= x.__n; i++) {
      const item = x[i]
      parts.push(item === undefined ? "" : stringOf(item, depth + 1))
    }
    return parts.join(",")
  }
  if (x.__f !== undefined || x.__hf !== undefined || x.__lf !== undefined) return "function"
  if (x.__k !== undefined) return `class ${x.__name}`
  if (x.__t === "Map") return "[object Map]"
  if (x.__t === "Set") return "[object Set]"
  if (x.__t === "host") return `[${x.__h}]`
  const cls = x.__cls
  if (cls !== undefined) {
    const custom = findMethod(cls, "toString")
    if (custom !== undefined) {
      const result = program().calls(custom, x)
      return type(result) === "string" ? result : stringOf(result, depth + 1)
    }
    if (isErrorClass(cls)) {
      const name = x.name !== undefined ? stringOf(x.name, depth + 1) : "Error"
      const message = x.message !== undefined ? stringOf(x.message, depth + 1) : ""
      return message === "" ? name : `${name}: ${message}`
    }
  }
  return "[object Object]"
}

function findMethod(cls: Val, name: string): Val {
  return cls.__m[name]
}

export function isErrorClass(this: void, cls: Val): boolean {
  while (cls !== undefined) {
    if (cls.__builtin === "Error") return true
    cls = cls.__s
  }
  return false
}

/** Описание объекта игры (игровой слой заменяет). */
export let hostToString: (this: void, x: Val) => string = (x) => `[${describe(x)}]`

export function setHostToString(this: void, fn: (this: void, x: Val) => string): void {
  hostToString = fn
}

/** Ключ объекта из значения: строки как есть, числа — в запись JS. */
export function propertyKey(this: void, k: Val): string {
  if (type(k) === "string") return k
  if (type(k) === "number") return formatNumber(k)
  return toStringValue(k)
}

void classes
