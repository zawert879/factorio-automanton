// Рантайм программ: таблица R для пролога скомпилированного кода, загрузка программы, исполнение
// отрезками (квант инструкций), ожидание блокирующих вызовов API.
import { arrayMethods, arrayMethodsResumable } from "./arrays"
import { iter } from "./collections"
import {
  BRK,
  classes,
  enter,
  err,
  host,
  hostObjects,
  LIMITS,
  makeError,
  memory,
  ProgramExports,
  Q,
  RET,
  Val,
  Y,
} from "./core"
import { lib, objectSpread } from "./library"
import {
  addx,
  args,
  arrayRest,
  bitwise,
  callClass,
  callx,
  caught,
  construct,
  getx,
  has,
  hostFunction,
  idxx,
  instanceOf,
  lenx,
  libFunction,
  luaError,
  method,
  newBuiltin,
  newClass,
  objectRest,
  push1,
  setidxx,
  setKey,
  setx,
  spreadInto,
  superBuiltin,
  superGet,
  throwValue,
  unpack,
} from "./objects"
import { toNumber, toStringValue, typeOf } from "./values"

/** Всё, что видит пролог программы. Код программы видит только локальные переменные пролога. */
export const R: Val = {
  Y,
  RET,
  BRK,
  Q,
  err,
  next: next,
  math: math,
  arrayMethods,
  arrayMethodsResumable,
  type: type,
  getx,
  setx,
  idxx,
  setidxx,
  lenx,
  addx,
  sx: toStringValue,
  method,
  callx,
  limits: LIMITS,
  pcall: pcall,
  error: error,
  fmod: math.fmod,
  unpack,
  caught,
  host,
  hostObjects,
  lib,
  memory,
  newBuiltin,
  superBuiltin,
  hostFunction,
  libFunction,
  classes,
  toNumber,
  typeof: typeOf,
  instanceOf,
  has,
  spreadInto,
  push1,
  objectSpread,
  setKey,
  superGet,
  callClass,
  construct,
  objectRest,
  arrayRest,
  newClass,
  iter,
  throw: throwValue,
  args,
  band: bitwise.band,
  bor: bitwise.bor,
  bxor: bitwise.bxor,
  bnot: bitwise.bnot,
  shl: bitwise.shl,
  shr: bitwise.shr,
  ushr: bitwise.ushr,
}

export interface Program extends ProgramExports {
  /** Строка Lua (с 1) − 1 → строка исходника. */
  lines: number[]
  /** Строка Lua → имя свойства, которое на ней читается. */
  keys: Record<number, string>
  /** Номер функции → строки исходника точек остановки. */
  pauses: Record<number, number[]>
}

/** Загрузка скомпилированной программы в песочницу: пустое окружение, только R. */
export function loadProgram(
  this: void,
  lua: string,
  lines: number[],
  keys: Record<number, string> = {},
  pauses: Record<number, number[]> = {},
): Program | string {
  const [chunk, message] = load(lua, "=prog", "t", {})
  if (chunk === undefined) return message ?? "load failed"
  const exports = (chunk as (this: void, r: Val) => Val)(R)
  exports.lines = lines
  exports.keys = keys
  exports.pauses = pauses
  return exports as Program
}

export interface RuntimeError {
  name: string
  message: string
  code?: string
  /** Строка исходника. */
  line?: number
  value: Val
}

export interface Machine {
  status: "ready" | "waiting" | "done" | "error"
  /** Кадр главной функции на паузе. */
  frame?: Val
  /** Кадр ожидания блокирующего вызова API (часть цепочки frame). */
  waiting?: Val
  result?: Val
  error?: RuntimeError
  /** Выделено единиц памяти с последнего замера. */
  allocated?: number
  /** Живая память на последнем замере. */
  live?: number
  /** Перерасход кванта (синхронные колбэки, тяжёлые методы): столько инструкций машина пропускает. */
  debt?: number
}

export function newMachine(this: void): Machine {
  return { status: "ready" }
}

function sourceLine(program: Program, luaLine: number | undefined): number | undefined {
  if (luaLine === undefined) return undefined
  const line = program.lines[luaLine - 1]
  return line === 0 ? undefined : line
}

/** Строка исходника, где возникла ошибка (вызывается в обработчике xpcall — стек ещё цел). */
function errorLine(program: Program, e: Val): number | undefined {
  if (type(e) === "table" && e.__line !== undefined) return e.__line
  if (type(e) === "string") {
    const [line] = string.match(e, "^prog:(%d+):")
    if (line !== undefined) return sourceLine(program, tonumber(line))
  }
  for (let level = 2; level < 60; level++) {
    const info = debug.getinfo(level, "Sl")
    if (info === undefined) break
    if (info.source === "=prog" && info.currentline !== undefined && info.currentline > 0) {
      const line = sourceLine(program, info.currentline)
      if (line !== undefined) return line
    }
  }
  return undefined
}

