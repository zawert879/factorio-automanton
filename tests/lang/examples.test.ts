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
})
