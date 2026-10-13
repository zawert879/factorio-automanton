// Путь к папке для VS Code (25.1): папка данных игры своей системы + script-output; в Windows — обратные косые.
import { describe, expect, test } from "../../src/test/testing"
import { folderPath } from "../../src/program/folderPath"

describe("путь к папке VS Code", () => {
  test("для каждой системы — своя папка данных игры", () => {
    expect(folderPath("windows", "automaton/map-42/player")).toBe("%APPDATA%\\Factorio\\script-output\\automaton\\map-42\\player")
    expect(folderPath("macos", "automaton/map-42/player")).toBe("~/Library/Application Support/factorio/script-output/automaton/map-42/player")
    expect(folderPath("linux", "automaton/map-42/player")).toBe("~/.factorio/script-output/automaton/map-42/player")
  })
})
