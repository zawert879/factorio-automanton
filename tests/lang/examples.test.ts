// Готовность этапа 3: программы из docs/API.md и образца языка компилируются и исполняются
// с заглушками API (tests/lang/api-stubs.ts) — без ошибок, в том числе с паузами и копированием состояния.
import { describe, expect, test } from "../../src/test/testing"
import "./api-stubs"
import { EXAMPLES } from "./examples.generated"
import { outputOf, run } from "./harness"

/** Стартовые программы по именам — модули для примеров (import из "./lib/Помощники"). */
const modules: Record<string, string> = {}
for (const example of EXAMPLES) if (example.program !== undefined) modules[example.program] = example.source

describe("примеры из документации исполняются", () => {
  for (const example of EXAMPLES) {
    test(example.name, () => {
      for (const quantum of [3, 1000]) {
        const r = run(example.source, { maxTicks: 400, quantum, copy: quantum === 3, modules, name: example.program ?? "main" })
        const summary = r.status === "error" || r.status === "compile-error" ? `${r.status}: ${r.error} @${r.line}` : "ok"
        expect(`квант ${quantum}: ${summary}`).toBe(`квант ${quantum}: ok`)
      }
    })
  }
})

describe("классы объектов игры", () => {
  test("instanceof — по классу обёртки, в том числе после копирования состояния", () => {
    const source = `const f = zone("плавильня").find(Furnace)[0]
const K = Furnace
wait(1)
print(f instanceof Furnace, f instanceof Building, f instanceof Chest, f instanceof Machine, f instanceof K)
const c = zone("склад").find(Chest)[0]
print(c instanceof Chest, c instanceof Furnace, me instanceof Machine, me instanceof Robot, robot(1) instanceof Robot)`
    expect(outputOf(source, { copy: true, quantum: 3 })).toBe("true true false false true|true false true false true")
  })

  test("методы зданий ждут действия — и в своих функциях, и в колбэках", () => {
    const source = `function feed(f: Furnace): number { return f.insert("coal", 2) + f.extract("iron-plate") }
const total = zone("плавильня").find(Furnace).map((f) => feed(f)).reduce((a, b) => a + b, 0)
const helper = robot(3)!
helper.refuel()
print(total, helper.insert("coal", 1))`
    expect(outputOf(source, { copy: true, quantum: 3 })).toBe("15 5")
  })

  test("me: действия своей машины и её системы ждут действия", () => {
    const source = `me.move({ x: 1, y: 2 })
const n = me.mine("coal", 3)
me.say("ok")
me.energy.refuel("coal")
const pumped = me.tank?.pump("water", 100) ?? -1
const weapon = me.weapon
if (weapon !== null) { weapon.reload(); print(weapon.attack(zone("a").find(Furnace)[0]), weapon.ammo?.count) }
print(n, pumped, me.energy.level, me.tank?.capacity, me.pickup(), me.drop("coal"))`
    expect(outputOf(source, { copy: true, quantum: 3 })).toBe("ok|true 30|3 1000 0.5 1000 2 1")
  })
})
