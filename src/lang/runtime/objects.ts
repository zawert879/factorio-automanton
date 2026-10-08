// Свойства, методы, вызовы и классы — медленные пути операций пролога (GET → getx и т. д.).
import {
  charge,
  describe,
  err,
  Fn,
  host,
  hostBlocking,
  hostGetters,
  hostMethods,
  hostSetters,
  hostValue,
  LIMITS,
  makeError,
  program,
  Val,
} from "./core"
import { append, arrayMethods, arrayMethodsResumable, isArray } from "./arrays"
import { iter, mapMethods, mapMethodsResumable, newMap, newSet, setMethods, setMethodsResumable } from "./collections"
import { libFunctions, ownKeys } from "./library"
import { booleanMethods, charAt, numberMethods, stringMethods, ulen } from "./strings"
import { isErrorClass, propertyKey, toNumber, toStringValue } from "./values"

/** Обычный объект или экземпляр класса: поля можно писать напрямую. */
function isPlain(o: Val): boolean {
  return o.__n === undefined && o.__t === undefined && o.__f === undefined && o.__hf === undefined
}

export function checkKey(this: void, k: string): void {
  if (string.sub(k, 1, 2) === "__") err("reserved-key")
}

function setLength(arr: Val, value: Val): void {
  const n = toNumber(value)
  if (n < 0 || n !== math.floor(n) || n > LIMITS.array) err("array-too-long")
  for (let i = n + 1; i <= arr.__n; i++) arr[i] = undefined
  if (n > arr.__n) charge((n - arr.__n) / 8)
  arr.__n = n
}

/** Чтение свойства, которого нет прямо в таблице, — или не у таблицы. */
export function getx(this: void, o: Val, k: Val): Val {
  const t = type(o)
  if (t === "table") {
    if (o.__n !== undefined) return k === "length" ? o.__n : undefined
    const tag = o.__t
    if (tag === "Map" || tag === "Set") return k === "size" ? o.__size : undefined
    if (tag === "host") {
      const getter = hostGetters[o.__h]?.[k]
      return getter !== undefined ? getter(o) : undefined
    }
    const cls = o.__cls
    if (cls !== undefined) {
      const getter = cls.__g[k]
      if (getter !== undefined) return program().calls(getter, o)
      return cls.__m[k]
    }
    if (o.__k !== undefined) {
      if (k === "name") return o.__name
      let parent = o.__s
      while (parent !== undefined) {
        const v = parent[k]
        if (v !== undefined) return v
        parent = parent.__s
      }
    }
    return undefined
  }
  if (t === "string") return k === "length" ? ulen(o) : undefined
  if (t === "nil") err("read-property", "undefined", k)
  if (t === "userdata" && hostValue.get !== undefined) return hostValue.get(o, k)
  return undefined
}

export function setx(this: void, o: Val, k: Val, v: Val): void {
  const t = type(o)
  if (t === "table") {
    if (o.__n !== undefined) {
      if (k === "length") {
        setLength(o, v)
        return
      }
      err("set-property", "array", k)
    }
    if (o.__t === "host") {
      const setter = hostSetters[o.__h]?.[k]
      if (setter !== undefined) {
        setter(o, v)
        return
      }
      err("set-property", o.__h, k)
    }
    err("set-property", describe(o), k)
  }
  if (t === "nil") err("set-property", "undefined", k)
  if (t === "userdata" && hostValue.set !== undefined) {
    hostValue.set(o, k, v)
    return
  }
  err("set-property", describe(o), k)
}

/** o[i] для случаев, которых нет в быстром пути (строковые ключи, строки, объекты). */
export function idxx(this: void, o: Val, i: Val): Val {
  const t = type(o)
  if (t === "nil") err("read-property", "undefined", propertyKey(i))
  const ti = type(i)
  if (ti === "number") {
    if (t === "string") return charAt(o, i)
    if (t === "table") {
      if (o.__n !== undefined) return o[i + 1]
      const key = propertyKey(i)
      const v = o[key]
      return v !== undefined ? v : getx(o, key)
    }
    return undefined
  }
  const key = ti === "string" ? (i as string) : propertyKey(i)
  checkKey(key)
  if (t === "table") {
    const v = o[key]
    if (v !== undefined) return v
  }
  return getx(o, key)
}

