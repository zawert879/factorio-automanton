// Регрессия: блокирующий вызов внутри try не должен портить временные переменные тела (результат
// pcall при паузе — кадр продолжения — записывался в ту же переменную, где тело хранило левый операнд +=).
import { describe, expect, test } from "../../src/test/testing"
import "./api-stubs"
import { run } from "./harness"

const SOURCE = `function f(): boolean {
  let poured = 0
  for (const b of [1, 2]) {
    try { poured += fill(b as any) } catch (e) { print("err") } finally { poured += 1 }
  }
  print(typeof poured, poured)
  return poured > 0
}
print(f())`

describe("try и паузы", () => {
  for (const quantum of [1, 3, 1000]) {
    test(`+= с действием внутри try, квант ${quantum}`, () => {
      const r = run(SOURCE, { maxTicks: 200, quantum, copy: quantum === 3 })
      expect(`${r.status} ${r.output.join("|")}`).toBe("done number 1002|true")
    })
  }
})
