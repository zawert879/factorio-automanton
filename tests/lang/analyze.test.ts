// Тесты анализа: области видимости, захват переменных, короткие и возобновляемые функции.
import { compile } from "../../src/lang/codegen"
import { analyze, Analysis, FnInfo, VarInfo } from "../../src/lang/analyze"
import { parse } from "../../src/lang/parser"
import { describe, expect, test } from "../../src/test/testing"

function run(source: string): Analysis {
  const parsed = parse(source)
  if (parsed.diagnostics.length > 0) error(`ошибка разбора: ${parsed.diagnostics[0].code}`)
  return analyze(parsed.program)
}

function fn(analysis: Analysis, name: string): FnInfo {
  const found = analysis.functions.find((f) => f.name === name)
  if (found === undefined) error(`нет функции ${name}`)
  return found
}

function variable(analysis: Analysis, name: string): VarInfo {
  for (const f of analysis.functions) {
    const found = f.vars.find((v) => v.name === name)
    if (found !== undefined) return found
  }
  error(`нет переменной ${name}`)
}

/** Имя функции-значения: стрелочные функции безымянны, ищем по переменной, которой присвоены. */
function lambdaOf(analysis: Analysis, index: number): FnInfo {
  return analysis.functions.filter((f) => f.kind === "arrow")[index]
}

describe("анализ: короткие и возобновляемые функции", () => {
  test("цикл, действие, рекурсия, вызов возобновляемой — возобновляемые", () => {
    const a = run(`
      function pure(x: number) { return x * 2 }
      function loop() { while (true) {} }
      function callsLoop() { return loop() }
      function act() { move({ x: 1, y: 2 }) }
      function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1) }
      function even(n: number): boolean { return n === 0 ? true : odd(n - 1) }
      function odd(n: number): boolean { return n === 0 ? false : even(n - 1) }
      function printer() { print("hi") }
    `)
    expect(fn(a, "pure").resumable).toBe(false)
    expect(fn(a, "loop").resumable).toBe(true)
    expect(fn(a, "callsLoop").resumable).toBe(true)
    expect(fn(a, "act").resumable).toBe(true)
    expect(fn(a, "fact").resumable).toBe(true)
    expect(fn(a, "even").resumable).toBe(true)
    expect(fn(a, "odd").resumable).toBe(true)
    expect(fn(a, "printer").resumable).toBe(false)
    expect(a.main.resumable).toBe(true)
  })

  test("методы: вызов по имени возобновляемого метода делает функцию возобновляемой", () => {
    const a = run(`
      class Job { run() { mine("iron-ore", 5) } ready() { return true } }
      const go = (j: Job) => j.run()
      const check = (j: Job) => j.ready()
    `)
    expect(fn(a, "Job.run").resumable).toBe(true)
    expect(fn(a, "Job.ready").resumable).toBe(false)
    expect(lambdaOf(a, 0).resumable).toBe(true)
    expect(lambdaOf(a, 1).resumable).toBe(false)
    expect(a.resumableMethodNames.has("run")).toBe(true)
  })

  test("методы высшего порядка: лямбда с действием делает вызывающую возобновляемой", () => {
    const a = run(`
      function feed(fs: Entity[]) { fs.forEach(f => put(f, "coal", 5)) }
      function double(xs: number[]) { return xs.map(x => x * 2) }
      function apply(xs: number[], g: (x: number) => number) { return xs.map(g) }
    `)
    expect(fn(a, "feed").resumable).toBe(true)
    expect(fn(a, "double").resumable).toBe(false)
    expect(fn(a, "apply").resumable).toBe(true)
  })

  test("вызов функции-значения — возобновляемая", () => {
    const a = run(`function call(g: () => void) { g() }`)
    expect(fn(a, "call").resumable).toBe(true)
  })

  test("свойство-функция объекта с циклом — его имя возобновляемое", () => {
    const a = run(`
      const jobs = { dig() { while (true) {} } }
      const f = () => jobs.dig()
    `)
    expect(a.resumableMethodNames.has("dig")).toBe(true)
    expect(lambdaOf(a, 0).resumable).toBe(true)
  })
})

describe("анализ: захват переменных", () => {
  test("неизменная и уже инициализированная — по значению, изменяемая — в ячейке", () => {
    const a = run(`
      const ore = "iron-ore"
      let count = 0
      const f = () => ore + count
      count = 5
    `)
    expect(variable(a, "ore").captured).toBe(true)
    expect(variable(a, "ore").cell).toBe(false)
    expect(variable(a, "count").cell).toBe(true)
    expect(lambdaOf(a, 0).captures.map((v) => v.name)).toEqual(["ore", "count"])
  })

  test("захват до инициализации — в ячейке", () => {
    const a = run(`
      const f = () => later
      const later = 1
      function hoisted() { return alsoLater }
      const alsoLater = 2
      const self = () => self
    `)
    expect(variable(a, "later").cell).toBe(true)
    expect(variable(a, "alsoLater").cell).toBe(true)
    expect(variable(a, "self").cell).toBe(true)
  })

  test("объявления функций видят друг друга по значению", () => {
    const a = run(`
      function a1() { return b1 }
      function b1() { return a1 }
      const g = () => a1()
    `)
    expect(variable(a, "a1").cell).toBe(false)
    expect(variable(a, "b1").cell).toBe(false)
  })

  test("переменная цикла for (let …): отметка loopVar, ячейка при захвате и изменении", () => {
    const a = run(`
      const fs: (() => number)[] = []
      for (let i = 0; i < 3; i++) fs.push(() => i)
    `)
    const i = variable(a, "i")
    expect(i.loopVar).toBe(true)
    expect(i.cell).toBe(true)
  })

  test("this в стрелочной функции внутри метода — захват this метода", () => {
    const a = run(`
      class C { n = 1; get() { return [1].map(x => x + this.n) } }
    `)
    const lambda = lambdaOf(a, 0)
    expect(lambda.captures.length).toBe(1)
    expect(lambda.captures[0].kind).toBe("this")
    expect(lambda.captures[0].cell).toBe(false)
  })

  test("методы класса разделяют окружение псевдофункции класса", () => {
    const a = run(`
      const k = 2
      class C { a() { return k } b() { return k * 2 } }
    `)
    expect(fn(a, "C.a").envOwner.kind).toBe("class")
    expect(fn(a, "C").captures.map((v) => v.name)).toEqual(["k"])
  })
})

describe("анализ: ошибки", () => {
  test("неизвестное имя, присваивание константе и встроенному", () => {
    const codes = run(`
      const a = 1
      a = 2
      print = 3
      unknownThing()
    `).diagnostics.map((d) => `${d.code}:${d.params[0]}`)
    expect(codes).toEqual(["assign-to-const:a", "assign-to-builtin:print", "unknown-name:unknownThing"])
  })

  test("повторное объявление и this вне класса", () => {
    const codes = run(`
      let x = 1
      let x = 2
      const t = this
    `).diagnostics.map((d) => d.code)
    expect(codes).toEqual(["duplicate-declaration", "this-outside-class"])
  })

  test("let в блоке не виден снаружи", () => {
    const codes = run(`
      if (true) { let inner = 1 }
      print(inner)
    `).diagnostics.map((d) => d.code)
    expect(codes).toEqual(["unknown-name"])
  })
})

describe("связь: рассылки всем нет", () => {
  test("broadcast — ошибка с подсказкой publish + subscribe(id)", () => {
    const result = compile(`broadcast("новости", 1)`)
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe("broadcast-removed")
    expect(compile(`subscribe(7, "новости")\npublish("новости", 1)\nunsubscribe(7)`).ok).toBe(true)
  })
})
