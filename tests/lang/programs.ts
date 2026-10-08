// Программы с ожидаемым выводом: исполняются в tests/lang/codegen.test.ts как есть и в
// tests/lang/pause.test.ts — с разными квантами и копированием состояния на каждой паузе.
// Вывод — строки print через «|»; ошибка — «error: Имя: текст @строка [вывод до ошибки]».

export interface ProgramCase {
  group: string
  name: string
  source: string
  expected: string
}

const cases: ProgramCase[] = []

function group(name: string, list: [string, string, string][]): void {
  for (const [title, source, expected] of list) cases.push({ group: name, name: title, source, expected })
}

group("выражения", [
  ["арифметика", `print(1 + 2 * 3, 7 % 3, -7 % 3, 2 ** 10, 10 / 4, 1 / 0, -1 / 0)`, "7 1 -1 1024 2.5 Infinity -Infinity"],
  ["склейка строк", `print("a" + 1, 1 + "b", "x" + true, "n:" + null, 0.1 + 0.2)`, "a1 1b xtrue n:undefined 0.30000000000000004"],
  ["шаблонные строки", `const n = 5; print(\`n=\${n}, half=\${n / 2}, \${[1, 2]}\`)`, "n=5, half=2.5, 1,2"],
  ["запись чисел", `print(1e21, 1e-7, 123456789012, 0.000001, -0, 2 ** 60, 1 / 3)`, "1e+21 1e-7 123456789012 0.000001 0 1152921504606847000 0.3333333333333333"],
  ["сравнения", `print(1 < 2, "a" < "b", 1 === 1, 1 !== 1, null === undefined)`, "true true true false true"],
  ["логика и ??", `print(0 || "x", "" || 5, 1 && 2, 0 && 2, null ?? "d", 0 ?? "d", !0, !"")`, "x 5 2 0 d 0 true true"],
  [
    "typeof",
    `print(typeof 1, typeof "s", typeof null, typeof {}, typeof [], typeof (() => 1), typeof true, typeof print, typeof String)`,
    "number string undefined object object function boolean function function",
  ],
  ["составные присваивания", `let a = 1; a += 2; a *= 3; a -= 1; a /= 2; a **= 2; print(a)`, "16"],
  ["++ и --", `let i = 0; const x = i++; const y = ++i; print(x, y, i, i--, --i)`, "0 2 2 2 0"],
  ["+= строк", `let s = "a"; s += 1; s += "b"; print(s)`, "a1b"],
  ["логические присваивания", `let o: any = {}; o.n ??= 5; o.n ??= 6; o.m ||= 2; o.m &&= 3; print(o.n, o.m)`, "5 3"],
  ["присваивания по индексу", `const arr = [1, 2]; arr[0] += 10; arr[1]++; print(arr)`, "11,3"],
  ["?.", `const o: any = { a: { b: 2 } }; print(o?.a?.b, o.x?.y, o.x?.y.z, o.f?.(), o.a.b ?? 9)`, "2 undefined undefined undefined 2"],
  ["?. от null", `const n: any = null; print(n?.a, n?.[0], n?.m())`, "undefined undefined undefined"],
  ["битовые", `print(5 & 3, 5 | 3, 5 ^ 3, ~5, 1 << 4, -16 >> 2, -1 >>> 28)`, "1 7 6 -6 16 -4 15"],
  ["тернарный", `const a = 5; print(a > 3 ? "big" : "small", a < 3 ? 1 : a < 6 ? 2 : 3)`, "big 2"],
  ["порядок вычисления", `let log = ""; const f = (s: string) => { log += s; return 1 }; const r = f("a") + f("b") * f("c"); print(log, r)`, "abc 2"],
  ["in и instanceof", `const o = { a: 1 }; print("a" in o, "b" in o, 0 in [5], [] instanceof Map, new Map() instanceof Map)`, "true false true false true"],
])

