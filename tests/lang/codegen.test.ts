// Тесты компилятора и рантайма: программа компилируется, исполняется вне игры, сравнивается вывод.
import { describe, expect, test } from "../../src/test/testing"
import { outputOf, run } from "./harness"

function out(source: string): string {
  return outputOf(source)
}

describe("язык: выражения", () => {
  test("арифметика и строки", () => {
    expect(out(`print(1 + 2 * 3, 7 % 3, -7 % 3, 2 ** 10, 10 / 4, 1 / 0, -1 / 0)`)).toBe("7 1 -1 1024 2.5 Infinity -Infinity")
    expect(out(`print("a" + 1, 1 + "b", "x" + true, "n:" + null, 0.1 + 0.2)`)).toBe("a1 1b xtrue n:undefined 0.30000000000000004")
    expect(out(`const n = 5; print(\`n=\${n}, half=\${n / 2}, \${[1, 2]}\`)`)).toBe("n=5, half=2.5, 1,2")
    expect(out(`print(1e21, 1e-7, 123456789012, 0.000001, -0)`)).toBe("1e+21 1e-7 123456789012 0.000001 0")
  })

  test("сравнения, логика, ??, typeof", () => {
    expect(out(`print(1 < 2, "a" < "b", 1 === 1, 1 !== 1, null === undefined)`)).toBe("true true true false true")
    expect(out(`print(0 || "x", "" || 5, 1 && 2, 0 && 2, null ?? "d", 0 ?? "d", !0, !"")`)).toBe("x 5 2 0 d 0 true true")
    expect(out(`print(typeof 1, typeof "s", typeof null, typeof {}, typeof [], typeof (() => 1), typeof true)`)).toBe(
      "number string undefined object object function boolean",
    )
  })

  test("присваивания, ++, --, составные", () => {
    expect(out(`let a = 1; a += 2; a *= 3; a -= 1; a /= 2; a **= 2; print(a)`)).toBe("16")
    expect(out(`let i = 0; const x = i++; const y = ++i; print(x, y, i, i--, --i)`)).toBe("0 2 2 2 0")
    expect(out(`let s = "a"; s += 1; s += "b"; print(s)`)).toBe("a1b")
    expect(out(`let o: any = {}; o.n ??= 5; o.n ??= 6; o.m ||= 2; o.m &&= 3; print(o.n, o.m)`)).toBe("5 3")
    expect(out(`const arr = [1, 2]; arr[0] += 10; arr[1]++; print(arr)`)).toBe("11,3")
  })

  test("?. и ??", () => {
    expect(out(`const o: any = { a: { b: 2 } }; print(o?.a?.b, o.x?.y, o.x?.y.z, o.f?.(), o.a.b ?? 9)`)).toBe("2 undefined undefined undefined 2")
    expect(out(`const n: any = null; print(n?.a, n?.[0], n?.m())`)).toBe("undefined undefined undefined")
  })

  test("битовые операции", () => {
    expect(out(`print(5 & 3, 5 | 3, 5 ^ 3, ~5, 1 << 4, -16 >> 2, -1 >>> 28)`)).toBe("1 7 6 -6 16 -4 15")
  })
})

describe("язык: управление", () => {
  test("if, while, do-while, for, break, continue, метки", () => {
    expect(out(`let s = 0; for (let i = 0; i < 10; i++) { if (i % 2) continue; if (i > 6) break; s += i } print(s)`)).toBe("12")
    expect(out(`let n = 0; while (n < 5) n++; do { n += 10 } while (n < 30); print(n)`)).toBe("35")
    expect(
      out(`
      let found = ""
      outer: for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          if (j > i) continue outer
          if (i * j === 6) { found = \`\${i},\${j}\`; break outer }
        }
      }
      print(found)`),
    ).toBe("3,2")
  })

  test("for…of: массивы, строки, Map, Set, деструктуризация", () => {
    expect(out(`let s = ""; for (const x of [1, 2, 3]) s += x; for (const c of "дом") s += c; print(s)`)).toBe("123дом")
    expect(out(`const m = new Map([["b", 1], ["a", 2]]); for (const [k, v] of m) print(k, v)`)).toBe("b 1|a 2")
    expect(out(`const st = new Set([3, 1, 3]); for (const v of st) print(v)`)).toBe("3|1")
  })

  test("switch с проваливанием и default", () => {
    const program = `
      function f(x: number) {
        let r = ""
        switch (x) {
          case 1: r += "one "
          case 2: r += "two "; break
          default: r += "other "
          case 3: r += "three"
        }
        return r
      }
      print(f(1), "|", f(2), "|", f(3), "|", f(9))`
    expect(out(program)).toBe("one two  | two  | three | other three")
  })

  test("тернарный оператор и последовательность", () => {
    expect(out(`const a = 5; print(a > 3 ? "big" : "small", a < 3 ? 1 : a < 6 ? 2 : 3)`)).toBe("big 2")
  })
})

