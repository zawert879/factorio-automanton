// Тесты парсера (вне игры, Lua 5.2). Деревья сравниваются в компактной скобочной записи.
import * as A from "../../src/lang/ast"
import { parse } from "../../src/lang/parser"
import { describe, expect, test } from "../../src/test/testing"
import { EXAMPLES } from "./examples.generated"

function pattern(p: A.Pattern): string {
  if (p.kind === "IdentifierPattern") return p.name
  if (p.kind === "ObjectPattern") {
    const parts = p.properties.map((prop) => `${prop.key}:${pattern(prop.value)}${prop.default ? "=" + show(prop.default) : ""}`)
    if (p.rest !== undefined) parts.push("..." + p.rest)
    return `{${parts.join(" ")}}`
  }
  const parts = p.elements.map((e) => (e.value === undefined ? "_" : pattern(e.value) + (e.default ? "=" + show(e.default) : "")))
  if (p.rest !== undefined) parts.push("..." + pattern(p.rest))
  return `[${parts.join(" ")}]`
}

function arg(a: A.Expr | A.Spread): string {
  return a.kind === "Spread" ? "..." + show(a.argument) : show(a)
}

function show(e: A.Expr): string {
  switch (e.kind) {
    case "Number":
      return tostring(e.value)
    case "String":
      return `"${e.value}"`
    case "Template":
      return `(tpl ${e.quasis.map((q) => `"${q}"`).join(" ")}${e.expressions.map((x) => " " + show(x)).join("")})`
    case "Boolean":
      return tostring(e.value)
    case "Null":
      return "null"
    case "Identifier":
      return e.name
    case "This":
      return "this"
    case "Super":
      return "super"
    case "Array":
      return `[${e.elements.map((a) => arg(a)).join(" ")}]`
    case "Object":
      return `{${e.members.map((m) => (m.kind === "Spread" ? "..." + show(m.argument) : `${m.key}:${show(m.value)}`)).join(" ")}}`
    case "Function": {
      const params = e.fn.params.map((p) => (p.rest ? "..." : "") + pattern(p.target) + (p.default ? "=" + show(p.default) : "")).join(" ")
      const body = Array.isArray(e.fn.body) ? `{${e.fn.body.length}}` : show(e.fn.body as A.Expr)
      return `(${e.fn.arrow ? "=>" : "fn"} (${params}) ${body})`
    }
    case "Class":
      return `(class ${e.cls.name ?? "_"})`
    case "Unary":
      return `(${e.operator} ${show(e.argument)})`
    case "Update":
      return e.prefix ? `(${e.operator} ${show(e.target)})` : `(${show(e.target)} ${e.operator})`
    case "Binary":
    case "Logical":
      return `(${e.operator} ${show(e.left)} ${show(e.right)})`
    case "Assign": {
      const target = "kind" in e.target && (e.target.kind === "IdentifierPattern" || e.target.kind === "ObjectPattern" || e.target.kind === "ArrayPattern")
        ? pattern(e.target as A.Pattern)
        : show(e.target as A.Expr)
      return `(${e.operator} ${target} ${show(e.value)})`
    }
    case "Conditional":
      return `(? ${show(e.test)} ${show(e.consequent)} ${show(e.alternate)})`
    case "Call":
      return `(call${e.optional ? "?" : ""} ${show(e.callee)}${e.args.map((a) => " " + arg(a)).join("")})`
    case "New":
      return `(new ${show(e.callee)}${e.args.map((a) => " " + arg(a)).join("")})`
    case "Member":
      return `(. ${show(e.object)} ${e.property}${e.optional ? "?" : ""})`
    case "Index":
      return `([] ${show(e.object)} ${show(e.index)})`
    case "Sequence":
      return `(, ${e.expressions.map((x) => show(x)).join(" ")})`
  }
}

/** Разобрать одно выражение-инструкцию и показать его. */
function expr(source: string): string {
  const { program, diagnostics } = parse(source)
  if (diagnostics.length > 0) return `ошибка ${diagnostics[0].code}`
  const stmt = program.body[0]
  return stmt.kind === "ExprStmt" ? show(stmt.expression) : `не выражение: ${stmt.kind}`
}

function codes(source: string): string[] {
  return parse(source).diagnostics.map((d) => d.code)
}

