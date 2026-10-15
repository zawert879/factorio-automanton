// Связь с утилитой синхронизации (25.2): что показывает окно «VS Code» по времени последнего запроса и записи папки;
// подсветка ошибок языка (25.3): шаг «Включить подсветку» по ответам утилиты.
import { describe, expect, test } from "../../src/test/testing"
import { CONTACT_TICKS, linkStatus, PLUGIN_SETUP_TICKS, pluginStatus, SILENT_TICKS } from "../../src/program/vscodeState"

describe("связь с VS Code", () => {
  test("на связи, другая карта, пропала, ждём, молчит, ничего", () => {
    expect(linkStatus({ contact: 1000, contactMap: "map-1" }, 1000 + CONTACT_TICKS - 1, "map-1")).toBe("connected")
    // Старая утилита без карты в запросе — тоже на связи.
    expect(linkStatus({ contact: 1000 }, 1500, "map-1")).toBe("connected")
    expect(linkStatus({ contact: 1000, contactMap: "map-2" }, 1500, "map-1")).toBe("wrong-map")
    expect(linkStatus({ contact: 1000, written: 900 }, 1000 + CONTACT_TICKS, "map-1")).toBe("lost")
    expect(linkStatus({ written: 900 }, 900 + SILENT_TICKS - 1, "map-1")).toBe("waiting")
    expect(linkStatus({ written: 900 }, 900 + SILENT_TICKS, "map-1")).toBe("silent")
    expect(linkStatus({}, 5000, "map-1")).toBe("none")
  })
})

describe("подсветка ошибок языка", () => {
  test("работает, ждём, путь есть, утилита молчит, не вышло, ничего", () => {
    expect(pluginStatus({}, 100)).toBe("none")
    expect(pluginStatus({ plugin: "none" }, 100)).toBe("none")
    expect(pluginStatus({ pluginSetup: { tick: 100 } }, 100 + PLUGIN_SETUP_TICKS - 1)).toBe("pending")
    expect(pluginStatus({ pluginSetup: { tick: 100 } }, 100 + PLUGIN_SETUP_TICKS)).toBe("silent")
    expect(pluginStatus({ pluginSetup: { tick: 100, result: "added" } }, 200)).toBe("set")
    expect(pluginStatus({ pluginSetup: { tick: 100, result: "already" } }, 200)).toBe("set")
    // Путь дописали руками: утилита сообщает в ping.
    expect(pluginStatus({ plugin: "set" }, 200)).toBe("set")
    expect(pluginStatus({ plugin: "set", pluginSetup: { tick: 100 } }, 100 + PLUGIN_SETUP_TICKS)).toBe("set")
    expect(pluginStatus({ pluginSetup: { tick: 100, result: "failed", error: "parse" } }, 200)).toBe("failed")
    // VS Code загрузил плагин — главнее всего.
    expect(pluginStatus({ plugin: "loaded", pluginSetup: { tick: 100, result: "failed" } }, 200)).toBe("loaded")
    expect(pluginStatus({ plugin: "loaded", pluginSetup: { tick: 100 } }, 101)).toBe("loaded")
  })
})
