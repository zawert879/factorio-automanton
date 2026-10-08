// Модули (этап 17): import / export между программами команды — исполнение, типы, ошибки.
import { describe, expect, test } from "../../src/test/testing"
import { compile } from "../../src/lang/codegen"
import { formatLine, LINE_BASE, relativeModulePath, resolveModulePath, rewriteImportPaths } from "../../src/lang/modules"
import { outputOf, run } from "./harness"

function compileWith(source: string, modules: Record<string, string>, name = "main") {
  return compile(source, { name, resolve: (n) => (modules[n] === undefined ? undefined : { name: n, source: modules[n] }) })
}

/** Ошибки компиляции: «код@модуль:строка» (модуль — если не сама программа). */
function errors(source: string, modules: Record<string, string>, name = "main"): string {
  const result = compileWith(source, modules, name)
  if (result.ok) return "ok"
  return result.diagnostics.map((d) => `${d.code}@${d.module !== undefined ? `${d.module}:` : ""}${d.line}`).join("; ")
}

const LIB = `export function double(x: number): number {
  return x * 2
}
export const K = 10
export default function greet(name: string): string {
  return "hi " + name
}`

describe("модули: пути", () => {
  test("относительно папки модуля", () => {
    expect(resolveModulePath("main", "./lib")).toEqual({ name: "lib" })
    expect(resolveModulePath("Логистика/Перевозчик", "../lib/Помощники")).toEqual({ name: "lib/Помощники" })
    expect(resolveModulePath("a/b/c", "./d/e")).toEqual({ name: "a/b/d/e" })
    expect(resolveModulePath("a/b", "./c.ts")).toEqual({ name: "a/c" })
  })
  test("путь от модуля к модулю — обратное к разрешению", () => {
    const cases: [string, string][] = [
      ["main", "lib"],
      ["Логистика/Перевозчик", "lib/Помощники"],
      ["a/b/c", "a/b/d/e"],
      ["a/b", "x"],
      ["x", "a/b/c"],
    ]
    for (const [from, to] of cases) expect(resolveModulePath(from, relativeModulePath(from, to))).toEqual({ name: to })
    expect(relativeModulePath("Логистика/Перевозчик", "lib/Помощники")).toBe("../lib/Помощники")
    expect(relativeModulePath("a/b", "a/c")).toBe("./c")
  })
  test("замена путей импорта в тексте", () => {
    const source = `// from "./old" в комментарии\nimport { a } from "./old"\nimport './old'\nexport * from "./other"\nconst s = "./old"`
    const rewritten = rewriteImportPaths(source, (spec) => (spec === "./old" ? "../lib/Новое" : undefined))
    expect(rewritten).toBe(`// from "./old" в комментарии\nimport { a } from "../lib/Новое"\nimport '../lib/Новое'\nexport * from "./other"\nconst s = "./old"`)
  })
  test("неотносительный путь и выход за корень — ошибка", () => {
    expect(resolveModulePath("main", "lib")).toEqual({ error: "import-not-relative" })
    expect(resolveModulePath("main", "../lib")).toEqual({ error: "import-outside" })
  })
})

