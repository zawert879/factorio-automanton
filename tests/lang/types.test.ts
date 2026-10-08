// Проверка типов (этап 12): ошибки — только там, где они точно есть (как у tsc --strict), и ни одной
// ложной на правильных программах.
import { describe, expect, test } from "../../src/test/testing"
import { compile } from "../../src/lang/codegen"

function typeErrors(source: string): string {
  const result = compile(source)
  if (result.ok) return "ok"
  return result.diagnostics.map((d) => `${d.code}@${d.line}`).join("; ")
}

const BAD: [string, string, string][] = [
  ["нет свойства у API", `const n = me.cargo.cout("coal")`, "type-no-property@1"],
  ["нет свойства у своего класса", `class A { x = 1 }\nconst a = new A()\nprint(a.y)`, "type-no-property@3"],
  ["нет свойства у интерфейса", `interface P { x: number }\nconst p: P = { x: 1 }\nprint(p.z)`, "type-no-property@3"],
  ["нет метода у строки", `const s = "abc"\nprint(s.toUpper())`, "type-no-property@2"],
  ["нет метода у массива", `const a = [1, 2]\na.append(3)`, "type-no-property@2"],
  ["строка вместо числа", `wait("5")`, "type-not-assignable@1"],
  ["число вместо строки", `marker(5)`, "type-not-assignable@1"],
  ["литерал не из объединения", `display("x").text(0, 0, "a", { align: "middle" })`, "type-not-assignable@1"],
  ["мало аргументов", `put(scan.entities()[0])`, "type-argument-count@1"],
  ["много аргументов", `wait(1, 2, 3)`, "type-argument-count@1"],
  ["аннотация переменной", `const x: number = "a"`, "type-not-assignable@1"],
  ["присваивание выведенному типу", `let x = 1\nx = "a"`, "type-not-assignable@2"],
  ["return не того типа", `function f(): number { return "a" }`, "type-not-assignable@1"],
  ["вызов не-функции", `const n = me.name\nn()`, "type-not-callable@2"],
  ["арифметика со строкой", `const a = "x" * 2`, "type-arithmetic@1"],
  ["арифметика с объектом", `const p = me.position\nconst d = p - 1`, "type-arithmetic@2"],
  ["аргумент обобщённого метода", `const xs = [1, 2, 3]\nxs.push("4")`, "type-not-assignable@2"],
  ["лямбда: параметр из контекста", `const xs = ["a", "b"]\nxs.map((s) => s.foo)`, "type-no-property@2"],
  ["результат map — новый тип", `const lens = ["a", "bb"].map((s) => s.length)\nlens[0].toUpperCase()`, "type-no-property@2"],
  ["Map: тип значения", `const m = new Map<string, number>()\nm.set("a", "b")`, "type-not-assignable@2"],
  ["receive<T>: data", `const m = receive<{ n: number }>("t")!\nprint(m.data.x)`, "type-no-property@2"],
  ["me.args<T>", `const { ore } = me.args<{ ore: string }>()\nwait(ore)`, "type-not-assignable@2"],
  ["свойство объектного литерала", `const p = { x: 1, y: 2 }\nprint(p.z)`, "type-no-property@2"],
  ["поле класса присваивание", `class A { n = 0 }\nconst a = new A()\na.n = "x"`, "type-not-assignable@3"],
  ["конструктор: аргумент", `class A { constructor(readonly n: number) {} }\nnew A("x")`, "type-not-assignable@2"],
  ["наследование: метод предка", `class A { hi(): string { return "a" } }\nclass B extends A {}\nnew B().bye()`, "type-no-property@3"],
]

