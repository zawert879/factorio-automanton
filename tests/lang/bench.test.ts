// Нагрузки бенчмарка (src/test/langBench.ts) дают тот же результат, что и обычный Lua.
// Сам замер — npm run bench:lang (вне игры) и npm run bench:game (в Factorio).
import { runLangBench } from "../../src/test/langBench"
import { describe, test } from "../../src/test/testing"

describe("бенчмарк языка", () => {
  test("результаты программ совпадают с обычным Lua", () => {
    runLangBench(() => undefined)
  })
})
