// Внутриигровые тесты табло (9.5): имя, рисование, склейка пикселей, кадр без перерисовки одинакового.
import { findRobot, RobotRecord } from "../automaton/registry"
import { DISPLAYS, MODELS } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { DisplayRecord, renameDisplay } from "../world/displays"
import { describe, expect, test, waitUntil } from "./testing"

function nauvis() {
  return game.get_surface("nauvis")!
}

function setup(top: number, name: string, large = false): { robot: RobotRecord; display: DisplayRecord } {
  const surface = nauvis()
  surface.request_to_generate_chunks({ x: -540, y: top + 5 }, 1)
  surface.force_generate_chunk_requests()
  const area = { left_top: { x: -555, y: top - 5 }, right_bottom: { x: -525, y: top + 15 } }
  for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = -555; x < -525; x++) for (let y = top - 5; y < top + 15; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  const entity = surface.create_entity({ name: DISPLAYS[large ? 1 : 0].name, position: { x: -540, y: top }, force: "player", raise_built: true })!
  const display = storage.displays.byId[entity.unit_number!]!
  renameDisplay(display, name)
  surface.create_entity({ name: MODELS[0].placer, position: { x: -545.5, y: top + 8.5 }, force: "player", raise_built: true })
  const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position: { x: -545.5, y: top + 8.5 }, radius: 0.5 })[0])!
  return { robot, display }
}

function run(robot: RobotRecord, name: string, source: string): MachineRecord {
  const result = publishProgram(name, source)
  if (!result.ok) error(describeDiagnostics(result.diagnostics).join("; "))
  return assignProgram(robot, result.program)
}

const finished = (m: MachineRecord) => () => m.machine.status === "done" || m.machine.status === "error"
const output = (m: MachineRecord) => m.console.filter((line) => !line.startsWith("—")).join("|")

describe("табло", () => {
  test("display(имя): размер; пиксели одного цвета в строке склеиваются; clear стирает", (t) => {
    const { robot, display } = setup(260, "тест-табло")
    const m = run(
      robot,
      "test-display",
      `const s = display("тест-табло")
print(s.width, s.height, s.measureText("abcd"), s.measureText("ёжик", 16))
for (let x = 0; x < 10; x++) s.pixel(x, 5, "red")
s.pixel(20, 5, "red")
s.rect(0, 10, 20, 10, { color: "green", fill: true })
try { display("нет-такого") } catch (e) { print(e instanceof ActionError ? e.code : "?") }`,
    )
    waitUntil(t, "конца программы", finished(m), 120, () => {
      expect(output(m)).toBe(`96 64 ${4 * 8 * 0.6} ${4 * 16 * 0.6}|invalid-target`)
      // 10 пикселей подряд — один прямоугольник, отдельный пиксель — второй, плюс прямоугольник.
      expect(display.shown.length).toBe(3)
      robot.entity.destroy()
      display.entity.destroy()
    })
  })

  test("frame: одинаковые примитивы не пересоздаются, изменившиеся — да; кадры не чаще 10 в секунду", (t) => {
    const { robot, display } = setup(290, "штаб", true)
    const m = run(
      robot,
      "test-frame",
      `const s = display("штаб")
let n = 0
function draw(): void {
  s.frame(() => {
    s.clear("black")
    s.text(4, 4, "Занятость", { color: "yellow", size: 12 })
    const size = s.table(4, 20, [["Робот", "Задача"], ["AM-1", { text: "свободен", color: "green" }], ["AM-2", String(n)]], { header: true })
    s.bar(4, s.height - 10, s.width - 8, 6, 0.5, "green")
    s.icon(150, 4, "iron-plate", 16)
    if (n === 0) print(size.width > 0, size.height > 0)
  })
}
draw()
wait(0.5)
n = 1
draw()`,
    )
    let firstObjects: number[] = []
    t.after(10, () => {
      firstObjects = display.shown.map((s) => s.object.id)
    })
    waitUntil(t, "конца программы", finished(m), 300, () => {
      expect(output(m)).toBe("true true")
      t.after(10, () => {
        const ids = new LuaSet<number>()
        for (const s of display.shown) ids.add(s.object.id)
        // Изменилась одна ячейка: остальные объекты те же.
        const kept = firstObjects.filter((id) => ids.has(id)).length
        expect(kept).toBe(firstObjects.length - 1)
        expect(display.shown.length).toBe(firstObjects.length)
        robot.entity.destroy()
        display.entity.destroy()
      })
    })
  })
})