group("управление", [
  ["for, break, continue", `let s = 0; for (let i = 0; i < 10; i++) { if (i % 2) continue; if (i > 6) break; s += i } print(s)`, "12"],
  ["while и do-while", `let n = 0; while (n < 5) n++; do { n += 10 } while (n < 30); print(n)`, "35"],
  [
    "метки",
    `let found = ""
    outer: for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        if (j > i) continue outer
        if (i * j === 6) { found = \`\${i},\${j}\`; break outer }
      }
    }
    print(found)`,
    "3,2",
  ],
  ["for…of: массивы и строки", `let s = ""; for (const x of [1, 2, 3]) s += x; for (const c of "дом") s += c; print(s)`, "123дом"],
  ["for…of: Map", `const m = new Map([["b", 1], ["a", 2]]); for (const [k, v] of m) print(k, v)`, "b 1|a 2"],
  ["for…of: Set", `const st = new Set([3, 1, 3]); for (const v of st) print(v)`, "3|1"],
  ["for…of с изменением массива", `const a = [1, 2]; let n = 0; for (const x of a) { if (a.length < 5) a.push(x * 10); n++ } print(n, a)`, "5 1,2,10,20,100"],
  [
    "switch",
    `function f(x: number) {
      let r = ""
      switch (x) {
        case 1: r += "one "
        case 2: r += "two "; break
        default: r += "other "
        case 3: r += "three"
      }
      return r
    }
    print(f(1), "|", f(2), "|", f(3), "|", f(9))`,
    "one two  | two  | three | other three",
  ],
  ["switch в цикле: break и continue", `let s = ""; for (const x of [1, 2, 3, 4]) { switch (x) { case 2: continue; case 4: break; default: s += x } s += "." } print(s)`, "1.3.."],
])

group("функции", [
  ["параметры по умолчанию и rest", `function f(a: number, b = a * 2, ...rest: number[]) { return [a, b, rest.length] } print(f(1), f(1, 5, 6, 7))`, "1,2,0 1,5,2"],
  ["деструктуризация параметров", `function g({ x, y = 3 }: any, [p, q]: number[]) { return x + y + p + q } print(g({ x: 1 }, [10, 20]))`, "34"],
  ["счётчик", `function counter() { let n = 0; return () => ++n } const c1 = counter(); const c2 = counter(); c1(); c1(); print(c1(), c2())`, "3 1"],
  ["функция высшего порядка", `const lowOn = (item: string, below: number) => (e: any) => e[item] < below; print([{ coal: 1 }, { coal: 20 }].filter(lowOn("coal", 10)).length)`, "1"],
  ["замыкания в for (let …)", `const fs: (() => number)[] = []; for (let i = 0; i < 3; i++) fs.push(() => i); print(fs.map(f => f()))`, "0,1,2"],
  ["замыкания в for…of", `const fs: (() => number)[] = []; for (const x of [5, 6]) fs.push(() => x); print(fs[0](), fs[1]())`, "5 6"],
  ["рекурсия", `function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) } print(fib(15))`, "610"],
  [
    "взаимная рекурсия",
    `function even(n: number): boolean { return n === 0 || odd(n - 1) } function odd(n: number): boolean { return n !== 0 && even(n - 1) } print(even(10), odd(7))`,
    "true true",
  ],
  ["поднятие функции, переменная позже", `print(later()); function later() { return value } const value = 42`, "undefined"],
  ["захват до объявления", `const get = () => value; const value = 42; print(get())`, "42"],
  ["глубокая рекурсия", `function down(n: number): number { return down(n + 1) } down(0)`, "error: RangeError: Maximum call stack size exceeded @1 []"],
  ["замыкание меняет внешнюю переменную", `let total = 0; [1, 2, 3].forEach(x => { total += x }); const add = (n: number) => { total += n }; add(10); print(total)`, "16"],
])

group("классы", [
  [
    "наследование, super, static, геттеры",
    `abstract class Job {
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
    print(d.run(), d.describe(), d.depth, Job.count, d instanceof Dig, d instanceof Job, Dig.count)`,
    "dig coal Job(dig) ✓ [coal] 1 1 true true 1",
  ],
  ["toString в шаблоне", `class P { constructor(readonly x: number, readonly y: number) {} toString() { return \`(\${this.x}, \${this.y})\` } } print(\`at \${new P(1, 2)}\`)`, "at (1, 2)"],
  [
    "наследник Error",
    `class NoFuel extends Error { constructor(readonly level: number) { super("fuel " + level) } }
    try { throw new NoFuel(3) } catch (e) { print(e instanceof NoFuel, e instanceof Error, e.message, e.level, e.name) }`,
    "true true fuel 3 3 NoFuel",
  ],
  ["this в стрелочной функции", `class C { n = 1; get() { return [1].map(x => x + this.n) } } print(new C().get())`, "2"],
  ["класс без конструктора наследует аргументы", `class A { constructor(readonly v: number) {} } class B extends A { w = this.v * 2 } const b = new B(4); print(b.v, b.w)`, "4 8"],
  ["методы объекта и this", `const o = { n: 2, twice() { return this.n * 2 } }; print(o.twice())`, "4"],
])