describe("модули: исполнение", () => {
  test("именованный импорт, псевдоним и default", () => {
    const source = `import greet, { double, K as ten } from "./lib"\nprint(double(21), ten, greet("bot"))`
    expect(outputOf(source, { modules: { lib: LIB } })).toBe("42 10 hi bot")
  })
  test("export default выражения", () => {
    expect(outputOf(`import five from "./five"\nprint(five + 1)`, { modules: { five: `export default 2 + 3` } })).toBe("6")
  })
  test("import * as", () => {
    expect(outputOf(`import * as L from "./lib"\nprint(L.double(2), L.K, L.default("x"))`, { modules: { lib: LIB } })).toBe("4 10 hi x")
  })
  test("живая привязка: библиотека меняет свою переменную", () => {
    const lib = `export let count = 0\nexport function inc(): void {\n  count++\n}`
    expect(outputOf(`import { count, inc } from "./counter"\ninc()\ninc()\nprint(count)`, { modules: { counter: lib } })).toBe("2")
  })
  test("модуль исполняется один раз, зависимости — раньше", () => {
    const modules = {
      a: `print("a")\nexport const A = 1`,
      b: `import { A } from "./a"\nprint("b", A)\nexport const B = A + 1`,
    }
    expect(outputOf(`import { B } from "./b"\nimport { A } from "./a"\nprint("main", A, B)`, { modules })).toBe("a|b 1|main 1 2")
  })
  test("папки: путь от папки программы", () => {
    const modules = { "lib/Помощники": `export function hello(): string {\n  return "привет"\n}` }
    expect(outputOf(`import { hello } from "../lib/Помощники"\nprint(hello())`, { modules, name: "Логистика/Перевозчик" })).toBe("привет")
  })
  test("классы: new, наследование по имени и через пространство имён", () => {
    const lib = `export class Base {\n  n = 0\n  add(): number {\n    this.n++\n    return this.n\n  }\n}`
    const source = `import { Base } from "./shapes"
import * as S from "./shapes"
class Twice extends S.Base {
  add(): number {
    super.add()
    return super.add()
  }
}
const b = new Base()
b.add()
const t = new Twice()
print(b.add(), t.add(), t instanceof Base)`
    expect(outputOf(source, { modules: { shapes: lib } })).toBe("2 2 true")
  })
  test("действия внутри функции библиотеки (возобновляемая функция другого модуля)", () => {
    const lib = `export function slow(n: number): string {\n  wait(1)\n  move("x")\n  return "done " + n\n}`
    const source = `import { slow } from "./slow"\nimport * as L from "./slow"\nprint(slow(1))\nprint(L.slow(2))\nconst f = (x: number) => slow(x)\nprint([3].map(f).join(","))`
    expect(outputOf(source, { modules: { slow: lib } })).toBe("done 1|done 2|done 3")
  })
  test("замыкание в программе на переменную библиотеки", () => {
    const lib = `export const items: string[] = []\nexport function add(x: string): void {\n  items.push(x)\n}`
    const source = `import { items, add } from "./store"\nconst show = () => items.join("+")\nadd("a")\nadd("b")\nprint(show())`
    expect(outputOf(source, { modules: { store: lib } })).toBe("a+b")
  })
  test("реэкспорт: export { } from и export * from", () => {
    const modules = {
      lib: LIB,
      index: `export { double as twice } from "./lib"\nexport * from "./lib"`,
    }
    expect(outputOf(`import { twice, double, K } from "./index"\nprint(twice(2), double(3), K)`, { modules })).toBe("4 6 10")
  })
  test("реэкспорт импортированного имени", () => {
    const modules = { lib: LIB, mid: `import { K } from "./lib"\nexport { K }` }
    expect(outputOf(`import { K } from "./mid"\nprint(K)`, { modules })).toBe("10")
  })
  test("локальное имя перекрывает импорт", () => {
    expect(outputOf(`import { K } from "./lib"\nfunction f(K: number): number {\n  return K + 1\n}\nprint(f(1), K)`, { modules: { lib: LIB } })).toBe("2 10")
  })
  test("сохранение и загрузка посреди действия в библиотеке", () => {
    const lib = `export function loop(): number {\n  let sum = 0\n  for (let i = 1; i <= 3; i++) {\n    wait(0.1)\n    sum += i\n  }\n  return sum\n}`
    expect(outputOf(`import { loop } from "./loop"\nprint(loop())`, { modules: { loop: lib }, copy: true })).toBe("6")
  })
  test("ошибка выполнения в библиотеке — строка модуля", () => {
    const lib = `export function boom(): void {\n  throw new Error("x")\n}`
    const r = run(`import { boom } from "./boom"\nboom()`, { modules: { boom: lib } })
    expect(r.status).toBe("error")
    expect(r.line).toBe(LINE_BASE + 2)
    expect(formatLine(r.line!, ["main", "boom"])).toBe("boom:2")
    expect(formatLine(5, ["main", "boom"])).toBe("5")
  })
})