export function setidxx(this: void, o: Val, i: Val, v: Val): void {
  const t = type(o)
  const ti = type(i)
  if (t === "table" && o.__n !== undefined) {
    if (ti === "number") {
      if (i < 0 || i !== math.floor(i)) err("bad-argument", `array index ${propertyKey(i)}`)
      if (i >= LIMITS.array) err("array-too-long")
      if (i >= o.__n) {
        charge((i + 1 - o.__n) / 8)
        o.__n = i + 1
      }
      o[i + 1] = v
      return
    }
    if (i === "length") {
      setLength(o, v)
      return
    }
    err("set-property", "array", propertyKey(i))
  }
  const key = ti === "string" ? (i as string) : propertyKey(i)
  checkKey(key)
  if (t === "table" && isPlain(o)) {
    o[key] = v
    return
  }
  setx(o, key, v)
}

export function lenx(this: void, o: Val): Val {
  const t = type(o)
  if (t === "string") return ulen(o)
  if (t === "nil") err("read-property", "undefined", "length")
  if (t === "table") {
    const v = o.length
    return v !== undefined ? v : getx(o, "length")
  }
  return getx(o, "length")
}

export function addx(this: void, a: Val, b: Val): Val {
  const ta = type(a)
  const tb = type(b)
  if (ta === "string" || tb === "string" || ta === "table" || tb === "table") {
    const s = toStringValue(a) + toStringValue(b)
    if (s.length > LIMITS.string) err("string-too-long")
    return s
  }
  if ((ta === "number" || ta === "boolean") && (tb === "number" || tb === "boolean")) return toNumber(a) + toNumber(b)
  err("add", describe(a), describe(b))
}

// ---------- Методы ----------

const objectMethods: Record<string, Fn> = {
  toString(o: Val): string {
    return toStringValue(o)
  },
  valueOf(o: Val): Val {
    return o
  },
  hasOwnProperty(o: Val, _k: Val, key: Val): boolean {
    const name = propertyKey(key)
    if (string.sub(name, 1, 2) === "__") return false
    if (o.__n !== undefined) {
      const index = tonumber(name)
      return index !== undefined && index >= 0 && index < o.__n
    }
    return o[name] !== undefined
  },
}

function noMethod(o: Val, name: string): never {
  err("no-method", describe(o), name)
}

/** Функция метода значения: (o, k, ...аргументы). resumable — нужна версия, которая может приостановиться. */
export function method(this: void, o: Val, name: string, resumable: boolean): Fn {
  const t = type(o)
  if (t === "table") {
    if (o.__n !== undefined) return (resumable && arrayMethodsResumable[name]) || arrayMethods[name] || noMethod(o, name)
    const tag = o.__t
    if (tag === "Map") return (resumable && mapMethodsResumable[name]) || mapMethods[name] || objectMethods[name] || noMethod(o, name)
    if (tag === "Set") return (resumable && setMethodsResumable[name]) || setMethods[name] || objectMethods[name] || noMethod(o, name)
    if (tag === "host") return hostMethods[o.__h]?.[name] ?? noMethod(o, name)
    if (o.__k !== undefined) {
      // Унаследованный статический метод.
      let parent = o.__s
      while (parent !== undefined) {
        const fn = parent[name]
        if (fn !== undefined) return (self: Val, k: Val, ...args: Val[]) => program().call(fn, k, self, ...args)
        parent = parent.__s
      }
      return noMethod(o, name)
    }
    return objectMethods[name] ?? noMethod(o, name)
  }
  if (t === "string") return stringMethods[name] ?? noMethod(o, name)
  if (t === "number") return numberMethods[name] ?? noMethod(o, name)
  if (t === "boolean") return booleanMethods[name] ?? noMethod(o, name)
  if (t === "nil") err("read-property", "undefined", name)
  if (t === "userdata" && hostValue.method !== undefined) return hostValue.method(o, name) ?? noMethod(o, name)
  return noMethod(o, name)
}

/** Вызов значения, которое не функция программы: функции API как значения, ошибки. */
export function callx(this: void, c: Val, k: Val, _self: Val, ...args: Val[]): Val {
  if (type(c) === "table") {
    if (c.__hf !== undefined) {
      const fn = host[c.__hf]
      if (hostBlocking[c.__hf]) return fn(k, ...args)
      return fn(...args)
    }
    if (c.__lf !== undefined) return libFunctions[c.__lf](...args)
    if (c.__k !== undefined) err("class-call", c.__name)
  }
  err("not-a-function", describe(c))
}

export function libFunction(this: void, name: string): Val {
  charge(1)
  return { __lf: name }
}

export function hostFunction(this: void, name: string): Val {
  charge(1)
  return { __hf: name }
}

// ---------- Операторы ----------