describe("парсер: выражения", () => {
  test("приоритеты и ассоциативность", () => {
    expect(expr("a + b * c - d")).toBe("(- (+ a (* b c)) d)")
    expect(expr("2 ** 3 ** 2")).toBe("(** 2 (** 3 2))")
    expect(expr("a || b && c ?? d")).toBe("(?? (|| a (&& b c)) d)")
    expect(expr("!a === b")).toBe("(=== (! a) b)")
    expect(expr("a < b === c >= d")).toBe("(=== (< a b) (>= c d))")
    expect(expr("x = y = 1")).toBe("(= x (= y 1))")
    expect(expr("a ? b : c ? d : e")).toBe("(? a b (? c d e))")
  })

  test("обращения, вызовы, необязательные цепочки, new", () => {
    expect(expr("a.b[c](d, ...e)")).toBe("(call ([] (. a b) c) d ...e)")
    expect(expr("a?.b?.(c)")).toBe("(call? (. a b?) c)")
    expect(expr("new Map<string, number>()")).toBe("(new Map)")
    expect(expr("me.args<{ ore: Item }>()")).toBe("(call (. me args))")
    expect(expr("x++ + --y")).toBe("(+ (x ++) (-- y))")
    expect(expr("obj.default + obj.new")).toBe("(+ (. obj default) (. obj new))")
  })

  test("f<T>(x) — вызов (как в TypeScript, даже a < b > (c)), остальное — сравнения", () => {
    expect(expr("receive<number>(1)")).toBe("(call receive 1)")
    expect(expr("a < b > (c)")).toBe("(call a c)")
    expect(expr("a < b || c > d")).toBe("(|| (< a b) (> c d))")
  })

  test("стрелочные функции", () => {
    expect(expr("x => x * 2")).toBe("(=> (x) (* x 2))")
    expect(expr("(a, b = 1, ...rest) => a")).toBe("(=> (a b=1 ...rest) a)")
    expect(expr("(f: Entity): boolean => f.valid")).toBe("(=> (f) (. f valid))")
    expect(expr("({ a, b }) => { return a }")).toBe("(=> ({a:a b:b}) {1})")
    expect(expr("(a + b) * c")).toBe("(* (+ a b) c)")
  })

  test("литералы: массивы, объекты, шаблоны, as и !", () => {
    expect(expr("[1, ...xs, 'a']")).toBe('[1 ...xs "a"]')
    expect(expr("({ a: 1, b, ...c, m(x) { return x } })")).toBe("{a:1 b:b ...c m:(fn (x) {1})}")
    expect(expr("`a${x}b${y + 1}c`")).toBe('(tpl "a" "b" "c" x (+ y 1))')
    expect(expr("(x as number) + y!")).toBe("(+ x y)")
    expect(expr("e instanceof ActionError ? e.code : '?'")).toBe('(? (instanceof e ActionError) (. e code) "?")')
  })

  test("деструктурирующее присваивание", () => {
    expect(expr("[a, b] = [b, a]")).toBe("(= [a b] [b a])")
    expect(expr("({ x, y: z = 2 } = p)")).toBe("(= {x:x y:z=2} p)")
  })
})

describe("парсер: инструкции", () => {
  test("объявления и деструктуризация", () => {
    const { program, diagnostics } = parse("const { ore, field } = me.args<{ ore: Item; field: string }>()\nlet [dx, dy]: number[] = dirs[0]")
    expect(diagnostics.length).toBe(0)
    const first = program.body[0] as A.VarDecl
    expect(first.declKind).toBe("const")
    expect(pattern(first.declarations[0].target)).toBe("{ore:ore field:field}")
    expect(pattern((program.body[1] as A.VarDecl).declarations[0].target)).toBe("[dx dy]")
  })

  test("точки с запятой необязательны", () => {
    const { program, diagnostics } = parse("let a = 1\nlet b = a\nmove(b)\nreturn")
    expect(diagnostics.length).toBe(0)
    expect(program.body.length).toBe(4)
  })

  test("циклы, метки, switch, try", () => {
    const source = `
      outer: for (let i = 0; i < 10; i++) {
        for (const x of xs) { if (x) continue outer; else break }
      }
      while (true) {}
      do { n-- } while (n > 0)
      switch (k) { case 1: case 2: a(); break; default: b() }
      try { move(p) } catch (e) { say(e) } finally { done() }
      try { x() } catch { }
    `
    const { program, diagnostics } = parse(source)
    expect(diagnostics.length).toBe(0)
    expect(program.body.map((s) => s.kind)).toEqual(["Labeled", "While", "DoWhile", "Switch", "Try", "Try"])
    const sw = program.body[3] as Extract<A.Stmt, { kind: "Switch" }>
    expect(sw.cases.length).toBe(3)
    expect(sw.cases[0].body.length).toBe(0)
  })

  test("return без значения перед переводом строки", () => {
    const { program } = parse("function f() {\n  return\n  1\n}")
    const fn = (program.body[0] as Extract<A.Stmt, { kind: "FunctionDecl" }>).fn
    expect((fn.body as A.Stmt[])[0].kind).toBe("Return")
    expect(((fn.body as A.Stmt[])[0] as Extract<A.Stmt, { kind: "Return" }>).value).toBe(undefined)
  })
})

