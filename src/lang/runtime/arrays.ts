// Методы массивов. Массив — {__n = длина, [1..n] = элементы}.
// Сигнатура метода: (массив, k, ...аргументы); k — кадр продолжения (только у возобновляемых версий).
// Методы высшего порядка есть в двух версиях: синхронной (колбэк вызывается до конца, без пауз) и
// возобновляемой (колбэк может приостановить программу — метод сохраняет позицию в своём кадре).
import { charge, err, Fn, isCallable, LIMITS, newArray, program, Q, Val, Y } from "./core"
import { toStringValue, truthy } from "./values"

export function isArray(this: void, x: Val): boolean {
  return type(x) === "table" && x.__n !== undefined
}

/** Добавить элемент (с проверкой длины). */
export function append(this: void, arr: Val, value: Val): void {
  const n = arr.__n + 1
  if (n > LIMITS.array) err("array-too-long")
  arr[n] = value
  arr.__n = n
  charge(0.125)
}

/** Индекс JS из аргумента: целое, отрицательные — с конца (как в slice). */
function relative(index: Val, length: number, fallback: number): number {
  if (index === undefined) return fallback
  let i = math.floor(type(index) === "number" ? index : tonumber(index) ?? 0)
  if (i !== i) i = 0
  if (i < 0) i = math.max(length + i, 0)
  return math.min(i, length)
}

function callback(fn: Val, name: string): Val {
  if (!isCallable(fn)) err("not-a-function", `${name} callback`)
  return fn
}

/** Сравнение по SameValueZero (includes): NaN равен NaN. */
function sameValueZero(a: Val, b: Val): boolean {
  return a === b || (a !== a && b !== b)
}

function defaultCompare(a: Val, b: Val): boolean {
  // Как в JS: undefined — в конец, остальное — сравнение строк.
  if (a === undefined) return false
  if (b === undefined) return true
  return toStringValue(a) < toStringValue(b)
}

/** Устойчивая сортировка слиянием: before(a, b) — a строго раньше b. */
function mergeSort(items: Val, n: number, before: (this: void, a: Val, b: Val) => boolean): void {
  if (n < 2) return
  const buffer: Val = {}
  let width = 1
  while (width < n) {
    let i = 1
    while (i <= n) {
      const mid = math.min(i + width, n + 1)
      const hi = math.min(i + 2 * width, n + 1)
      let a = i
      let b = mid
      let o = i
      while (a < mid && b < hi) {
        if (before(items[b], items[a])) {
          buffer[o] = items[b]
          b++
        } else {
          buffer[o] = items[a]
          a++
        }
        o++
      }
      while (a < mid) {
        buffer[o] = items[a]
        a++
        o++
      }
      while (b < hi) {
        buffer[o] = items[b]
        b++
        o++
      }
      i = hi
    }
    for (let j = 1; j <= n; j++) items[j] = buffer[j]
    width *= 2
  }
  Q.n = Q.n - math.floor(n / 8)
}