group("исключения", [
  [
    "try/catch/finally",
    `function f(x: number) {
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
    print(f(0)); print(f(1)); print(f(2))`,
    "body|finally 0|end|caught bad|finally 1|from catch|finally 2|early",
  ],
  ["ошибка чтения свойства", `try { const o: any = null; print(o.x) } catch (e) { print(e.name, e.message) }`, "TypeError Cannot read properties of undefined (reading 'x')"],
  ["арифметика с undefined", `try { const n: any = undefined; print(n * 2) } catch (e) { print(e instanceof TypeError) }`, "true"],
  ["throw строки", `try { throw "oops" } catch (e) { print(e, typeof e) }`, "oops string"],
  ["finally и повторный throw", `try { try { throw 5 } finally { print("cleanup") } } catch (e) { print("outer", e) }`, "cleanup|outer 5"],
  ["break и continue из try", `let s = ""; for (let i = 0; i < 5; i++) { try { if (i === 1) continue; if (i === 3) break; s += i } finally { s += "f" } } print(s)`, "0ff2ff"],
  ["неперехваченная ошибка", `print("a")\nconst o: any = undefined\nprint(o.field)`, "error: TypeError: Cannot read properties of undefined (reading 'field') @3 [a]"],
  ["вложенные try", `try { try { throw new Error("in") } catch (e) { throw new Error("re:" + e.message) } } catch (e) { print(e.message) }`, "re:in"],
])

group("деструктуризация и спред", [
  ["объект с rest", `const { a, b: { c = 5 }, ...rest } = { a: 1, b: {}, d: 4, e: 5 }; print(a, c, Object.keys(rest))`, "1 5 d,e"],
  ["массив с пропуском", `const [x, , z = 9, ...others] = [1, 2, undefined, 4, 5]; print(x, z, others)`, "1 9 4,5"],
  ["обмен", `let p = 1, q = 2; [p, q] = [q, p]; print(p, q)`, "2 1"],
  ["спред массивов и вызовов", `const a = [1, 2]; const b = [0, ...a, 3]; print(b, Math.max(...b), [..."hi"])`, "0,1,2,3 3 h,i"],
  ["спред объектов", `const o = { x: 1, y: 2 }; const p = { ...o, y: 3, z: 4 }; print(JSON.stringify(p))`, '{"x":1,"y":3,"z":4}'],
])

group("библиотека", [
  ["push, sort, indexOf, slice, join", `const a = [5, 1, 4]; a.push(2, 3); print(a.sort((x, y) => x - y), a.indexOf(4), a.includes(9), a.slice(1, -1), a.join("-"))`, "1,2,3,4,5 3 false 2,3,4 1-2-3-4-5"],
  ["reduce, find, some, every", `const a = [1, 2, 3, 4]; print(a.reduce((s, x) => s + x, 0), a.find(x => x > 2), a.findIndex(x => x > 9), a.some(x => x > 3), a.every(x => x > 0))`, "10 3 -1 true true"],
  ["splice, reverse, flat", `const a = [1, 2, 3, 4, 5]; const r = a.splice(1, 2, 9); print(a, r, a.reverse(), [[1, [2]], 3].flat())`, "5,4,9,1 2,3 5,4,9,1 1,2,3"],
  ["sort по умолчанию, String", `print([10, 9, 1].sort(), [3, 1, 2].map(String), ["b", "a"].sort())`, "1,10,9 3,1,2 a,b"],
  ["строки: кириллица", `const s = "Привет, мир"; print(s.length, s.toUpperCase(), s.slice(0, 6), s.indexOf("мир"), s[1], s.split(", "))`, "11 ПРИВЕТ, МИР Привет 8 р Привет,мир"],
  ["строки: методы", `print(" x ".trim(), "ab".repeat(3), "5".padStart(3, "0"), "a-b-c".replaceAll("-", "+"), "abc".at(-1), "x".charCodeAt(0))`, "x ababab 005 a+b+c c 120"],
  ["Map", `const m = new Map<string, number>(); m.set("z", 1).set("a", 2); m.delete("z"); m.set("z", 3); print([...m.keys()], m.size, m.get("a"), m.has("q"))`, "a,z 2 2 false"],
  ["Set", `const s = new Set<number>(); s.add(1); s.add(1); s.add(2); print(s.size, [...s])`, "2 1,2"],
  ["Map с объектами-ключами", `const k1 = { id: 1 }; const k2 = { id: 1 }; const m = new Map(); m.set(k1, "a"); m.set(k2, "b"); print(m.size, m.get(k1), m.get(k2))`, "2 a b"],
  ["JSON.stringify", `print(JSON.stringify({ b: [1, "x", null, true], a: { c: 1.5 } }))`, '{"a":{"c":1.5},"b":[1,"x",null,true]}'],
  ["JSON.parse", `const v = JSON.parse('{"list": [1, 2, {"k": "\\\\u0444"}], "ok": true}'); print(v.list.length, v.list[2].k, v.ok)`, "3 ф true"],
  ["Math", `print(Math.floor(2.7), Math.round(2.5), Math.round(-2.5), Math.max(1, 5, 3), Math.min(), Math.abs(-3), Math.log2(8), Math.PI.toFixed(2))`, "2 3 -2 5 Infinity 3 3 3.14"],
  ["parseInt и Number", `print(parseInt("42px"), parseInt("ff", 16), parseFloat("3.5e2x"), Number.isInteger(5), isNaN(parseInt("x")), Number("12"), Number("x"))`, "42 255 350 true true 12 NaN"],
  ["Object.entries и fromEntries", `const o = { b: 2, a: 1 }; print(JSON.stringify(Object.entries(o)), JSON.stringify(Object.fromEntries([["x", 1]])))`, '[["a",1],["b",2]] {"x":1}'],
  ["Array.from", `print(Array.from({ length: 3 }, (_, i) => i * i), Array.from("ab"), Array.isArray([]))`, "0,1,4 a,b true"],
])