export function has(this: void, o: Val, k: Val): boolean {
  if (type(o) !== "table") err("in-operator", describe(o), propertyKey(k))
  if (o.__n !== undefined) {
    if (k === "length") return true
    const index = type(k) === "number" ? k : tonumber(k)
    return index !== undefined && index >= 0 && index < o.__n && index === math.floor(index)
  }
  const key = propertyKey(k)
  if (string.sub(key, 1, 2) === "__") return false
  if (o[key] !== undefined) return true
  const cls = o.__cls
  if (cls !== undefined && (cls.__g[key] !== undefined || cls.__m[key] !== undefined)) return true
  if ((o.__t === "Map" || o.__t === "Set") && key === "size") return true
  return false
}

export function instanceOf(this: void, o: Val, cls: Val): boolean {
  if (type(cls) !== "table" || cls.__k === undefined) err("not-a-class")
  if (type(o) !== "table") return false
  let c = o.__cls
  while (c !== undefined) {
    // Встроенные классы сравниваются по имени: после загрузки сохранения таблица класса — копия.
    if (c === cls || (cls.__builtin !== undefined && c.__builtin === cls.__builtin)) return true
    c = c.__s
  }
  return false
}

function toInt32(x: Val): number {
  const n = toNumber(x)
  if (n !== n || math.abs(n) === math.huge) return 0
  return (n < 0 ? math.ceil(n) : math.floor(n)) % 4294967296
}

function signed(n: number): number {
  return n >= 2147483648 ? n - 4294967296 : n
}

// TypeScriptToLua не пропускает имя bit32 как глобальное — берём из _G.
const bit: Val = (_G as Val)["bit32"]

export const bitwise = {
  band: (a: Val, b: Val) => signed(bit.band(toInt32(a), toInt32(b))),
  bor: (a: Val, b: Val) => signed(bit.bor(toInt32(a), toInt32(b))),
  bxor: (a: Val, b: Val) => signed(bit.bxor(toInt32(a), toInt32(b))),
  bnot: (a: Val) => signed(bit.bnot(toInt32(a))),
  shl: (a: Val, b: Val) => signed(bit.lshift(toInt32(a), toInt32(b) % 32)),
  shr: (a: Val, b: Val) => signed(bit.arshift(toInt32(a), toInt32(b) % 32)),
  ushr: (a: Val, b: Val) => bit.rshift(toInt32(a), toInt32(b) % 32),
}

// ---------- Классы ----------

export function newClass(this: void, index: number, name: string, parent: Val): Val {
  if (parent !== undefined && (type(parent) !== "table" || parent.__k === undefined)) err("extends-not-class")
  charge(3)
  const cls: Val = { __k: index, __name: name, __s: parent, __m: {}, __g: {} }
  if (parent !== undefined) {
    for (const [k, v] of pairs(parent.__m as LuaTable<string, Val>)) cls.__m[k] = v
    for (const [k, v] of pairs(parent.__g as LuaTable<string, Val>)) cls.__g[k] = v
  }
  return cls
}

const ERROR_CLASSES: Record<string, boolean> = { Error: true, TypeError: true, RangeError: true, SyntaxError: true }

/** new для встроенных классов: new Map(…), new Error(…). */
export function construct(this: void, name: string, a: Val, b: Val): Val {
  if (name === "Map") return newMap(a)
  if (name === "Set") return newSet(a)
  if (ERROR_CLASSES[name]) return makeError(name, a === undefined ? "" : toStringValue(a))
  if (name === "ActionError") return makeError("ActionError", b === undefined ? "" : toStringValue(b), a)
  err("not-a-constructor", name)
}

/** Встроенный класс без new: Error("…") можно, Map() — нет. */
export function callClass(this: void, name: string, a: Val, b: Val): Val {
  if (ERROR_CLASSES[name] || name === "ActionError") return construct(name, a, b)
  err("class-call", name)
}

/** NEW для значения, которое не класс программы. */
export function newBuiltin(this: void, cls: Val, a: Val, b: Val): Val {
  if (type(cls) === "table" && cls.__builtin !== undefined) return construct(cls.__builtin, a, b)
  err("not-a-constructor", describe(cls))
}

/** super(…) у наследника встроенного класса (Error). */
export function superBuiltin(this: void, parent: Val, self: Val, a: Val, b: Val): void {
  if (parent.__builtin === "ActionError") {
    self.code = a
    self.message = b === undefined ? "" : toStringValue(b)
  } else if (isErrorClass(parent)) {
    self.message = a === undefined ? "" : toStringValue(a)
  } else {
    err("not-a-constructor", parent.__name)
  }
  self.name = self.__cls.__name
}

/** super.имя вне вызова: геттер или метод родителя. */
export function superGet(this: void, cls: Val, self: Val, name: string): Val {
  const parent = cls.__s
  const getter = parent.__g[name]
  if (getter !== undefined) return program().calls(getter, self)
  const m = parent.__m[name]
  return m !== undefined ? m : self[name]
}