export const arrayMethods: Record<string, Fn> = {
  push(arr: Val, _k: Val, ...items: Val[]): number {
    const count = select("#", ...items)
    if (count === 1) {
      const [value] = select(1, ...items)
      append(arr, value)
    } else {
      for (let i = 1; i <= count; i++) {
        const [value] = select(i, ...items)
        append(arr, value)
      }
    }
    return arr.__n
  },
  pop(arr: Val): Val {
    const n = arr.__n
    if (n === 0) return undefined
    const value = arr[n]
    arr[n] = undefined
    arr.__n = n - 1
    return value
  },
  shift(arr: Val): Val {
    const n = arr.__n
    if (n === 0) return undefined
    const value = arr[1]
    for (let i = 1; i < n; i++) arr[i] = arr[i + 1]
    arr[n] = undefined
    arr.__n = n - 1
    Q.n = Q.n - math.floor(n / 64)
    return value
  },
  unshift(arr: Val, _k: Val, ...items: Val[]): number {
    const count = select("#", ...items)
    const n = arr.__n
    if (n + count > LIMITS.array) err("array-too-long")
    for (let i = n; i >= 1; i--) arr[i + count] = arr[i]
    for (let i = 1; i <= count; i++) {
      const [value] = select(i, ...items)
      arr[i] = value
    }
    arr.__n = n + count
    charge(count / 8)
    return arr.__n
  },
  slice(arr: Val, _k: Val, start: Val, finish: Val): Val {
    const n = arr.__n
    const from = relative(start, n, 0)
    const to = relative(finish, n, n)
    const result = newArray()
    for (let i = from + 1; i <= to; i++) append(result, arr[i])
    return result
  },
  splice(arr: Val, _k: Val, start: Val, deleteCount: Val, ...items: Val[]): Val {
    const n = arr.__n
    const from = relative(start, n, 0)
    const count = select("#", ...items)
    let remove = deleteCount === undefined ? n - from : math.max(0, math.min(math.floor(deleteCount), n - from))
    if (start === undefined) remove = 0
    const removed = newArray()
    for (let i = 1; i <= remove; i++) append(removed, arr[from + i])
    const tail: Val[] = []
    for (let i = from + remove + 1; i <= n; i++) tail.push(arr[i])
    if (from + count + tail.length > LIMITS.array) err("array-too-long")
    let o = from
    for (let i = 1; i <= count; i++) {
      const [value] = select(i, ...items)
      o++
      arr[o] = value
    }
    for (const value of tail) {
      o++
      arr[o] = value
    }
    for (let i = o + 1; i <= n; i++) arr[i] = undefined
    arr.__n = o
    return removed
  },
  concat(arr: Val, _k: Val, ...values: Val[]): Val {
    const result = newArray()
    for (let i = 1; i <= arr.__n; i++) append(result, arr[i])
    const count = select("#", ...values)
    for (let j = 1; j <= count; j++) {
      const [value] = select(j, ...values)
      if (isArray(value)) for (let i = 1; i <= value.__n; i++) append(result, value[i])
      else append(result, value)
    }
    return result
  },
  join(arr: Val, _k: Val, separator: Val): string {
    const sep = separator === undefined ? "," : toStringValue(separator)
    const parts: string[] = []
    for (let i = 1; i <= arr.__n; i++) {
      const item = arr[i]
      parts.push(item === undefined ? "" : toStringValue(item))
    }
    const s = parts.join(sep)
    if (s.length > LIMITS.string) err("string-too-long")
    return s
  },
  toString(arr: Val): string {
    return toStringValue(arr)
  },
  reverse(arr: Val): Val {
    const n = arr.__n
    for (let i = 1; i <= math.floor(n / 2); i++) {
      const tmp = arr[i]
      arr[i] = arr[n + 1 - i]
      arr[n + 1 - i] = tmp
    }
    return arr
  },
  indexOf(arr: Val, _k: Val, value: Val, from: Val): number {
    for (let i = relative(from, arr.__n, 0) + 1; i <= arr.__n; i++) if (arr[i] === value) return i - 1
    return -1
  },
  lastIndexOf(arr: Val, _k: Val, value: Val): number {
    for (let i = arr.__n; i >= 1; i--) if (arr[i] === value) return i - 1
    return -1
  },
  includes(arr: Val, _k: Val, value: Val): boolean {
    for (let i = 1; i <= arr.__n; i++) if (sameValueZero(arr[i], value)) return true
    return false
  },
  fill(arr: Val, _k: Val, value: Val, start: Val, finish: Val): Val {
    const n = arr.__n
    for (let i = relative(start, n, 0) + 1; i <= relative(finish, n, n); i++) arr[i] = value
    return arr
  },
  at(arr: Val, _k: Val, index: Val): Val {
    let i = math.floor(index ?? 0)
    if (i < 0) i += arr.__n
    return arr[i + 1]
  },
  flat(arr: Val, _k: Val, depth: Val): Val {
    const result = newArray()
    const flatten = (items: Val, level: number): void => {
      for (let i = 1; i <= items.__n; i++) {
        const item = items[i]
        if (level > 0 && isArray(item)) flatten(item, level - 1)
        else append(result, item)
      }
    }
    flatten(arr, depth === undefined ? 1 : depth)
    return result
  },
  sort(arr: Val, _k: Val, compare: Val): Val {
    if (compare === undefined) {
      mergeSort(arr, arr.__n, defaultCompare)
    } else {
      const fn = callback(compare, "sort")
      const prog = program()
      mergeSort(arr, arr.__n, (a, b) => {
        const r = prog.calls(fn, undefined, a, b)
        return type(r) === "number" && r < 0
      })
    }
    return arr
  },
  // Синхронные версии методов высшего порядка.
  forEach(arr: Val, _k: Val, fn: Val): void {
    const prog = program()
    callback(fn, "forEach")
    for (let i = 1; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      prog.calls(fn, undefined, arr[i], i - 1, arr)
    }
  },
  map(arr: Val, _k: Val, fn: Val): Val {
    const prog = program()
    callback(fn, "map")
    const result = newArray()
    for (let i = 1; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      append(result, prog.calls(fn, undefined, arr[i], i - 1, arr))
    }
    return result
  },
  filter(arr: Val, _k: Val, fn: Val): Val {
    const prog = program()
    callback(fn, "filter")
    const result = newArray()
    for (let i = 1; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      const item = arr[i]
      if (truthy(prog.calls(fn, undefined, item, i - 1, arr))) append(result, item)
    }
    return result
  },
  find(arr: Val, _k: Val, fn: Val): Val {
    const prog = program()
    callback(fn, "find")
    for (let i = 1; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      if (truthy(prog.calls(fn, undefined, arr[i], i - 1, arr))) return arr[i]
    }
    return undefined
  },
  findIndex(arr: Val, _k: Val, fn: Val): number {
    const prog = program()
    callback(fn, "findIndex")
    for (let i = 1; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      if (truthy(prog.calls(fn, undefined, arr[i], i - 1, arr))) return i - 1
    }
    return -1
  },
  findLast(arr: Val, _k: Val, fn: Val): Val {
    const prog = program()
    callback(fn, "findLast")
    for (let i = arr.__n; i >= 1; i--) {
      Q.n = Q.n - 1
      if (truthy(prog.calls(fn, undefined, arr[i], i - 1, arr))) return arr[i]
    }
    return undefined
  },
  findLastIndex(arr: Val, _k: Val, fn: Val): number {
    const prog = program()
    callback(fn, "findLastIndex")
    for (let i = arr.__n; i >= 1; i--) {
      Q.n = Q.n - 1
      if (truthy(prog.calls(fn, undefined, arr[i], i - 1, arr))) return i - 1
    }
    return -1
  },
  some(arr: Val, _k: Val, fn: Val): boolean {
    const prog = program()
    callback(fn, "some")
    for (let i = 1; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      if (truthy(prog.calls(fn, undefined, arr[i], i - 1, arr))) return true
    }
    return false
  },
  every(arr: Val, _k: Val, fn: Val): boolean {
    const prog = program()
    callback(fn, "every")
    for (let i = 1; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      if (!truthy(prog.calls(fn, undefined, arr[i], i - 1, arr))) return false
    }
    return true
  },
  reduce(arr: Val, _k: Val, fn: Val, ...initial: Val[]): Val {
    const prog = program()
    callback(fn, "reduce")
    let i = 1
    let acc: Val
    if (select("#", ...initial) > 0) {
      ;[acc] = select(1, ...initial)
    } else {
      if (arr.__n === 0) err("bad-argument", "reduce of empty array with no initial value")
      acc = arr[1]
      i = 2
    }
    for (; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      acc = prog.calls(fn, undefined, acc, arr[i], i - 1, arr)
    }
    return acc
  },
  reduceRight(arr: Val, _k: Val, fn: Val, ...initial: Val[]): Val {
    const prog = program()
    callback(fn, "reduceRight")
    let i = arr.__n
    let acc: Val
    if (select("#", ...initial) > 0) {
      ;[acc] = select(1, ...initial)
    } else {
      if (arr.__n === 0) err("bad-argument", "reduce of empty array with no initial value")
      acc = arr[i]
      i--
    }
    for (; i >= 1; i--) {
      Q.n = Q.n - 1
      acc = prog.calls(fn, undefined, acc, arr[i], i - 1, arr)
    }
    return acc
  },
  flatMap(arr: Val, _k: Val, fn: Val): Val {
    const prog = program()
    callback(fn, "flatMap")
    const result = newArray()
    for (let i = 1; i <= arr.__n; i++) {
      Q.n = Q.n - 1
      const r = prog.calls(fn, undefined, arr[i], i - 1, arr)
      if (isArray(r)) for (let j = 1; j <= r.__n; j++) append(result, r[j])
      else append(result, r)
    }
    return result
  },
}

