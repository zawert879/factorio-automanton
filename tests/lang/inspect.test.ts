// Отладочный вывод (print, console.log) — как console.log в Node: src/lang/runtime/inspect.ts.
import { describe, expect, test } from "../../src/test/testing"
import { host, Val } from "../../src/lang/runtime/core"
import { inspect } from "../../src/lang/runtime/inspect"
import { outputOf } from "./harness"

/** Вывод программы, где print форматирует как в игре. */
function shown(source: string): string {
  const original = host.print
  const lines: string[] = []
  host.print = (...values: Val[]) => {
    const parts: string[] = []
    for (let i = 1; i <= select("#", ...values); i++) parts.push(inspect(select(i, ...values)[0]))
    lines.push(parts.join(" "))
  }
  try {
    const result = outputOf(source)
    return lines.length > 0 ? lines.join("|") : result
  } finally {
    host.print = original
  }
}

describe("print: значения как в console.log", () => {
  test("строки, числа, null", () => {
    expect(shown(`print("текст", 1.5, true, null)`)).toBe("текст 1.5 true undefined")
  })
  test("массивы и объекты — с содержимым; строки внутри — в кавычках", () => {
    expect(shown(`print([1, "a", [2, 3], { x: 1 }])`)).toBe(`[1, "a", [2, 3], { x: 1 }]`)
    expect(shown(`print({ b: 2, a: "s", "с пробелом": true, печь: 1 })`)).toBe(`{ a: "s", b: 2, печь: 1, "с пробелом": true }`)
    expect(shown(`print([], {})`)).toBe("[] {}")
  })
  test("экземпляр класса — с именем класса; свой toString — его текст", () => {
    expect(shown(`class P {\n  constructor(public x: number, public y: number) {}\n}\nprint(new P(1, 2))`)).toBe("P { x: 1, y: 2 }")
    expect(shown(`class Q {\n  toString(): string {\n    return "Q!"\n  }\n}\nprint(new Q())`)).toBe("Q!")
  })
  test("Map, Set, ошибка, функция, класс", () => {
    expect(shown(`const m = new Map<string, number[]>()\nm.set("a", [1])\nm.set("b", [])\nprint(m, new Set([1, 2]))`)).toBe(`Map(2) { "a" => [1], "b" => [] } Set(2) { 1, 2 }`)
    expect(shown(`print(new Error("сломалось"))`)).toBe("Error: сломалось")
    expect(shown(`class C {}\nprint(() => 1, C)`)).toBe("[Function] [class C]")
  })
  test("цикл, глубина, длинный массив", () => {
    expect(shown(`const o: { self?: unknown } = {}\no.self = o\nprint(o)`)).toBe("{ self: [Circular] }")
    expect(shown(`print([[[[[1]]]]])`)).toBe("[[[[[Array(1)]]]]]")
    expect(shown(`const a: number[] = []\nfor (let i = 0; i < 100; i++) a.push(i)\nprint(a)`)).toBe(
      `[${Array.from({ length: 30 }, (_, i) => i).join(", ")}, …+70]`,
    )
  })
})