describe("модули: типы", () => {
  test("импортированный интерфейс и функция проверяются", () => {
    const lib = `export interface Route {\n  item: string\n  keep?: number\n}\nexport function keepOf(r: Route): number {\n  return r.keep ?? 0\n}`
    expect(errors(`import { Route, keepOf } from "./routes"\nconst r: Route = { item: "coal" }\nprint(keepOf(r), r.item)`, { routes: lib })).toBe("ok")
    expect(errors(`import { Route } from "./routes"\nconst r: Route = { item: "coal" }\nprint(r.foo)`, { routes: lib })).toBe("type-no-property@3")
    expect(errors(`import { keepOf } from "./routes"\nkeepOf(5)`, { routes: lib })).toBe("type-not-assignable@2")
    expect(errors(`import type { Route } from "./routes"\nconst r: Route = { item: 1 }`, { routes: lib })).toBe("type-not-assignable@2")
  })
  test("одинаковые имена типов в программе и модуле не путаются", () => {
    const lib = `export interface Item2 {\n  a: number\n}\nexport function make(): Item2 {\n  return { a: 1 }\n}`
    expect(errors(`import { make } from "./lib"\ninterface Item2 {\n  b: string\n}\nconst x: Item2 = { b: "s" }\nprint(make().a, x.b)`, { lib })).toBe("ok")
  })
  test("тип через пространство имён: функции и константы", () => {
    expect(errors(`import * as L from "./lib"\nconst n: number = L.double(2)\nprint(n)`, { lib: LIB })).toBe("ok")
    expect(errors(`import * as L from "./lib"\nL.double("2")`, { lib: LIB })).toBe("type-not-assignable@2")
  })
  test("класс модуля как тип", () => {
    const lib = `export class Box {\n  constructor(readonly size: number) {}\n}`
    expect(errors(`import { Box } from "./box"\nfunction f(b: Box): number {\n  return b.size\n}\nprint(f(new Box(2)))`, { box: lib })).toBe("ok")
    expect(errors(`import { Box } from "./box"\nconst b = new Box(2)\nprint(b.weight)`, { box: lib })).toBe("type-no-property@3")
  })
})

describe("модули: ошибки", () => {
  test("нет модуля, нет экспорта, неотносительный путь", () => {
    expect(errors(`import { x } from "./nope"`, {})).toBe("unknown-module@1")
    expect(errors(`\nimport { nope } from "./lib"`, { lib: LIB })).toBe("no-export@2")
    expect(errors(`import { x } from "lib"`, { lib: LIB })).toBe("import-not-relative@1")
    expect(errors(`import * as L from "./lib"\nprint(L.nope)`, { lib: LIB })).toBe("no-export@2")
  })
  test("циклический импорт", () => {
    const modules = { a: `import { B } from "./b"\nexport const A = 1`, b: `import { A } from "./a"\nexport const B = 2` }
    expect(errors(`import { A } from "./a"`, modules)).toBe("import-cycle@b:1")
  })
  test("ошибка в модуле — с именем модуля", () => {
    expect(errors(`import { f } from "./bad"`, { bad: `export function f() {\n  let = 1\n}` }).includes("@bad:2")).toBe(true)
  })
  test("импорт только для чтения", () => {
    expect(errors(`import { K } from "./lib"\nK = 2`, { lib: LIB })).toBe("assign-to-import@2")
    expect(errors(`import * as L from "./lib"\nL.K = 2`, { lib: LIB })).toBe("assign-to-import@2")
  })
  test("пространство имён — не значение", () => {
    expect(errors(`import * as L from "./lib"\nprint(L)`, { lib: LIB })).toBe("namespace-as-value@2")
  })
  test("повторное объявление и экспорт неизвестного", () => {
    expect(errors(`import { K } from "./lib"\nconst K = 1`, { lib: LIB })).toBe("duplicate-declaration@1")
    expect(errors(`export { nope }`, {})).toBe("unknown-export@1")
    expect(errors(`export const a = 1\nexport { a }`, {})).toBe("duplicate-export@2")
  })
  test("объявления верхнего уровня всех модулей — в одном пределе", () => {
    const lib = Array.from({ length: 200 }, (_, i) => `export const c${i} = ${i}`).join("\n")
    expect(errors(`import { c1 } from "./big"\nprint(c1)`, { big: lib })).toBe("too-many-top-level@1")
  })
  test("import и export только на верхнем уровне", () => {
    expect(errors(`if (true) {\n  import { K } from "./lib"\n}`, { lib: LIB })).toBe("unsupported@2")
  })
})

describe("модули: библиотека", () => {
  test("только объявления и есть экспорт — библиотека", () => {
    expect(compile(LIB).library).toBe(true)
    expect(compile(`export interface A {\n  x: number\n}\nconst cache = new Map<string, number>()\nexport function get(k: string): number {\n  return cache.get(k) ?? 0\n}`).library).toBe(true)
  })
  test("есть код или нет экспорта — программа", () => {
    expect(compile(`export const K = 1\nprint(K)`).library).toBe(false)
    expect(compile(`function f(): void {}`).library).toBe(false)
    expect(compileWith(`import { K } from "./lib"\nwhile (true) {\n  wait(K)\n}`, { lib: LIB }).library).toBe(false)
  })
  test("модули программы — в результате", () => {
    const result = compileWith(`import { K } from "./b"\nprint(K)`, { a: `export const A = 1`, b: `import { A } from "./a"\nexport const K = A` })
    expect(result.modules).toEqual(["main", "b", "a"])
  })
})