const GOOD: [string, string][] = [
  [
    "сужение: instanceof и дискриминант",
    `type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number }
function area(s: Shape): number {
  if (s.kind === "circle") return Math.PI * s.r * s.r
  return s.side * s.side
}
try { move({ x: 1, y: 2 }) } catch (e) { if (e instanceof ActionError) print(e.code, e.message) }
print(area({ kind: "circle", r: 1 }))`,
  ],
  [
    "ранний выход и null",
    `function nearest(): Entity {
  const all = scan.entities({ type: "container" })
  const first = all.find((e) => e.name === "wooden-chest")
  if (first === undefined) {
    alert("нет")
    exit()
  }
  return first
}
const c = nearest()
print(c.count("coal"))`,
  ],
  [
    "обобщения: свои функции и библиотека",
    `function first<T>(xs: T[]): T | undefined { return xs[0] }
const n: number | undefined = first([1, 2])
const s = first(["a"])?.toUpperCase()
const total = [1, 2, 3].reduce((acc, x) => acc + x, 0)
const longest = ["a", "bb"].reduce((a, b) => (a.length > b.length ? a : b))
const pairs = [...new Map<string, number>([["a", 1]]).entries()].map(([k, v]) => \`\${k}=\${v + 1}\`)
const flat = [[1], [2, 3]].flatMap((x) => x)
const set = new Set<number>([1, 2])
for (const v of set) print(v + 1)
print(n, s, total + 1, longest.length, pairs.join(","), flat.length)`,
  ],
  [
    "классы: наследование, геттеры, статика, this",
    `abstract class Job {
  static count = 0
  constructor(readonly name: string) { Job.count++ }
  abstract run(): void
  get title(): string { return this.name.toUpperCase() }
}
class Mine extends Job {
  private done = 0
  constructor(readonly ore: string) { super("mine") }
  run(): void { this.done += mine(this.ore, 5) }
}
const jobs: Job[] = [new Mine("coal")]
for (const job of jobs) { job.run(); print(job.title, Job.count) }`,
  ],
  [
    "API: сообщения, доска, задачи, табло",
    `type Order = { furnace: Entity; ore: Item }
const m = receive<Order>("задание", 5)
if (m !== null) { move(m.data.furnace); put(m.data.furnace, m.data.ore); m.reply("ok") }
board.increment("n")
const task = tasks.next<number>("q", { timeout: 1 })
if (task !== null) { print(task.data + 1); task.done() }
const s = display("штаб")
s.frame(() => {
  s.clear("black")
  const size = s.table(0, 0, [["a", { text: "b", color: "green" }]], { header: true })
  s.bar(0, size.height, s.width, 4, 0.5, { r: 1, g: 0, b: 0 })
})`,
  ],
  [
    "деструктуризация, spread, optional chaining, ??",
    `const { ore = "iron-ore", count } = me.args<{ ore?: Item; count?: number }>()
const [a, b, ...rest] = [1, 2, 3, 4]
const merged = { ...me.position, z: 1 }
const ammo = me.weapon?.ammo?.count ?? 0
const label = \`\${ore}: \${count ?? 0}, \${a + b + rest.length + merged.z + ammo}\`
me.label = label`,
  ],
  [
    "функции высшего порядка и колбэки",
    `const lowOn = (item: Item, below: number) => (e: Entity) => e.count(item) < below
const hungry = scan.entities({ type: "furnace" }).filter(lowOn("coal", 5)).sort((x, y) => me.distance(x) - me.distance(y))
waitUntil(() => me.cargo.isFull(), { every: 1, timeout: 10 })
hungry.forEach((f, i) => print(i, f.name))
const byName = new Map<string, Entity[]>()
for (const e of hungry) { const list = byName.get(e.name) ?? []; list.push(e); byName.set(e.name, list) }`,
  ],
  [
    "as и any",
    `const raw: any = JSON.parse("{}")
const n = raw.foo.bar as number
const v = me.memory.get<number>("x") ?? 0
const items = me.cargo.items() as ItemStack[]
print(n + v + items.length)`,
  ],
]

describe("проверка типов: ошибки", () => {
  for (const [name, source, expected] of BAD) {
    test(name, () => expect(typeErrors(source)).toBe(expected))
  }
})

describe("проверка типов: правильные программы без ошибок", () => {
  for (const [name, source] of GOOD) {
    test(name, () => expect(typeErrors(source)).toBe("ok"))
  }
})
