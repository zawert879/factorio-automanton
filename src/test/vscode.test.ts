// Окно «VS Code» (25.1): папка новой карты — map-<номер> (латиницей), путь к ней собирается из той же папки.
import { folderPath } from "../program/folderPath"
import { mapName, syncFolder } from "../program/sync"
import { describe, expect, test } from "./testing"

describe("VS Code", () => {
  test("папка новой карты — map-<номер карты>", () => {
    const seed = game.get_surface("nauvis")!.map_gen_settings.seed
    expect(mapName()).toBe(`map-${seed}`)
    expect(syncFolder("player")).toBe(`automaton/map-${seed}/player`)
    expect(folderPath("linux", syncFolder("player"))).toBe(`~/.factorio/script-output/automaton/map-${seed}/player`)
  })
})
