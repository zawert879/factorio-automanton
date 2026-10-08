// Прогон программ вне игры: компиляция, загрузка в песочницу, исполнение отрезками с заглушками API.
// Каждый отрезок — «тик»; блокирующие вызовы-заглушки завершаются через заданное число тиков.
import { compile } from "../../src/lang/codegen"
import { completeWait, loadProgram, Machine, newMachine, runSlice } from "../../src/lang/runtime"
import { blockingCall, defineHostObject, host, hostBlocking, hostGetters, hostMethods, makeError, Val } from "../../src/lang/runtime/core"
import { toStringValue } from "../../src/lang/runtime/values"

let output: string[] = []

function printArgs(...args: Val[]): void {
  const parts: string[] = []
  const count = select("#", ...args)
  for (let i = 1; i <= count; i++) {
    const [v] = select(i, ...args)
    parts.push(toStringValue(v))
  }
  output.push(parts.join(" "))
}

host.print = printArgs
host.say = printArgs
host.wait = (k: Val, seconds: Val) => blockingCall(k, "wait", (f) => (f.ticks = math.ceil((seconds ?? 0) * 60)))
host.move = (k: Val, target: Val) =>
  blockingCall(k, "move", (f) => {
    f.ticks = 1
    if (target === "nowhere") f.fail = makeError("ActionError", "no path", "no-path")
  })
host.mine = (k: Val, item: Val, count: Val) =>
  blockingCall(k, "mine", (f) => {
    f.ticks = 2
    f.value = count ?? 1
  })
host.put = (k: Val) => blockingCall(k, "put", (f) => (f.ticks = 1))
for (const name of ["wait", "move", "mine", "put"]) hostBlocking[name] = true
defineHostObject("me")
hostGetters.me.name = () => "test-bot"
hostGetters.me.id = () => 7
hostMethods.me.say = (_o: Val, _k: Val, text: Val) => printArgs(text)
defineHostObject("console")
hostMethods.console.log = (_o: Val, _k: Val, ...args: Val[]) => printArgs(...args)

export interface RunOptions {
  /** Другие программы команды (полное имя → исходник) — для import. */
  modules?: Record<string, string>
  /** Полное имя самой программы (от него считаются пути импорта). */
  name?: string
  quantum?: number
  maxTicks?: number
  /** Копировать состояние машины на каждой паузе (как сохранение и загрузка игры). */
  copy?: boolean
}

export interface RunResult {
  output: string[]
  status: string
  error?: string
  line?: number
  ticks: number
  result?: Val
  lua?: string
}

/** Глубокая копия с сохранением общих ссылок (как сериализация storage). */
export function deepCopy(value: Val, seen: LuaTable<Val, Val> = new LuaTable()): Val {
  if (type(value) !== "table") return value
  const existing = seen.get(value)
  if (existing !== undefined) return existing
  const copy: Val = {}
  seen.set(value, copy)
  for (const [k, v] of pairs(value as LuaTable<Val, Val>)) copy[deepCopy(k, seen)] = deepCopy(v, seen)
  return copy
}

function copyMachine(machine: Machine): Machine {
  const seen = new LuaTable<Val, Val>()
  return deepCopy(machine, seen)
}

export function run(source: string, options: RunOptions = {}): RunResult {
  output = []
  const modules = options.modules ?? {}
  const compiled = compile(source, {
    name: options.name ?? "main",
    resolve: (name) => (modules[name] === undefined ? undefined : { name, source: modules[name] }),
  })
  if (!compiled.ok) {
    const error = compiled.diagnostics.map((d) => `${d.code}(${d.params.join(",")})@${d.line}`).join("; ")
    return { output, status: "compile-error", error, ticks: 0 }
  }
  const program = loadProgram(compiled.lua, compiled.lines, compiled.keys, compiled.pauses)
  if (type(program) === "string") return { output, status: "load-error", error: program as string, ticks: 0, lua: compiled.lua }
  const loaded = program as Exclude<typeof program, string>
  let machine = newMachine()
  let ticks = 0
  const maxTicks = options.maxTicks ?? 20000
  while (ticks < maxTicks) {
    ticks++
    if ((machine.debt ?? 0) > 0) {
      machine.debt = math.max(0, machine.debt! - (options.quantum ?? 1000))
    } else if (machine.status === "waiting") {
      const waiting = machine.waiting
      if ((waiting.ticks ?? 0) > 1) waiting.ticks--
      else completeWait(machine, waiting.value, waiting.fail)
    } else {
      runSlice(loaded, machine, options.quantum ?? 1000)
    }
    if (machine.status === "done" || machine.status === "error") break
    if (options.copy === true) machine = copyMachine(machine)
  }
  const e = machine.error
  return {
    output,
    status: machine.status,
    error: e !== undefined ? `${e.name}: ${e.message}` : undefined,
    line: e?.line,
    ticks,
    result: machine.result,
    lua: compiled.lua,
  }
}

/** Вывод программы одной строкой (через «|»), или текст ошибки. */
export function outputOf(source: string, options: RunOptions = {}): string {
  const r = run(source, options)
  if (r.status === "done") return r.output.join("|")
  return `${r.status}: ${r.error ?? ""}${r.line !== undefined ? ` @${r.line}` : ""} [${r.output.join("|")}]`
}