// ---------- Возобновляемые версии ----------

/**
 * Обход с возобновляемым колбэком. visit(состояние, результат колбэка, индекс Lua) → true — стоп.
 * Кадр: {[2] = кадр колбэка, i = следующий индекс, s = состояние}.
 */
function walk(
  arr: Val,
  k: Val,
  fn: Val,
  name: string,
  start: (this: void) => Val,
  visit: (this: void, s: Val, r: Val, i: number) => boolean,
  finish: (this: void, s: Val) => Val,
): LuaMultiReturn<[Val, Val?]> {
  const prog = program()
  let i: number
  let s: Val
  let child: Val
  if (k !== undefined) {
    i = k.i
    s = k.s
    child = k[2]
  } else {
    callback(fn, name)
    i = 1
    s = start()
  }
  while (i <= arr.__n) {
    const [r, f] = prog.call(fn, child, undefined, arr[i], i - 1, arr)
    child = undefined
    if (r === Y) return $multi(Y, { [2]: f, i, s })
    i++
    if (visit(s, r, i - 1)) break
    Q.n = Q.n - 1
    if (Q.n <= 0 && i <= arr.__n) return $multi(Y, { i, s })
  }
  return $multi(finish(s))
}

const nothing = (): Val => undefined

export const arrayMethodsResumable: Record<string, Fn> = {
  forEach(arr: Val, k: Val, fn: Val) {
    return walk(arr, k, fn, "forEach", nothing, () => false, nothing)
  },
  map(arr: Val, k: Val, fn: Val) {
    return walk(
      arr,
      k,
      fn,
      "map",
      () => newArray(),
      (s, r, i) => {
        s[i] = r
        s.__n = i
        charge(0.125)
        return false
      },
      (s) => s,
    )
  },
  filter(arr: Val, k: Val, fn: Val) {
    return walk(
      arr,
      k,
      fn,
      "filter",
      () => ({ a: arr, r: newArray() }),
      (s, r, i) => {
        if (truthy(r)) append(s.r, s.a[i])
        return false
      },
      (s) => s.r,
    )
  },
  find(arr: Val, k: Val, fn: Val) {
    return walk(
      arr,
      k,
      fn,
      "find",
      () => ({ a: arr }),
      (s, r, i) => {
        if (!truthy(r)) return false
        s.v = s.a[i]
        return true
      },
      (s) => s.v,
    )
  },
  findIndex(arr: Val, k: Val, fn: Val) {
    return walk(
      arr,
      k,
      fn,
      "findIndex",
      () => ({ v: -1 }),
      (s, r, i) => {
        if (!truthy(r)) return false
        s.v = i - 1
        return true
      },
      (s) => s.v,
    )
  },
  some(arr: Val, k: Val, fn: Val) {
    return walk(
      arr,
      k,
      fn,
      "some",
      () => ({ v: false }),
      (s, r) => {
        if (!truthy(r)) return false
        s.v = true
        return true
      },
      (s) => s.v,
    )
  },
  every(arr: Val, k: Val, fn: Val) {
    return walk(
      arr,
      k,
      fn,
      "every",
      () => ({ v: true }),
      (s, r) => {
        if (truthy(r)) return false
        s.v = false
        return true
      },
      (s) => s.v,
    )
  },
  flatMap(arr: Val, k: Val, fn: Val) {
    return walk(
      arr,
      k,
      fn,
      "flatMap",
      () => newArray(),
      (s, r) => {
        if (isArray(r)) for (let j = 1; j <= r.__n; j++) append(s, r[j])
        else append(s, r)
        return false
      },
      (s) => s,
    )
  },
  reduce(arr: Val, k: Val, fn: Val, ...initial: Val[]): LuaMultiReturn<[Val, Val?]> {
    const prog = program()
    let i: number
    let acc: Val
    let child: Val
    if (k !== undefined) {
      i = k.i
      acc = k.acc
      child = k[2]
    } else {
      callback(fn, "reduce")
      i = 1
      if (select("#", ...initial) > 0) {
        ;[acc] = select(1, ...initial)
      } else {
        if (arr.__n === 0) err("bad-argument", "reduce of empty array with no initial value")
        acc = arr[1]
        i = 2
      }
    }
    while (i <= arr.__n) {
      const [r, f] = prog.call(fn, child, undefined, acc, arr[i], i - 1, arr)
      child = undefined
      if (r === Y) return $multi(Y, { [2]: f, i, acc })
      acc = r
      i++
      Q.n = Q.n - 1
      if (Q.n <= 0 && i <= arr.__n) return $multi(Y, { i, acc })
    }
    return $multi(acc)
  },
}
