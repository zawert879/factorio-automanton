// Map и Set: упорядоченные словари (порядок вставки, одинаковый у всех игроков).
// Устройство: {__t = "Map" | "Set", __keys, __vals, __live — массивы слотов, __idx — ключ → слот,
// __len — занято слотов, __size — живых}. Ключи undefined и NaN — в отдельных полях __nil и __nan.
// Удалённые слоты — дыры; при большом числе дыр массивы уплотняются.
import { charge, classes, err, Fn, newArray, program, Q, Val, Y } from "./core"
import { append, isArray } from "./arrays"
import { chars } from "./strings"

export function newDict(this: void, kind: "Map" | "Set"): Val {
  charge(5)
  return { __t: kind, __cls: classes[kind], __keys: {}, __vals: {}, __live: {}, __idx: {}, __len: 0, __size: 0 }
}

function slotOf(d: Val, key: Val): number | undefined {
  if (key === undefined) return d.__nil
  if (key !== key) return d.__nan
  return d.__idx[key]
}

function setSlot(d: Val, key: Val, slot: number | undefined): void {
  if (key === undefined) d.__nil = slot
  else if (key !== key) d.__nan = slot
  else d.__idx[key] = slot
}

function dictSet(d: Val, key: Val, value: Val): void {
  const slot = slotOf(d, key)
  if (slot !== undefined) {
    d.__vals[slot] = value
    return
  }
  const n = d.__len + 1
  d.__len = n
  d.__keys[n] = key
  d.__vals[n] = value
  d.__live[n] = true
  d.__size++
  setSlot(d, key, n)
  charge(0.25)
}

function dictDelete(d: Val, key: Val): boolean {
  const slot = slotOf(d, key)
  if (slot === undefined) return false
  d.__keys[slot] = undefined
  d.__vals[slot] = undefined
  d.__live[slot] = undefined
  d.__size--
  setSlot(d, key, undefined)
  if (d.__len > 16 && d.__size * 2 < d.__len) compact(d)
  return true
}

function compact(d: Val): void {
  const keys: Val = {}
  const vals: Val = {}
  const live: Val = {}
  let n = 0
  for (let i = 1; i <= d.__len; i++) {
    if (!d.__live[i]) continue
    n++
    keys[n] = d.__keys[i]
    vals[n] = d.__vals[i]
    live[n] = true
    setSlot(d, keys[n], n)
  }
  d.__keys = keys
  d.__vals = vals
  d.__live = live
  d.__len = n
}

function dictClear(d: Val): void {
  d.__keys = {}
  d.__vals = {}
  d.__live = {}
  d.__idx = {}
  d.__len = 0
  d.__size = 0
  d.__nil = undefined
  d.__nan = undefined
}

/** Живые записи: массив пар [ключ, значение] или ключей. */
function listOf(d: Val, what: "keys" | "values" | "entries"): Val {
  const result = newArray()
  for (let i = 1; i <= d.__len; i++) {
    if (!d.__live[i]) continue
    if (what === "keys") append(result, d.__keys[i])
    else if (what === "values") append(result, d.__vals[i])
    else {
      const pair = newArray()
      append(pair, d.__keys[i])
      append(pair, d.__vals[i])
      append(result, pair)
    }
  }
  return result
}

function forEachSync(d: Val, fn: Val, isSet: boolean): void {
  const prog = program()
  const entries = listOf(d, "entries")
  for (let i = 1; i <= entries.__n; i++) {
    Q.n = Q.n - 1
    const [key, value] = [entries[i][1], entries[i][2]]
    prog.calls(fn, undefined, isSet ? key : value, key, d)
  }
}