describe("парсер: функции, классы, типы", () => {
  test("класс: поля, параметры-свойства, методы, геттер, static, extends, abstract", () => {
    const source = `
      abstract class Job {
        static count = 0
        private readonly id: number = 1
        constructor(readonly name: string, public weight?: number) { Job.count++ }
        abstract ready(): boolean
        get title(): string { return this.name }
        describe(): string { return \`Job(\${this.name})\` }
      }
      class Smelting extends Job implements Runnable {
        constructor(readonly ore: Item) { super("smelting") }
        ready() { return true }
      }
    `
    const { program, diagnostics } = parse(source)
    expect(diagnostics.length).toBe(0)
    const job = (program.body[0] as Extract<A.Stmt, { kind: "ClassDecl" }>).cls
    expect(job.isAbstract).toBe(true)
    expect(job.members.map((m) => m.kind)).toEqual(["Field", "Field", "Constructor", "AbstractMethod", "Method", "Method"])
    const ctor = job.members[2] as Extract<A.ClassMember, { kind: "Constructor" }>
    expect(ctor.fn.params.map((p) => p.property)).toEqual([true, true])
    const getter = job.members[4] as Extract<A.ClassMember, { kind: "Method" }>
    expect(getter.accessor).toBe("get")
    const smelting = (program.body[1] as Extract<A.Stmt, { kind: "ClassDecl" }>).cls
    expect(smelting.superClass?.kind).toBe("Identifier")
  })

  test("типы: объединения, дженерики с >>, функции, объекты, кортежи, keyof", () => {
    const source = `
      type Value = null | boolean | number | string | Value[] | { [key: string]: Value }
      type Fn = (a: number, ...rest: string[]) => Map<string, Array<number>>
      interface Order extends Base { furnace: Entity; ore?: Item; run(t: number): void }
      let pair: [number, string] = [1, "a"]
      let k: keyof Order = "ore"
      let m: Map<string, Map<number, string[]>> = new Map()
      function id<T extends object = {}>(x: T): T { return x }
    `
    const { program, diagnostics } = parse(source)
    expect(diagnostics.length).toBe(0)
    expect(program.body.map((s) => s.kind)).toEqual(["TypeDecl", "TypeDecl", "TypeDecl", "VarDecl", "VarDecl", "VarDecl", "FunctionDecl"])
  })
})

describe("парсер: ошибки", () => {
  test("неподдерживаемое — понятный код", () => {
    expect(codes("var x = 1")).toEqual(["unsupported"])
    expect(parse("var x = 1").diagnostics[0].params[0]).toBe("var")
    expect(parse("async function f() {}").diagnostics[0].params[0]).toBe("async")
    expect(parse("for (const k in obj) {}").diagnostics[0].params[0]).toBe("for-in")
    expect(parse("const r = /ab+/").diagnostics[0].params[0]).toBe("regex")
    expect(parse("if (x) { import y from './y' }").diagnostics[0].params[0]).toBe("import-nested")
    expect(parse("enum E { A }").diagnostics[0].params[0]).toBe("enum")
  })

  test("== и != — ошибка loose-equality, разбор продолжается", () => {
    expect(codes("if (a == b) x()")).toEqual(["loose-equality"])
  })

  test("позиция ошибки и восстановление: две ошибки в двух инструкциях", () => {
    const { diagnostics, program } = parse("let a = (1 + \nlet b = 2\nmove(b))\nlet c = 3")
    expect(diagnostics.length >= 1).toBe(true)
    expect(diagnostics[0].code).toBe("expected-token")
    expect(diagnostics[0].line).toBe(2)
    expect(program.body.some((s) => s.kind === "VarDecl" && pattern(s.declarations[0].target) === "c")).toBe(true)
  })

  test("зарезервированные имена __", () => {
    expect(codes("const __cls = 1")).toEqual(["reserved-name"])
  })
})

describe("парсер: программы из документации", () => {
  for (const example of EXAMPLES) {
    test(`без ошибок: ${example.name}`, () => {
      const { diagnostics } = parse(example.source)
      const first = diagnostics[0]
      expect(first === undefined ? "ok" : `${first.code} ${first.params.join(",")} @${first.line}:${first.column}`).toBe("ok")
    })
  }
})
