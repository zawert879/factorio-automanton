// Модули команды (17.2): публикация с импортом программ команды, пересборка зависимых, отставшая
// сборка, запрет удаления используемой библиотеки, переименование с правкой импортов, библиотека на машине.
import { findRobot, RobotRecord } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { copySettings, pasteSettings, stopRobots } from "../gui/assignTools"
import { programTree } from "../gui/tree"
import { assignProgram, machineOf } from "../program/machines"
import { deleteProgram, findProgram, normalizeProgramName, programsOf, publish } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

function robotAt(x: number, y: number): RobotRecord {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x, y }, 1)
  surface.force_generate_chunk_requests()
  const area = { left_top: { x: x - 2, y: y - 2 }, right_bottom: { x: x + 3, y: y + 3 } }
  for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let tx = x - 2; tx < x + 3; tx++) for (let ty = y - 2; ty < y + 3; ty++) tiles.push({ name: "grass-1", position: { x: tx, y: ty } })
  surface.set_tiles(tiles, true, true, true)
  const position = { x: math.floor(x) + 0.5, y: math.floor(y) + 0.5 }
  surface.create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(surface.find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

function published(name: string, source: string, id?: number) {
  const result = publish({ name, source, id })
  if (!result.ok) error(`${name} не опубликована: ${serpent.line(result.diagnostics)}`)
  return result
}

function cleanup(...names: string[]): void {
  // Сначала зависимые: используемую библиотеку удалить нельзя.
  for (const name of names) {
    const program = findProgram(name)
    if (program !== undefined) deleteProgram(program.id)
  }
}

describe("модули команды", () => {
  test("имена с папками", () => {
    expect(normalizeProgramName(" Логистика / Перевозчик ")).toBe("Логистика/Перевозчик")
    // Буквы, которые портил s.trim() TSTL (концы л, п, Р — байты BB, BF, A0).
    expect(normalizeProgramName("lib/Котёл ")).toBe("lib/Котёл")
    expect(normalizeProgramName("Суп/ВЕТЕР")).toBe("Суп/ВЕТЕР")
    expect(normalizeProgramName("a//b")).toBe(undefined)
    expect(normalizeProgramName("../x")).toBe(undefined)
    expect(normalizeProgramName("a/")).toBe(undefined)
  })

  test("импорт программы команды; библиотека, зависимости и строки модулей", () => {
    const lib = published("m-lib/Счёт", `export function twice(x: number): number {\n  return x * 2\n}`).program
    expect(lib.library).toBe(true)
    const user = published("m-app/Главная", `import { twice } from "../m-lib/Счёт"\nprint(twice(21))`).program
    expect(user.library).toBe(false)
    expect(user.dependencies).toEqual(["m-lib/Счёт"])
    expect(user.modules).toEqual(["m-app/Главная", "m-lib/Счёт"])
    cleanup("m-app/Главная", "m-lib/Счёт")
  })

  test("новая версия библиотеки пересобирает зависимые и перезапускает их машины", (t) => {
    const robot = robotAt(-1300, 140)
    published("m2/lib", `export const STEP = 1`)
    const app = published("m2/app", `import { STEP } from "./lib"\nwhile (true) {\n  print("шаг", STEP)\n  wait(1)\n}`).program
    const record = assignProgram(robot, app)
    waitUntil(t, "первого шага", () => record.console.some((l) => l === "шаг 1"), 120, () => {
      const result = published("m2/lib", `export const STEP = 2`)
      expect(result.rebuilt).toEqual(["m2/app"])
      expect(app.version).toBe(2)
      expect(app.history[1].rebuiltFor).toBe("m2/lib")
      waitUntil(t, "шага с новой версией", () => record.console.some((l) => l === "шаг 2"), 120, () => {
        // Сломать зависимую: она остаётся на прежней сборке с предупреждением.
        const broken = published("m2/lib", `export const OTHER = 3`)
        expect(broken.stale).toEqual(["m2/app"])
        expect(app.version).toBe(2)
        expect(app.stale?.module).toBe("m2/lib")
        expect(app.stale?.diagnostics[0].code).toBe("no-export")
        // Используемую библиотеку удалить нельзя.
        const lib = findProgram("m2/lib")!
        const deleted = deleteProgram(lib.id)
        expect(deleted.ok).toBe(false)
        if (!deleted.ok) expect(deleted.usedBy).toEqual(["m2/app"])
        // Починили — снова собирается, предупреждения нет.
        published("m2/lib", `export const STEP = 3\nexport const OTHER = 3`)
        expect(app.version).toBe(3)
        expect(app.stale).toBe(undefined)
        robot.entity.destroy()
        cleanup("m2/app", "m2/lib")
      })
    })
  })

  test("переименование библиотеки правит импорты зависимых; переезд программы — её импорты", () => {
    const lib = published("m3/lib/Старое", `export const X = 1`).program
    const a = published("m3/a", `import { X } from "./lib/Старое"\nprint(X)`).program
    const b = published("m3/deep/b", `import * as L from "../lib/Старое"\nprint(L.X)`).program
    const renamed = published("m3/common/Новое", lib.source, lib.id)
    expect(renamed.rebuilt?.length).toBe(2)
    expect(a.source).toBe(`import { X } from "./common/Новое"\nprint(X)`)
    expect(b.source).toBe(`import * as L from "../common/Новое"\nprint(L.X)`)
    expect(a.dependencies).toEqual(["m3/common/Новое"])
    // Программа переехала в другую папку: её путь импорта пересчитан.
    published("m3/x/y/a", a.source, a.id)
    expect(a.source).toBe(`import { X } from "../../common/Новое"\nprint(X)`)
    cleanup("m3/x/y/a", "m3/deep/b", "m3/common/Новое")
  })

  test("библиотеку нельзя запустить на машине", () => {
    const robot = robotAt(-1330, 140)
    const lib = published("m4/lib", `export function f(): number {\n  return 1\n}`).program
    const record = assignProgram(robot, lib)
    expect(record.machine.status).toBe("done")
    expect(record.console[record.console.length - 1].includes("библиотека")).toBe(true)
    // Стала программой (есть код) — запускается.
    published("m4/lib", `export function f(): number {\n  return 1\n}\nwhile (true) wait(1)`)
    expect(record.machine.status).toBe("ready")
    robot.entity.destroy()
    cleanup("m4/lib")
  })

  test("копирование настроек: программа и параметры, библиотеку не вставить, остановка рамкой", () => {
    const a = robotAt(-1360, 140)
    const b = robotAt(-1366, 140)
    const program = published("m5/работа", `const { n } = me.args<{ n: number }>()\nwhile (true) wait(n)`).program
    expect(copySettings(99, a)).toBe(undefined)
    machineOf(a.id).args = { n: 3, route: { item: "coal" } }
    assignProgram(a, program)
    expect(copySettings(99, a)).toBe("m5/работа")
    expect(pasteSettings(99, b)).toBe("m5/работа")
    const copied = machineOf(b.id)
    expect(copied.programId).toBe(program.id)
    expect((copied.args as { route: { item: string } }).route.item).toBe("coal")
    // Копия, а не та же таблица.
    ;(machineOf(a.id).args as { n: number }).n = 5
    expect((copied.args as { n: number }).n).toBe(3)
    // Программа стала библиотекой — вставлять нечего.
    published("m5/работа", `export const n = 1`)
    expect(pasteSettings(99, b)).toBe(undefined)
    published("m5/работа", `while (true) wait(1)`)
    expect(stopRobots([a, b])).toBe(2)
    expect(machineOf(a.id).machine.status).toBe("done")
    a.entity.destroy()
    b.entity.destroy()
    storage.clipboard![99] = undefined
    cleanup("m5/работа")
  })

  test("дерево программ: папки первыми, поиск без учёта регистра", () => {
    published("m6/Б/Вторая", `print(2)`)
    published("m6/Первая", `print(1)`)
    const ours = programsOf("player").filter((p) => p.name.startsWith("m6/"))
    const rows = programTree(ours, "")
    expect(rows.map((r) => `${r.indent}${r.short}`).join("|")).toBe("m6|    Б|        Вторая|    Первая")
    expect(programTree(ours, "ВТОР").filter((r) => r.program !== undefined).map((r) => r.short).join(",")).toBe("Вторая")
    expect(programTree(ours, "", { "m6/Б": true }).map((r) => r.short).join(",")).toBe("m6,Б,Первая")
    cleanup("m6/Б/Вторая", "m6/Первая")
  })
})
