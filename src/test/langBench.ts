// 3.11: бенчмарк сгенерированного кода против обычного Lua. Одни и те же нагрузки меряются вне игры
// (tools/bench/lang.lua, os.clock) и в Lua самой Factorio (служебный мод automaton-bench, профайлер).
import { compile } from "../lang/codegen"
import { loadProgram, newMachine, Program, runSlice } from "../lang/runtime"
import { host, Val } from "../lang/runtime/core"
import { toStringValue } from "../lang/runtime/values"

interface Workload {
  name: string
  source: string
  /** Тот же алгоритм на обычном Lua: чанк возвращает функцию, функция — результат. */
  native: string
}

const ITEMS = `const items: { count: number }[] = []
for (let i = 1; i <= 100; i++) items.push({ count: (i * 37) % 100 })
`

const NATIVE_ITEMS = `local items = {}
for i = 1, 100 do items[i] = { count = (i * 37) % 100 } end
`

export const WORKLOADS: Workload[] = [
  {
    name: "циклы: сумма полей массива объектов",
    source:
      ITEMS +
      `let s = 0
for (let rep = 0; rep < 1000; rep++) {
  let total = 0
  for (let i = 0; i < items.length; i++) {
    const c = items[i].count
    if (c < 50) total = total + c * 2
  }
  s = s + total
}
print(s)`,
    native:
      `return function()\n` +
      NATIVE_ITEMS +
      `local s = 0
for rep = 1, 1000 do
  local total = 0
  for i = 1, #items do
    local c = items[i].count
    if c < 50 then total = total + c * 2 end
  end
  s = s + total
end
return s
end`,
  },
  {
    name: "короткие функции: расстояния между точками",
    source: `function dist(a: any, b: any) { const dx = a.x - b.x; const dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy) }
const pts: any[] = []
for (let i = 0; i < 100; i++) pts.push({ x: i % 10, y: (i * 7) % 13 })
let total = 0
for (let rep = 0; rep < 300; rep++) {
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i])
}
print(Math.floor(total))`,
    native: `return function()
local function dist(a, b) local dx = a.x - b.x local dy = a.y - b.y return math.sqrt(dx * dx + dy * dy) end
local pts = {}
for i = 0, 99 do pts[#pts + 1] = { x = i % 10, y = (i * 7) % 13 } end
local total = 0
for rep = 1, 300 do for i = 2, #pts do total = total + dist(pts[i - 1], pts[i]) end end
return math.floor(total)
end`,
  },
  {
    name: "методы класса",
    source: `class Counter { n = 0; add(x: number) { this.n += x; return this } }
const c = new Counter()
for (let i = 0; i < 100000; i++) c.add(i % 7)
print(c.n)`,
    native: `return function()
local Counter = {}
Counter.__index = Counter
local c = setmetatable({ n = 0 }, Counter)
function Counter:add(x) self.n = self.n + x return self end
for i = 0, 99999 do c:add(i % 7) end
return c.n
end`,
  },
  {
    name: "лямбды: filter, map, reduce",
    source:
      ITEMS +
      `let total = 0
for (let rep = 0; rep < 300; rep++) {
  total += items.filter(it => it.count < 50).map(it => it.count * 2).reduce((a, b) => a + b, 0)
}
print(total)`,
    native:
      `return function()\n` +
      NATIVE_ITEMS +
      `local total = 0
for rep = 1, 300 do
  local f = {}
  for _, it in ipairs(items) do if it.count < 50 then f[#f + 1] = it end end
  local m = {}
  for i, it in ipairs(f) do m[i] = it.count * 2 end
  local s = 0
  for _, v in ipairs(m) do s = s + v end
  total = total + s
end
return total
end`,
  },
]

let printed: string | undefined

function compiled(source: string): Program {
  const result = compile(source)
  if (!result.ok) error(`бенчмарк не компилируется: ${result.diagnostics[0].code} ${result.diagnostics[0].params.join(",")} @${result.diagnostics[0].line}`)
  const program = loadProgram(result.lua, result.lines, result.keys)
  if (type(program) === "string") error(`бенчмарк не загружается: ${program}`)
  return program as Program
}

/** Исполнить программу до конца; результат — то, что она напечатала. */
function runToEnd(program: Program, quantum: number): string {
  const machine = newMachine()
  while (machine.status === "ready") runSlice(program, machine, quantum)
  if (machine.status === "error") error(`бенчмарк упал: ${machine.error!.message} @${machine.error!.line}`)
  return printed ?? ""
}

export interface Measure {
  (this: void, label: string, fn: (this: void) => Val): void
}

/** Прогнать все нагрузки: measure(название, функция) меряет и сообщает время. */
export function runLangBench(this: void, measure: Measure): void {
  const savedPrint = host.print
  host.print = (v: Val) => {
    printed = toStringValue(v)
  }
  for (const w of WORKLOADS) {
    const [chunk, message] = load(w.native, "=native", "t", { math, ipairs, setmetatable })
    if (chunk === undefined) error(`нативный вариант не загружается: ${message}`)
    const native = (chunk as (this: void) => (this: void) => Val)()
    const program = compiled(w.source)
    const expected = tostring(native())
    printed = undefined
    const got = runToEnd(program, 1e12)
    if (got !== expected) error(`${w.name}: результат ${got}, ожидалось ${expected}`)
    for (let attempt = 0; attempt < 3; attempt++) {
      measure(`${w.name} | Lua`, native)
      measure(`${w.name} | программа`, () => runToEnd(program, 1e12))
      measure(`${w.name} | программа, пауза каждые 50`, () => runToEnd(program, 50))
    }
  }
  host.print = savedPrint
}
