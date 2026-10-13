// Связь с утилитой синхронизации (25.2): что показывает окно «VS Code» по времени последнего запроса и записи папки.
import { describe, expect, test } from "../../src/test/testing"
import { CONTACT_TICKS, linkStatus, SILENT_TICKS } from "../../src/program/vscodeState"

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
