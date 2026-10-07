// Проверка самой библиотеки тестов и особенностей TypeScriptToLua в Lua 5.2.
import { describe, expect, test } from "../src/test/testing"

describe("библиотека тестов", () => {
  test("toBe сравнивает значения", () => {
    expect(1 + 1).toBe(2)
  })

  test("toEqual сравнивает таблицы по содержимому", () => {
    expect({ a: [1, 2], b: "x" }).toEqual({ a: [1, 2], b: "x" })
  })

  test("toThrow ловит ошибку и проверяет текст", () => {
    expect(() => {
      throw new Error("бум")
    }).toThrow("бум")
  })

  test("проваленная проверка — это ошибка", () => {
    expect(() => expect(1).toBe(2)).toThrow("ожидалось 2, получено 1")
  })
})

describe("TypeScriptToLua в Lua 5.2", () => {
  test("индексы массивов с нуля, как в TS", () => {
    const xs = [10, 20, 30]
    expect(xs[0]).toBe(10)
    expect(xs.length).toBe(3)
  })

  test("Map перебирается в порядке вставки", () => {
    const m = new Map<string, number>()
    m.set("b", 1)
    m.set("a", 2)
    expect([...m.keys()]).toEqual(["b", "a"])
  })

  test("длина строки считается в байтах UTF-8, а не в символах", () => {
    expect("abc".length).toBe(3)
    expect("ж".length).toBe(2)
  })

  test("окружение как в Factorio: нет coroutine, io, os, loadfile, dofile", () => {
    const globals = _G as unknown as Record<string, unknown>
    for (const name of ["coroutine", "io", "os", "loadfile", "dofile"]) {
      expect(globals[name]).toBe(undefined)
    }
  })
})
