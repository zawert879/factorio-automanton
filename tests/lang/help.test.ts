// Данные справки в игре (18.5): собраны из docs/API.md на двух языках (tools/dts/generate.mjs).
import { FIRST_PROGRAM, HELP } from "../../src/gui/help.generated"
import { compile } from "../../src/lang/codegen"
import { describe, expect, test } from "../../src/test/testing"

/** Кириллица в UTF-8: первые байты 0xD0, 0xD1 (в TSTL строки — байты). */
const CYRILLIC = { test: (s: string) => string.find(s, `[${string.char(0xd0)}${string.char(0xd1)}]`)[0] !== undefined }

describe("справка", () => {
  test("разделы и записи: имена, объявления и описания на двух языках", () => {
    expect(HELP.length >= 15).toBe(true)
    const names: string[] = []
    for (const section of HELP) {
      expect(section.title[1] !== section.title[0]).toBe(true)
      for (const entry of section.entries) {
        names.push(entry.name)
        expect(entry.signature[0].includes(entry.name) && entry.signature[1].includes(entry.name)).toBe(true)
        // Есть русское описание — есть и английское (и в нём нет кириллицы).
        if (entry.doc[0] !== "") expect(`${entry.name}: ${entry.doc[1] !== "" && !CYRILLIC.test(entry.doc[1])}`).toBe(`${entry.name}: true`)
      }
    }
    for (const name of ["mine", "move", "scan", "publish", "display", "ActionError"]) expect(names.includes(name)).toBe(true)
  })

  test("примеры разделов и первая программа компилируются", () => {
    // Импортов в примерах нет; программа с ошибкой — не пример.
    for (const source of [FIRST_PROGRAM, ...HELP.filter((s) => s.example !== undefined).map((s) => s.example!)]) {
      const result = compile(source, { name: "пример" })
      expect(`${source.split("\n")[0]}: ${result.ok}`).toBe(`${source.split("\n")[0]}: true`)
    }
    expect(HELP.filter((s) => s.example === undefined).map((s) => s.title[0])).toEqual(["Базовые типы"])
  })
})