describe("язык: функции и замыкания", () => {
  test("параметры по умолчанию, rest, деструктуризация", () => {
    expect(out(`function f(a: number, b = a * 2, ...rest: number[]) { return [a, b, rest.length] } print(f(1), f(1, 5, 6, 7))`)).toBe(
      "1,2,0 1,5,2",
    )
    expect(out(`function g({ x, y = 3 }: any, [p, q]: number[]) { return x + y + p + q } print(g({ x: 1 }, [10, 20]))`)).toBe("34")
  })

  test("замыкания: счётчик, функции высшего порядка", () => {
    expect(
      out(`
      function counter() { let n = 0; return () => ++n }
      const c1 = counter(); const c2 = counter()
      c1(); c1()
      print(c1(), c2())
      const lowOn = (item: string, below: number) => (e: any) => e[item] < below
      print([{ coal: 1 }, { coal: 20 }].filter(lowOn("coal", 10)).length)`),
    ).toBe("3 1|1")
  })

  test("замыкания в цикле: своя переменная на итерацию", () => {
    expect(out(`const fs: (() => number)[] = []; for (let i = 0; i < 3; i++) fs.push(() => i); print(fs.map(f => f()))`)).toBe("0,1,2")
    expect(out(`const fs: (() => number)[] = []; for (const x of [5, 6]) fs.push(() => x); print(fs[0](), fs[1]())`)).toBe("5 6")
  })

  test("рекурсия и взаимная рекурсия", () => {
    expect(out(`function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) } print(fib(15))`)).toBe("610")
    expect(out(`function even(n: number): boolean { return n === 0 || odd(n - 1) } function odd(n: number): boolean { return n !== 0 && even(n - 1) } print(even(10), odd(7))`)).toBe("true true")
  })

  test("поднятие функций и захват до инициализации", () => {
    expect(out(`print(later()); function later() { return value } const value = 42`)).toBe("undefined")
    expect(out(`const get = () => value; const value = 42; print(get())`)).toBe("42")
  })

  test("глубокая рекурсия — ошибка, а не падение", () => {
    const r = run(`function down(n: number): number { return down(n + 1) } down(0)`)
    expect(r.status).toBe("error")
    expect(r.error).toBe("RangeError: Maximum call stack size exceeded")
  })
})

describe("язык: классы", () => {
  test("поля, конструктор, методы, геттеры, static, наследование, super", () => {
    const program = `
      abstract class Job {
        static count = 0
        done = false
        constructor(readonly name: string) { Job.count++ }
        abstract run(): string
        get title(): string { return "Job(" + this.name + ")" }
        describe() { return this.title + (this.done ? " ✓" : "") }
      }
      class Dig extends Job {
        depth = 1
        constructor(readonly ore: string) { super("dig") }
        run() { this.done = true; return "dig " + this.ore }
        describe() { return super.describe() + " [" + this.ore + "]" }
        static make() { return new Dig("coal") }
      }
      const d = Dig.make()
      print(d.run(), d.describe(), d.depth, Job.count, d instanceof Dig, d instanceof Job, Dig.count)`
    expect(out(program)).toBe("dig coal Job(dig) ✓ [coal] 1 1 true true 1")
  })

  test("toString у класса используется в шаблонах", () => {
    expect(out(`class P { constructor(readonly x: number, readonly y: number) {} toString() { return \`(\${this.x}, \${this.y})\` } } print(\`at \${new P(1, 2)}\`)`)).toBe("at (1, 2)")
  })

  test("наследник Error и instanceof", () => {
    const program = `
      class NoFuel extends Error { constructor(readonly level: number) { super("fuel " + level) } }
      try { throw new NoFuel(3) } catch (e) {
        print(e instanceof NoFuel, e instanceof Error, e.message, e.level, e.name)
      }`
    expect(out(program)).toBe("true true fuel 3 3 NoFuel")
  })

  test("метод как значение теряет this, стрелочная функция — нет", () => {
    expect(out(`class C { n = 1; get() { return [1].map(x => x + this.n) } } print(new C().get())`)).toBe("2")
  })
})