/** Возобновляемый forEach: обход снимка записей; кадр {[2] = кадр колбэка, i, e = снимок}. */
function forEachResumable(d: Val, k: Val, fn: Val, isSet: boolean): LuaMultiReturn<[Val, Val?]> {
  const prog = program()
  let i: number
  let entries: Val
  let child: Val
  if (k !== undefined) {
    i = k.i
    entries = k.e
    child = k[2]
  } else {
    i = 1
    entries = listOf(d, "entries")
  }
  while (i <= entries.__n) {
    const key = entries[i][1]
    const [r, f] = prog.call(fn, child, undefined, isSet ? key : entries[i][2], key, d)
    child = undefined
    if (r === Y) return $multi(Y, { [2]: f, i, e: entries })
    i++
    Q.n = Q.n - 1
    if (Q.n <= 0 && i <= entries.__n) return $multi(Y, { i, e: entries })
  }
  return $multi(undefined)
}

export const mapMethods: Record<string, Fn> = {
  get(d: Val, _k: Val, key: Val): Val {
    const slot = slotOf(d, key)
    return slot === undefined ? undefined : d.__vals[slot]
  },
  set(d: Val, _k: Val, key: Val, value: Val): Val {
    dictSet(d, key, value)
    return d
  },
  has(d: Val, _k: Val, key: Val): boolean {
    return slotOf(d, key) !== undefined
  },
  delete(d: Val, _k: Val, key: Val): boolean {
    return dictDelete(d, key)
  },
  clear(d: Val): void {
    dictClear(d)
  },
  keys(d: Val): Val {
    return listOf(d, "keys")
  },
  values(d: Val): Val {
    return listOf(d, "values")
  },
  entries(d: Val): Val {
    return listOf(d, "entries")
  },
  forEach(d: Val, _k: Val, fn: Val): void {
    forEachSync(d, fn, false)
  },
}

export const setMethods: Record<string, Fn> = {
  add(d: Val, _k: Val, value: Val): Val {
    dictSet(d, value, true)
    return d
  },
  has(d: Val, _k: Val, value: Val): boolean {
    return slotOf(d, value) !== undefined
  },
  delete(d: Val, _k: Val, value: Val): boolean {
    return dictDelete(d, value)
  },
  clear(d: Val): void {
    dictClear(d)
  },
  keys(d: Val): Val {
    return listOf(d, "keys")
  },
  values(d: Val): Val {
    return listOf(d, "keys")
  },
  entries(d: Val): Val {
    const result = newArray()
    for (let i = 1; i <= d.__len; i++) {
      if (!d.__live[i]) continue
      const pair = newArray()
      append(pair, d.__keys[i])
      append(pair, d.__keys[i])
      append(result, pair)
    }
    return result
  },
  forEach(d: Val, _k: Val, fn: Val): void {
    forEachSync(d, fn, true)
  },
}

export const mapMethodsResumable: Record<string, Fn> = {
  forEach(d: Val, k: Val, fn: Val) {
    return forEachResumable(d, k, fn, false)
  },
}

export const setMethodsResumable: Record<string, Fn> = {
  forEach(d: Val, k: Val, fn: Val) {
    return forEachResumable(d, k, fn, true)
  },
}

/** Элементы для for…of и спреда: массив (сам массив, без копии) или снимок. */
export function iter(this: void, x: Val): Val {
  const t = type(x)
  if (t === "table") {
    if (x.__n !== undefined) return x
    if (x.__t === "Map") return listOf(x, "entries")
    if (x.__t === "Set") return listOf(x, "keys")
  } else if (t === "string") {
    const result = newArray()
    for (const c of chars(x)) append(result, c)
    return result
  }
  err("not-iterable", t === "nil" ? "undefined" : "object")
}

export function newMap(this: void, entries: Val): Val {
  const d = newDict("Map")
  if (entries !== undefined) {
    const items = iter(entries)
    for (let i = 1; i <= items.__n; i++) {
      const pair = items[i]
      if (!isArray(pair)) err("bad-argument", "Map entries must be [key, value] arrays")
      dictSet(d, pair[1], pair[2])
    }
  }
  return d
}

export function newSet(this: void, values: Val): Val {
  const d = newDict("Set")
  if (values !== undefined) {
    const items = iter(values)
    for (let i = 1; i <= items.__n; i++) dictSet(d, items[i], true)
  }
  return d
}
