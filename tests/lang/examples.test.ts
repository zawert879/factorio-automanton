// Готовность этапа 3: программы из docs/API.md и образца языка компилируются и исполняются
// с заглушками API (tests/lang/api-stubs.ts) — без ошибок, в том числе с паузами и копированием состояния.
import { describe, expect, test } from "../../src/test/testing"
import "./api-stubs"
import { EXAMPLES } from "./examples.generated"
import { run } from "./harness"

describe("примеры из документации исполняются", () => {
  for (const example of EXAMPLES) {
    test(example.name, () => {
      for (const quantum of [3, 1000]) {
        const r = run(example.source, { maxTicks: 400, quantum, copy: quantum === 3 })
        const summary = r.status === "error" || r.status === "compile-error" ? `${r.status}: ${r.error} @${r.line}` : "ok"
        expect(`квант ${quantum}: ${summary}`).toBe(`квант ${quantum}: ok`)
      }
    })
  }
})
