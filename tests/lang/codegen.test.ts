// Тесты компилятора и рантайма: программы из tests/lang/programs.ts исполняются вне игры,
// вывод сравнивается с ожидаемым.
import { describe, expect, test } from "../../src/test/testing"
import { outputOf, run } from "./harness"
import { PROGRAMS } from "./programs"

for (const program of PROGRAMS) {
  describe(`язык: ${program.group}`, () => {
    test(program.name, () => {
      expect(outputOf(program.source)).toBe(program.expected)
    })
  })
}

describe("исполнение", () => {
  test("квант: цикл встаёт на паузу на каждом витке и продолжается", () => {
    const r = run(`let n = 0; while (true) { n++; if (n >= 1000) break } print(n)`, { quantum: 10 })
    expect(r.output.join()).toBe("1000")
    expect(r.ticks >= 100).toBe(true)
  })

  test("ожидание занимает тики", () => {
    const r = run(`wait(1); print("ok")`)
    expect(r.ticks >= 60).toBe(true)
  })
})