describe("язык: исключения", () => {
  test("try/catch/finally и порядок", () => {
    const program = `
      function f(x: number) {
        try {
          if (x === 1) throw new Error("bad")
          if (x === 2) return "early"
          print("body")
        } catch (e) {
          print("caught " + e.message)
          return "from catch"
        } finally {
          print("finally " + x)
        }
        return "end"
      }
      print(f(0)); print(f(1)); print(f(2))`
    expect(out(program)).toBe("body|finally 0|end|caught bad|finally 1|from catch|finally 2|early")
  })

  test("ошибки рантайма ловятся как TypeError", () => {
    expect(out(`try { const o: any = null; print(o.x) } catch (e) { print(e.name, e.message) }`)).toBe(
      "TypeError Cannot read properties of undefined (reading 'x')",
    )
    expect(out(`try { const n: any = undefined; print(n * 2) } catch (e) { print(e instanceof TypeError) }`)).toBe("true")
  })

  test("throw не-объектов и повторный throw из finally", () => {
    expect(out(`try { throw "oops" } catch (e) { print(e, typeof e) }`)).toBe("oops string")
    expect(out(`try { try { throw 5 } finally { print("cleanup") } } catch (e) { print("outer", e) }`)).toBe("cleanup|outer 5")
  })

  test("break и continue из try внутри цикла", () => {
    expect(out(`let s = ""; for (let i = 0; i < 5; i++) { try { if (i === 1) continue; if (i === 3) break; s += i } finally { s += "f" } } print(s)`)).toBe(
      "0ff2ff",
    )
  })

  test("неперехваченная ошибка — строка исходника", () => {
    const r = run(`print("a")\nconst o: any = undefined\nprint(o.field)`)
    expect(r.status).toBe("error")
    expect(r.line).toBe(3)
  })
})

describe("язык: деструктуризация и спред", () => {
  test("объекты и массивы", () => {
    expect(out(`const { a, b: { c = 5 }, ...rest } = { a: 1, b: {}, d: 4, e: 5 }; print(a, c, Object.keys(rest))`)).toBe("1 5 d,e")
    expect(out(`const [x, , z = 9, ...others] = [1, 2, undefined, 4, 5]; print(x, z, others)`)).toBe("1 9 4,5")
    expect(out(`let p = 1, q = 2; [p, q] = [q, p]; print(p, q)`)).toBe("2 1")
  })

  test("спред в массивах, объектах и вызовах", () => {
    expect(out(`const a = [1, 2]; const b = [0, ...a, 3]; print(b, Math.max(...b), [..."hi"])`)).toBe("0,1,2,3 3 h,i")
    expect(out(`const o = { x: 1, y: 2 }; const p = { ...o, y: 3, z: 4 }; print(JSON.stringify(p))`)).toBe('{"x":1,"y":3,"z":4}')
  })
})

