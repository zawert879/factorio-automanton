// Отладка (18.8): точки остановки на строках, шаг до следующей строки, переменные верхнего уровня в кадре.
import { compile, CompileResult, ProgramVariable } from "../../src/lang/codegen"
import { LINE_BASE } from "../../src/lang/modules"
import { loadProgram, Machine, newMachine, pausedLine, Program, runSlice, SliceDebug } from "../../src/lang/runtime"
import { Val } from "../../src/lang/runtime/core"
import { describe, expect, test } from "../../src/test/testing"

function build(source: string, name = "main", modules: Record<string, string> = {}): { compiled: CompileResult; program: Program } {
  const compiled = compile(source, { name, types: false, resolve: (m) => (modules[m] === undefined ? undefined : { name: m, source: modules[m] }) })
  if (!compiled.ok) error(compiled.diagnostics.map((d) => `${d.line}:${d.column} ${d.code} ${d.params.join(",")}`).join("; "))
  const program = loadProgram(compiled.lua, compiled.lines, compiled.keys, compiled.pauses)
  if (typeof program === "string") error(program)
  return { compiled, program }
}

/** Значение переменной верхнего уровня из кадра главной функции. */
function value(compiled: CompileResult, machine: Machine, name: string): Val {
  const v = compiled.variables!.find((x: ProgramVariable) => x.name === name)!
  const slot = (machine.frame as Val)[v.slot]
  return v.cell ? slot[1] : slot
}

/** Отрезки с большим квантом, пока не сработает точка (или программа не кончится). */
function untilBreak(program: Program, machine: Machine, debug: SliceDebug): number | undefined {
  for (let i = 0; i < 50 && machine.status === "ready"; i++) {
    const hit = runSlice(program, machine, 1000, debug)
    if (hit !== undefined) return hit
  }
  return undefined
}

const SEQUENCE = `let a = 1
a = a + 1
a = a * 10
const b = a + 5
`

describe("отладка", () => {
  test("точка остановки: пауза перед строкой, продолжение с неё же — без повторной остановки", () => {
    const { compiled, program } = build(SEQUENCE)
    expect(compiled.breakable).toEqual([1, 2, 3, 4])
    const machine = newMachine()
    expect(untilBreak(program, machine, { breakpoints: { 3: true } })).toBe(3)
    expect(pausedLine(program, machine)).toBe(3)
    expect(value(compiled, machine, "a")).toBe(2)
    // Продолжение с той же точкой: строка 3 уже пройдена — до конца программы.
    expect(untilBreak(program, machine, { breakpoints: { 3: true } })).toBe(undefined)
    expect(machine.status).toBe("done")
  })

  test("шаг — до следующей строки", () => {
    const { compiled, program } = build(SEQUENCE)
    const machine = newMachine()
    expect(untilBreak(program, machine, { breakpoints: { 2: true } })).toBe(2)
    expect(value(compiled, machine, "a")).toBe(1)
    expect(untilBreak(program, machine, { step: true })).toBe(3)
    expect(value(compiled, machine, "a")).toBe(2)
    expect(untilBreak(program, machine, { step: true })).toBe(4)
    expect(value(compiled, machine, "a")).toBe(20)
    expect(untilBreak(program, machine, {})).toBe(undefined)
    expect(machine.status).toBe("done")
  })

  test("цикл: точка срабатывает на каждом витке; квант сам по себе её не вызывает", () => {
    const { compiled, program } = build(`let total = 0
for (let i = 1; i <= 3; i++) {
  total += i
}
`)
    const machine = newMachine()
    const seen: Val[] = []
    while (machine.status === "ready") {
      const hit = runSlice(program, machine, 2, { breakpoints: { 3: true } })
      if (hit !== undefined) seen.push(value(compiled, machine, "total"))
    }
    expect(seen).toEqual([0, 1, 3])
    expect(machine.status).toBe("done")
  })

  test("без отладки программа идёт как раньше; короткие функции — без проверок", () => {
    const { compiled, program } = build(`function twice(x: number): number {
  return x * 2
}
let n = 0
while (n < 100) {
  n = n + twice(1)
}
`)
    // Строка 2 — в короткой функции (не приостанавливается): точки там нет.
    expect(compiled.breakable!.includes(2)).toBe(false)
    expect(compiled.breakable!.includes(6)).toBe(true)
    const machine = newMachine()
    while (machine.status === "ready") runSlice(program, machine, 7)
    expect(machine.status).toBe("done")
  })

  test("захваченная и изменяемая переменная — в ячейке; модули — свои номера строк и переменных", () => {
    const { compiled, program } = build(
      `import { bump } from "./lib"
let calls = 0
const inc = () => { calls = calls + 1 }
inc()
bump()
`,
      "main",
      { lib: "export let hits = 0\nexport function bump(): void {\n  for (let i = 0; i < 2; i++) hits = hits + 1\n}\n" },
    )
    const lib = compiled.modules!.indexOf("lib")
    expect(lib > 0).toBe(true)
    expect(compiled.variables!.some((v) => v.name === "hits" && v.module === lib)).toBe(true)
    expect(compiled.variables!.find((v) => v.name === "calls")!.cell).toBe(true)
    const machine = newMachine()
    expect(untilBreak(program, machine, { breakpoints: { [lib * LINE_BASE + 3]: true } })).toBe(lib * LINE_BASE + 3)
    expect(value(compiled, machine, "calls")).toBe(1)
    expect(untilBreak(program, machine, {})).toBe(undefined)
    expect(machine.status).toBe("done")
  })
})
