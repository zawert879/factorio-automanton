// 3.10: каждая программа из tests/lang/programs.ts исполняется с разными квантами и с копированием
// всего состояния машины на каждой паузе (как сохранение и загрузка игры) — вывод тот же.
import { describe, expect, test } from "../../src/test/testing"
import { outputOf } from "./harness"
import { PROGRAMS } from "./programs"

const QUANTA = [1, 2, 3, 7, 50, 5000]

describe("паузы и сериализация", () => {
  for (const program of PROGRAMS) {
    test(`${program.group}: ${program.name}`, () => {
      for (const quantum of QUANTA) {
        const result = outputOf(program.source, { quantum, copy: true })
        expect(`квант ${quantum}: ${result}`).toBe(`квант ${quantum}: ${program.expected}`)
      }
    })
  }
})