// ---------- Литералы, спред, деструктуризация ----------

export function setKey(this: void, t: Val, k: Val, v: Val): void {
  const key = propertyKey(k)
  checkKey(key)
  t[key] = v
}

export function objectRest(this: void, source: Val, exclude: Val): Val {
  if (source === undefined) err("read-property", "undefined", "...")
  const skip: Record<string, boolean> = {}
  for (let i = 1; exclude[i] !== undefined; i++) skip[exclude[i]] = true
  charge(1)
  const result: Val = {}
  for (const key of ownKeys(source)) {
    if (skip[key]) continue
    result[key] = source.__n !== undefined ? source[tonumber(key)! + 1] : source[key]
  }
  return result
}

export function arrayRest(this: void, source: Val, from: number): Val {
  const items = iter(source)
  const result: Val = { __n: 0 }
  charge(1)
  for (let i = from + 1; i <= items.__n; i++) append(result, items[i])
  return result
}

export function spreadInto(this: void, target: Val, source: Val): void {
  const items = iter(source)
  for (let i = 1; i <= items.__n; i++) append(target, items[i])
}

export function push1(this: void, target: Val, value: Val): void {
  append(target, value)
}

export function unpack(this: void, arr: Val): LuaMultiReturn<Val[]> {
  return table.unpack(arr, 1, arr.__n)
}

export function args(this: void, ...items: Val[]): Val {
  const count = select("#", ...items)
  if (count > LIMITS.array) err("array-too-long")
  const result: Val = { __n: count }
  for (let i = 1; i <= count; i++) {
    const [v] = select(i, ...items)
    result[i] = v
  }
  charge(1 + count / 8)
  return result
}

// ---------- Исключения ----------

/** throw: значения-не таблицы оборачиваются, чтобы отличить их от ошибок Lua (строк). */
export function throwValue(this: void, v: Val, line: number): never {
  if (type(v) === "table") {
    if (v.__cls !== undefined && v.__line === undefined) v.__line = line
    error(v, 0)
  }
  error({ __wrap: true, __thrown: v, __line: line } as unknown as string, 0)
}

const LUA_TYPES: Record<string, string> = { nil: "undefined", table: "object" }

/** Подстрока есть в строке (string.find возвращает несколько значений — сравнивать напрямую нельзя). */
function found(text: string, part: string): boolean {
  const [position] = string.find(text, part, 1, true)
  return position !== undefined
}

function luaTypeName(name: string): string {
  return LUA_TYPES[name] ?? name
}

/** Ошибка Lua (строка) → объект Error программы с понятным текстом. */
export function luaError(this: void, message: string): Val {
  const [line, rest] = string.match(message, "^prog:(%d+): (.*)$")
  let text = (rest as string | undefined) ?? (string.match(message, "^[^:]*:%d+: (.*)$")[0] as string | undefined) ?? message
  let className = "TypeError"
  const [indexed] = string.match(text, "attempt to index .*%(a (%a+) value%)")
  const [arithmetic] = string.match(text, "attempt to perform arithmetic on .*%(a (%a+) value%)")
  const [called] = string.match(text, "attempt to call .*%(a (%a+) value%)")
  const [left, right] = string.match(text, "attempt to compare (%a+) with (%a+)")
  if (indexed !== undefined) {
    // Чтение поля без проверки (быстрый путь): имя свойства — по строке программы.
    const key = line !== undefined ? (program() as Val).keys?.[tonumber(line)!] : undefined
    text = `Cannot read properties of ${luaTypeName(indexed as string)}` + (key !== undefined ? ` (reading '${key}')` : "")
  }
  else if (arithmetic !== undefined) text = `Cannot use ${luaTypeName(arithmetic as string)} in arithmetic`
  else if (called !== undefined) text = `${luaTypeName(called as string)} is not a function`
  else if (left !== undefined) text = `Cannot compare ${luaTypeName(left as string)} with ${luaTypeName(right as string)}`
  else if (found(text, "stack overflow")) {
    text = "Maximum call stack size exceeded"
    className = "RangeError"
  } else if (found(text, "not enough memory")) {
    text = "Out of memory"
    className = "RangeError"
  } else className = "Error"
  const e = makeError(className, text, "lua")
  if (line !== undefined) e.__luaLine = tonumber(line)
  return e
}

/** catch (e): значение, брошенное throw, или Error из ошибки Lua. */
export function caught(this: void, e: Val): Val {
  const t = type(e)
  if (t === "table") return e.__wrap ? e.__thrown : e
  if (t === "string") return luaError(e)
  return e
}

void isArray
