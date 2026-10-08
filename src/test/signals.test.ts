// Внутриигровые тесты сигналов цепей (9.6): сигнальная метка, write / read / readAll по проводам.
import { LuaConstantCombinatorControlBehavior } from "factorio:runtime"
import { findRobot } from "../automaton/registry"
import { MARKER, MODELS, SIGNAL_MARKER } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram } from "../program/machines"
import { publishProgram } from "../program/store"
import { markerOf, renameMarker } from "../world/markers"
import { describe, expect, test, waitUntil } from "./testing"

describe("сигналы цепей", () => {
  test("write выставляет сигналы метки; read/readAll читают всю сеть; простая метка — invalid-target", (t) => {
    const surface = game.get_surface("nauvis")!
    surface.request_to_generate_chunks({ x: -580, y: 300 }, 1)
    surface.force_generate_chunk_requests()
    const area = { left_top: { x: -590, y: 290 }, right_bottom: { x: -570, y: 310 } }
    for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
    const tiles = []
    for (let x = -590; x < -570; x++) for (let y = 290; y < 310; y++) tiles.push({ name: "grass-1", position: { x, y } })
    surface.set_tiles(tiles, true, true, true)

    const signal = surface.create_entity({ name: SIGNAL_MARKER, position: { x: -580.5, y: 300.5 }, force: "player", raise_built: true })!
    renameMarker(markerOf(signal)!, "пульт")
    const plain = surface.create_entity({ name: MARKER, position: { x: -583.5, y: 300.5 }, force: "player", raise_built: true })!
    renameMarker(markerOf(plain)!, "простая")
    // Соседний комбинатор с сигналом A = 5 — на том же красном проводе.
    const other = surface.create_entity({ name: "constant-combinator", position: { x: -578.5, y: 300.5 }, force: "player" })!
    const behavior = other.get_or_create_control_behavior() as LuaConstantCombinatorControlBehavior
    behavior.get_section(1)!.filters = [{ value: { type: "virtual", name: "signal-A", quality: "normal", comparator: "=" }, min: 5 }]
    signal.get_wire_connector(defines.wire_connector_id.circuit_red, true)!.connect_to(other.get_wire_connector(defines.wire_connector_id.circuit_red, true)!)

    surface.create_entity({ name: MODELS[0].placer, position: { x: -581.5, y: 303.5 }, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position: { x: -581.5, y: 303.5 }, radius: 0.5 })[0])!
    const result = publishProgram(
      "test-signals",
      `const m = marker("пульт")
signals.write(m, { "signal-A": 2, "iron-plate": 10 })
wait(0.1)
const all = signals.readAll(m)
print(signals.read(m, "signal-A"), all["iron-plate"], all["signal-B"] ?? 0)
try { signals.read(marker("простая"), "signal-A") } catch (e) { print(e instanceof ActionError ? e.code : "?") }`,
    )
    if (!result.ok) error(describeDiagnostics(result.diagnostics).join("; "))
    const m = assignProgram(robot, result.program)
    waitUntil(t, "конца программы", () => m.machine.status === "done" || m.machine.status === "error", 120, () => {
      expect(m.console.filter((line) => !line.startsWith("—")).join("|")).toBe("7 10 0|invalid-target")
      robot.entity.destroy()
      signal.destroy()
      plain.destroy()
      other.destroy()
    })
  })
})