describe("библиотека", () => {
  test("методы массивов", () => {
    expect(out(`const a = [5, 1, 4]; a.push(2, 3); print(a.sort((x, y) => x - y), a.indexOf(4), a.includes(9), a.slice(1, -1), a.join("-"))`)).toBe(
      "1,2,3,4,5 3 false 2,3,4 1-2-3-4-5",
    )
    expect(out(`const a = [1, 2, 3, 4]; print(a.reduce((s, x) => s + x, 0), a.find(x => x > 2), a.findIndex(x => x > 9), a.some(x => x > 3), a.every(x => x > 0))`)).toBe(
      "10 3 -1 true true",
    )
    expect(out(`const a = [1, 2, 3, 4, 5]; const r = a.splice(1, 2, 9); print(a, r, a.reverse(), [[1, [2]], 3].flat())`)).toBe("5,4,9,1 2,3 5,4,9,1 1,2,3")
    expect(out(`print([10, 9, 1].sort(), [3, 1, 2].map(String), ["b", "a"].sort())`)).toBe("1,10,9 3,1,2 a,b")
  })

  test("методы строк, в том числе кириллица", () => {
    expect(out(`const s = "Привет, мир"; print(s.length, s.toUpperCase(), s.slice(0, 6), s.indexOf("мир"), s[1], s.split(", "))`)).toBe(
      "11 ПРИВЕТ, МИР Привет 8 р Привет,мир",
    )
    expect(out(`print(" x ".trim(), "ab".repeat(3), "5".padStart(3, "0"), "a-b-c".replaceAll("-", "+"), "abc".at(-1), "x".charCodeAt(0))`)).toBe(
      "x ababab 005 a+b+c c 120",
    )
  })

  test("Map и Set сохраняют порядок вставки", () => {
    expect(out(`const m = new Map<string, number>(); m.set("z", 1).set("a", 2); m.delete("z"); m.set("z", 3); print([...m.keys()], m.size, m.get("a"), m.has("q"))`)).toBe(
      "a,z 2 2 false",
    )
    expect(out(`const s = new Set<number>(); s.add(1); s.add(1); s.add(2); print(s.size, [...s])`)).toBe("2 1,2")
  })

  test("JSON", () => {
    expect(out(`print(JSON.stringify({ b: [1, "x", null, true], a: { c: 1.5 } }))`)).toBe('{"a":{"c":1.5},"b":[1,"x",null,true]}')
    expect(out(`const v = JSON.parse('{"list": [1, 2, {"k": "\\\\u0444"}], "ok": true}'); print(v.list.length, v.list[2].k, v.ok)`)).toBe("3 ф true")
  })

  test("Math, Number, parseInt", () => {
    expect(out(`print(Math.floor(2.7), Math.round(2.5), Math.round(-2.5), Math.max(1, 5, 3), Math.min(), Math.abs(-3), Math.log2(8), Math.PI.toFixed(2))`)).toBe(
      "2 3 -2 5 Infinity 3 3 3.14",
    )
    expect(out(`print(parseInt("42px"), parseInt("ff", 16), parseFloat("3.5e2x"), Number.isInteger(5), isNaN(parseInt("x")))`)).toBe("42 255 350 true true")
  })
})

describe("исполнение: паузы и действия", () => {
  test("квант: бесконечный цикл встаёт на паузу и продолжается", () => {
    const r = run(`let n = 0; while (true) { n++; if (n >= 1000) break } print(n)`, { quantum: 10 })
    expect(r.output.join()).toBe("1000")
    expect(r.ticks >= 100).toBe(true)
  })

  test("блокирующие вызовы ждут тиков", () => {
    const r = run(`print("start"); wait(1); print("after wait"); move({ x: 1, y: 2 }); print(mine("coal", 5))`)
    expect(r.output.join("|")).toBe("start|after wait|5")
    expect(r.ticks >= 63).toBe(true)
  })

  test("действие внутри forEach и метода класса", () => {
    const program = `
      class Miner { constructor(readonly ore: string) {} work(n: number) { return mine(this.ore, n) } }
      const m = new Miner("iron-ore")
      const results: number[] = []
      ;[1, 2, 3].forEach(n => { results.push(m.work(n)) })
      print(results, [4, 5].map(n => m.work(n)))`
    expect(out(program)).toBe("1,2,3 4,5")
  })

  test("ошибка действия ловится как ActionError", () => {
    expect(out(`try { move("nowhere") } catch (e) { print(e instanceof ActionError, e.code) }`)).toBe("true no-path")
  })

  test("действие в синхронном колбэке — понятная ошибка", () => {
    const r = run(`[2, 1].sort((a, b) => { wait(1); return a - b })`)
    expect(r.error).toBe("TypeError: Actions cannot be used in this callback")
  })

  test("колбэк с циклом в синхронном вызове работает", () => {
    expect(out(`print([3, 1, 2].sort((a, b) => { let x = 0; for (let i = 0; i < 50; i++) x++; return a - b }))`, )).toBe("1,2,3")
  })
})
