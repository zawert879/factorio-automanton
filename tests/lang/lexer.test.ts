// Тесты лексера языка программ (вне игры, Lua 5.2).
import { Token, tokenize } from "../../src/lang/lexer"
import { describe, expect, test } from "../../src/test/testing"

function kinds(source: string): string[] {
  return tokenize(source).tokens.map((t) => `${t.kind}:${t.value}`)
}

function single(source: string): Token {
  const { tokens, diagnostics } = tokenize(source)
  expect(diagnostics.length).toBe(0)
  return tokens[0]
}

describe("лексер", () => {
  test("имена, ключевые слова, знаки", () => {
    expect(kinds("const x = a?.b ?? 1")).toEqual([
      "keyword:const", "identifier:x", "punctuator:=", "identifier:a", "punctuator:?.", "identifier:b",
      "punctuator:??", "number:1", "eof:",
    ])
  })

  test("самый длинный знак: === !== => ... **= >>>=", () => {
    expect(kinds("a === b !== c => ...d **= e >>>= f").filter((k) => k.startsWith("punctuator"))).toEqual([
      "punctuator:===", "punctuator:!==", "punctuator:=>", "punctuator:...", "punctuator:**=", "punctuator:>>>=",
    ])
  })

  test("?.5 — тернарный оператор и число, а не ?.", () => {
    expect(kinds("a?.5:1")).toEqual(["identifier:a", "punctuator:?", "number:.5", "punctuator::", "number:1", "eof:"])
  })

  test("числа: целые, дробные, степень, шестнадцатеричные, двоичные, с подчёркиваниями", () => {
    expect(single("42").number).toBe(42)
    expect(single("3.25").number).toBe(3.25)
    expect(single(".5").number).toBe(0.5)
    expect(single("1e3").number).toBe(1000)
    expect(single("2.5E-1").number).toBe(0.25)
    expect(single("0xff").number).toBe(255)
    expect(single("0b101").number).toBe(5)
    expect(single("0o17").number).toBe(15)
    expect(single("1_000_000").number).toBe(1000000)
  })

  test("строки: кавычки, экранирование, юникод", () => {
    expect(single(`"a\\nb"`).value).toBe("a\nb")
    expect(single(`'it\\'s'`).value).toBe("it's")
    expect(single(`"\\u0041\\x42"`).value).toBe("AB")
    expect(single(`"\\u{1F600}"`).value).toBe("\u{1F600}")
    expect(single(`"привет"`).value).toBe("привет")
  })

  test("шаблонные строки с подстановками и вложенными скобками", () => {
    expect(kinds("`a${x}b${ {y: 1}.y }c`")).toEqual([
      "template-head:a", "identifier:x", "template-middle:b", "punctuator:{", "identifier:y", "punctuator::",
      "number:1", "punctuator:}", "punctuator:.", "identifier:y", "template-tail:c", "eof:",
    ])
    expect(kinds("`просто`")).toEqual(["template:просто", "eof:"])
  })

  test("комментарии пропускаются, перевод строки отмечается", () => {
    const { tokens } = tokenize("a // коммент\n/* блок\n */ b")
    expect(tokens.length).toBe(3)
    expect(tokens[0].newlineBefore).toBe(false)
    expect(tokens[1].newlineBefore).toBe(true)
  })

  test("позиции — строки и столбцы в символах, русский текст не сдвигает", () => {
    const { tokens } = tokenize('const s = "мир"\n  x')
    // offset — в байтах (кириллица — 2 байта на букву), столбцы — в символах.
    expect(tokens[3].start).toEqual({ line: 1, column: 11, offset: 10 })
    expect(tokens[3].end).toEqual({ line: 1, column: 16, offset: 18 })
    expect(tokens[4].start).toEqual({ line: 2, column: 3, offset: 21 })
  })

  test("русские имена допустимы", () => {
    expect(kinds("const печь = 1")).toEqual(["keyword:const", "identifier:печь", "punctuator:=", "number:1", "eof:"])
  })

  test("ошибки: незакрытая строка, комментарий, шаблон; лишний символ", () => {
    expect(tokenize('"abc').diagnostics[0].code).toBe("unterminated-string")
    expect(tokenize("/* abc").diagnostics[0].code).toBe("unterminated-comment")
    expect(tokenize("`abc").diagnostics[0].code).toBe("unterminated-template")
    const bad = tokenize("a § b").diagnostics[0]
    expect(bad.code).toBe("unexpected-character")
    expect(bad.params[0]).toBe("§")
    expect(bad.column).toBe(3)
  })
})
