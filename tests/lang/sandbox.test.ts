// 3.9: атаки на песочницу. Программа не должна добраться до Lua и игры, сломать другие программы,
// съесть память или время. Каждая атака — ошибка компиляции или исполнения с понятным текстом.
import { compile } from "../../src/lang/codegen"
import { describe, expect, test } from "../../src/test/testing"
import { outputOf, run } from "./harness"

function compileCodes(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.code)
}

describe("песочница: выход к Lua и игре", () => {
  test("глобальные имена Lua и Factorio неизвестны", () => {
    for (const name of ["game", "storage", "_G", "load", "require", "string", "os", "debug", "rawget", "setmetatable", "getmetatable", "pcall", "script", "remote", "settings", "R", "P", "Q", "CALL", "GET", "Y"]) {
      expect(`${name}: ${compileCodes(`const x = ${name}`).join()}`).toBe(`${name}: unknown-name`)
    }
  })

  test("служебные имена на __ недоступны в коде", () => {
    expect(compileCodes(`const o: any = {}; o.__cls = 1`)).toEqual(["reserved-name"])
    expect(compileCodes(`const __f = 1`)).toEqual(["reserved-name"])
  })

  test("служебные ключи на __ недоступны во время исполнения", () => {
    const reserved = "TypeError: Property names starting with __ are reserved"
    expect(run(`const o: any = {}; o["__cls"] = 1`).error).toBe(reserved)
    expect(run(`const o: any = {}; const k = "__" + "f"; print(o[k])`).error).toBe(reserved)
    expect(run(`JSON.parse('{"__f": 1, "__e": {}}')`).error).toBe(reserved)
    expect(run(`Object.fromEntries([["__f", 1]])`).error).toBe(reserved)
    expect(run(`const k = "__f"; const o = { [k]: 1 }`).error).toBe(reserved)
  })

  test("методы строк Lua недоступны", () => {
    expect(out(`const s: any = "x"; print(s.rep, s["rep"], s.sub, s.len)`)).toBe("undefined undefined undefined undefined")
    expect(run(`const s: any = "x"; s.rep(1000000000)`).error).toBe("TypeError: string.rep is not a function")
    expect(run(`const s: any = "x"; s.format("%s")`).error).toBe("TypeError: string.format is not a function")
  })

  test("служебные поля значений не видны, подделать функцию нельзя", () => {
    expect(out(`const f = () => 1; const g: any = f; print(g.f, g.e, Object.keys(g).length, JSON.stringify({ f }))`)).toBe("undefined undefined 0 {}")
    expect(run(`const fake: any = { f: 1, e: {} }; fake()`).error).toBe("TypeError: object is not a function")
  })

  test("встроенные классы и объекты API нельзя менять (они общие для всех программ)", () => {
    expect(run(`const m: any = Map; m.hacked = 1`).error).toBe("TypeError: Cannot set property 'hacked' of function")
    expect(run(`Object.assign(Error, { x: 1 })`).error).toBe("TypeError: Invalid argument: Object.assign target")
    expect(run(`const bot: any = me; bot.hacked = 1`).error).toBe("TypeError: Cannot set property 'hacked' of me")
  })
})

describe("песочница: память", () => {
  test("удвоение строки", () => {
    expect(run(`let s = "x"; while (true) s += s`).error).toBe("RangeError: String is too long")
    expect(run(`"x".repeat(1e9)`).error).toBe("RangeError: String is too long")
    expect(run(`"x".padStart(1e9)`).error).toBe("RangeError: String is too long")
  })

  test("бесконечный push в массив", () => {
    expect(run(`const a: number[] = []; while (true) a.push(a.length)`, { maxTicks: 1000 }).error).toBe("RangeError: Invalid array length")
    expect(run(`const a: number[] = []; a[1e9] = 1`).error).toBe("RangeError: Invalid array length")
    expect(run(`const a: number[] = []; a.length = 1e9`).error).toBe("RangeError: Invalid array length")
  })

  test("растущая цепочка объектов — ошибка памяти", () => {
    const r = run(`let o: any = {}; while (true) { o = { next: o, pad: [1, 2, 3] } }`, { maxTicks: 2000 })
    expect(r.error).toBe("RangeError: Program uses too much memory")
  })

  test("массив длинных строк — ошибка памяти", () => {
    const r = run(`const xs: string[] = []; const s = "x".repeat(50000); while (true) xs.push(s + xs.length)`, { maxTicks: 2000 })
    expect(r.error).toBe("RangeError: Program uses too much memory")
  })

  test("временные объекты, которые не копятся, — не ошибка", () => {
    const r = run(`let n = 0; for (let i = 0; i < 30000; i++) { const p = { x: i, y: [i, i] }; n += p.y.length } print(n)`, { maxTicks: 5000 })
    expect(r.output.join()).toBe("60000")
  })
})

describe("песочница: время", () => {
  test("бесконечный цикл не вешает игру: пауза каждый квант", () => {
    const r = run(`while (true) {}`, { maxTicks: 50, quantum: 50 })
    expect(r.status).toBe("ready")
    expect(r.ticks).toBe(50)
  })

  test("бесконечный цикл в синхронном колбэке — ошибка", () => {
    expect(run(`[1, 2].sort((a, b) => { while (true) {} return 0 })`).error).toBe("RangeError: Callback ran too long without a pause")
  })

  test("перехват ошибки колбэка не даёт съесть время: долг кванта", () => {
    const r = run(`let n = 0; while (true) { try { [1, 2].sort(() => { while (true) {} return 0 }) } catch (e) { n++ } }`, {
      maxTicks: 500,
      quantum: 50,
    })
    expect(r.status).toBe("ready")
    // 10 000 лишних витков на каждую попытку → машина пропускает ~200 тиков.
    expect(r.ticks).toBe(500)
  })

  test("бесконечная рекурсия через toString и геттеры — ошибка", () => {
    expect(run(`class A { toString(): string { return \`\${this}\` } } print(\`\${new A()}\`)`).error).toBe("RangeError: Maximum call stack size exceeded")
    expect(run(`class B { get x(): number { return this.x } } print(new B().x)`).error).toBe("RangeError: Maximum call stack size exceeded")
  })

  test("глубокая структура в JSON — ошибка", () => {
    expect(run(`let a: any = []; for (let i = 0; i < 200; i++) a = [a]; JSON.stringify(a)`).error).toBe(
      "TypeError: Invalid argument: structure is too deep for JSON",
    )
  })
})

describe("песочница: огромные программы", () => {
  test("слишком большой исходник", () => {
    expect(compileCodes(`let x = 0\n`.repeat(12000))).toEqual(["program-too-large"])
  })

  test("слишком глубокая вложенность", () => {
    expect(compileCodes("const x = " + "(".repeat(500) + "1" + ")".repeat(500))).toEqual(["too-deeply-nested"])
    expect(compileCodes("const x = " + "!".repeat(500) + "true")).toEqual(["too-deeply-nested"])
    expect(compileCodes("const x = " + "[".repeat(500) + "]".repeat(500))).toEqual(["too-deeply-nested"])
  })

  test("слишком много переменных или аргументов — ошибка компиляции, а не сбой", () => {
    const vars = Array.from({ length: 250 }, (_, i) => `let v${i} = ${i}`).join("\n")
    expect(compileCodes(`function f() {\n${vars}\n}`)).toEqual(["function-too-large"])
    const args = Array.from({ length: 300 }, (_, i) => `${i}`).join(", ")
    expect(compile(`print(${args})`).ok).toBe(false)
  })
})

function out(source: string): string {
  return outputOf(source)
}