group("действия и паузы", [
  ["бесконечный цикл с выходом", `let n = 0; while (true) { n++; if (n >= 1000) break } print(n)`, "1000"],
  ["блокирующие вызовы", `print("start"); wait(1); print("after wait"); move({ x: 1, y: 2 }); print(mine("coal", 5))`, "start|after wait|5"],
  [
    "действия в forEach, map и методе класса",
    `class Miner { constructor(readonly ore: string) {} work(n: number) { return mine(this.ore, n) } }
    const m = new Miner("iron-ore")
    const results: number[] = []
    ;[1, 2, 3].forEach(n => { results.push(m.work(n)) })
    print(results, [4, 5].map(n => m.work(n)), [6, 7].filter(n => mine("x", n) > 6), [1, 2].reduce((s, n) => s + mine("x", n), 0))`,
    "1,2,3 4,5 7 3",
  ],
  ["ActionError", `try { move("nowhere") } catch (e) { print(e instanceof ActionError, e.code) }`, "true no-path"],
  ["действие в синхронном колбэке", `[2, 1].sort((a, b) => { wait(1); return a - b })`, "error: TypeError: Actions cannot be used in this callback @1 []"],
  ["цикл в синхронном колбэке", `print([3, 1, 2].sort((a, b) => { let x = 0; for (let i = 0; i < 50; i++) x++; return a - b }))`, "1,2,3"],
  ["действие в конструкторе", `class Bot { fuel: number; constructor() { this.fuel = mine("coal", 3) } } const b = new Bot(); print(b.fuel)`, "3"],
  [
    "finally после паузы",
    `function job() { try { wait(0.1); return "done" } finally { print("cleanup"); wait(0.05) } }
    print(job())`,
    "cleanup|done",
  ],
  [
    "пауза внутри catch",
    `try { move("nowhere") } catch (e) { wait(0.1); print("recovered", e.code) } finally { print("end") }`,
    "recovered no-path|end",
  ],
  [
    "замыкания и объекты переживают паузы",
    `const state = { count: 0, log: [] as string[] }
    const bump = (s: string) => { state.count++; state.log.push(s) }
    for (let i = 0; i < 3; i++) { bump("a" + i); wait(0.02) }
    const m = new Map<string, number>([["x", 1]])
    wait(0.02)
    m.set("y", 2)
    print(state.count, state.log, [...m.entries()].join(";"))`,
    "3 a0,a1,a2 x,1;y,2",
  ],
  [
    "вложенные возобновляемые вызовы",
    `function a(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += b(i); return s }
    function b(i: number): number { wait(0.02); return i * 2 }
    print(a(4))`,
    "12",
  ],
  [
    "рекурсия с паузами",
    `function walk(depth: number): number { if (depth === 0) { wait(0.02); return 1 } return walk(depth - 1) + walk(depth - 1) }
    print(walk(3))`,
    "8",
  ],
  [
    "геттер с циклом",
    `class Store { items = [1, 2, 3] ; get total() { let s = 0; for (const x of this.items) s += x; return s } } print(new Store().total)`,
    "6",
  ],
])

export const PROGRAMS = cases