function describeError(e: Val, line: number | undefined): RuntimeError {
  let value = e
  if (type(e) === "string") value = luaError(e)
  else if (type(e) === "table" && e.__wrap) value = e.__thrown
  if (type(value) === "table" && value.__cls !== undefined) {
    return {
      name: value.name !== undefined ? toStringValue(value.name) : "Error",
      message: value.message !== undefined ? toStringValue(value.message) : "",
      code: value.code,
      line,
      value,
    }
  }
  return { name: "Error", message: toStringValue(value), line, value }
}

/**
 * Живая память программы: таблицы и длинные строки, достижимые из кадров машины.
 * Таблица — 1 единица, ключ — 1/8, 256 байт строки — 1. Обход прекращается, как только предел превышен вдвое.
 */
export function measure(this: void, root: Val, limit: number): number {
  const seen = new LuaTable<Val, boolean>()
  const stack: Val[] = [root]
  let units = 0
  while (stack.length > 0 && units <= limit * 2) {
    const t = stack.pop()
    if (seen.get(t)) continue
    seen.set(t, true)
    units += 1
    for (const [k, v] of pairs(t as LuaTable<Val, Val>)) {
      units += 0.125
      if (type(k) === "table" && !seen.get(k)) stack.push(k)
      const tv = type(v)
      if (tv === "table") {
        if (!seen.get(v)) stack.push(v)
      } else if (tv === "string" && (v as string).length > 64) {
        units += (v as string).length / 256
      }
    }
  }
  return units
}

/** Проверка памяти после отрезка: замер, когда выделено достаточно с прошлого раза. */
function checkMemory(machine: Machine, allocated: number): void {
  machine.allocated = (machine.allocated ?? 0) + allocated
  if (machine.allocated < math.max(2000, (machine.live ?? 0) / 2)) return
  const live = measure([machine.frame, machine.waiting], LIMITS.memory)
  machine.live = live
  machine.allocated = 0
  if (live > LIMITS.memory) {
    const value = makeError("RangeError", "Program uses too much memory", "memory")
    machine.status = "error"
    machine.error = { name: "RangeError", message: value.message, code: "memory", value }
    machine.frame = undefined
    machine.waiting = undefined
  }
}

/** Один отрезок исполнения: до паузы (квант, ожидание), конца программы или ошибки. */
export function runSlice(this: void, program: Program, machine: Machine, quantum: number): void {
  if (machine.status !== "ready") return
  enter(program)
  program.setBudget(quantum)
  Q.w = undefined
  // Счётчик выделений — свой у каждого отрезка: разность глобального счётчика округлялась бы
  // по-разному у игроков с разной историей сессии (рассинхронизация, найдена test:desync).
  Q.a = 0
  Q.am = LIMITS.allocations
  let line: number | undefined
  const main = program.P[1]
  const [ok, r, f] = xpcall(
    () => main(undefined, undefined, machine.frame),
    (e: Val) => {
      line = errorLine(program, e)
      return e
    },
  )
  if (!ok && type(r) === "table" && (r as Val).__control !== undefined) {
    // exit() — программа закончилась; restart() — начнётся заново со следующего отрезка.
    machine.frame = undefined
    machine.waiting = undefined
    machine.status = (r as Val).__control === "restart" ? "ready" : "done"
    return
  }
  if (!ok) {
    machine.status = "error"
    machine.error = describeError(r, line)
    machine.frame = undefined
    machine.waiting = undefined
    return
  }
  if (r === Y) {
    machine.frame = f
    if (Q.w !== undefined) {
      machine.waiting = Q.w
      machine.status = "waiting"
    }
    const left = program.budget()
    if (left < 0) machine.debt = -left
    checkMemory(machine, Q.a)
    return
  }
  machine.frame = undefined
  machine.status = "done"
  machine.result = r
}

/** Строка исходника, на которой стоит программа (самый глубокий кадр программы в цепочке). */
export function pausedLine(this: void, program: Program, machine: Machine): number | undefined {
  let frame = machine.frame
  let line: number | undefined
  while (type(frame) === "table") {
    const id = frame[3]
    if (type(id) === "number") {
      const at = program.pauses[id as number]?.[frame[1] as number]
      if (at !== undefined) line = at
    }
    frame = frame[2]
  }
  return line
}

/** Завершить ожидание блокирующего вызова: результат или ошибка (ActionError и т. п.). */
export function completeWait(this: void, machine: Machine, result: Val, error_?: Val): void {
  if (machine.status !== "waiting" || machine.waiting === undefined) return
  machine.waiting.result = result
  machine.waiting.error = error_
  machine.waiting = undefined
  machine.status = "ready"
}

void arrayMethods
void iter
void err
void classes
void hostObjects
void memory
