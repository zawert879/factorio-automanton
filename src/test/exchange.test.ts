// Обмен программами строкой (18.3): строка туда и обратно, ошибки строки, план импорта, выбор у совпадающих,
// модули — раньше программ, которые их импортируют.
import { applyImport, decodePrograms, exportPrograms, planImport, withDependencies } from "../program/exchange"
import { deleteProgram, findProgram, publish } from "../program/store"
import { describe, expect, test } from "./testing"

const LIB = "export function twice(x: number): number {\n  return x * 2\n}"
const MAIN = 'import { twice } from "./lib"\nprint(twice(2))'

function published(name: string, source: string) {
  const result = publish({ name, source })
  if (!result.ok) error(`${name} не опубликована: ${serpent.line(result.diagnostics)}`)
  return result.program
}

/** Удалить программы (зависимые — первыми: используемую библиотеку удалить нельзя). */
function cleanup(...names: string[]): void {
  for (const name of names) {
    const program = findProgram(name)
    if (program !== undefined) deleteProgram(program.id)
  }
}

describe("обмен программами", () => {
  test("строка: программа с модулями туда и обратно", () => {
    cleanup("ex/main", "ex/lib")
    const lib = published("ex/lib", LIB)
    const main = published("ex/main", MAIN)
    const set = withDependencies([main], "player")
    expect(set.map((p) => p.name)).toEqual(["ex/lib", "ex/main"])
    const text = exportPrograms(set)
    expect(text.startsWith("am1:")).toBe(true)
    const decoded = decodePrograms(`  ${text}\n`)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.programs).toEqual([{ name: lib.name, source: LIB }, { name: main.name, source: MAIN }])
    cleanup("ex/main", "ex/lib")
  })

  test("не та строка, битая строка", () => {
    const error = (text: string) => {
      const decoded = decodePrograms(text)
      return decoded.ok ? "ok" : decoded.error
    }
    expect(error("")).toBe("import-empty")
    expect(error("0eNqVkd")).toBe("import-not-programs")
    expect(error("am1:@@@")).toBe("import-broken")
    expect(error(`am1:${helpers.encode_string(helpers.table_to_json({ v: 2, programs: [] }))}`)).toBe("import-broken")
  })

  test("импорт: новая, та же, другой текст — заменить, рядом, пропустить", () => {
    cleanup("ex/main", "ex/main (2)", "ex/lib", "ex/new")
    published("ex/lib", LIB)
    const version = published("ex/main", MAIN).version
    const changed = 'import { twice } from "./lib"\nprint(twice(5))'
    const programs = [
      { name: "ex/lib", source: LIB },
      { name: "ex/main", source: changed },
      { name: "ex/new", source: "print(1)" },
    ]
    const plan = planImport(programs, "player")
    expect(plan.map((i) => i.status)).toEqual(["same", "conflict", "new"])

    const skip = applyImport(plan, { "ex/main": "skip" }, "player")
    expect(skip.published).toEqual(["ex/new"])
    expect(skip.skipped).toEqual(["ex/lib", "ex/main"])
    expect(findProgram("ex/main")!.version).toBe(version)

    const rename = applyImport(planImport(programs, "player"), { "ex/main": "rename" }, "player")
    expect(rename.published).toEqual(["ex/main (2)"])
    expect(findProgram("ex/main (2)")!.source).toBe(changed)

    const replace = applyImport(planImport(programs, "player"), {}, "player")
    expect(replace.published).toEqual(["ex/main"])
    expect(findProgram("ex/main")!.version).toBe(version + 1)
    expect(findProgram("ex/main")!.source).toBe(changed)
    cleanup("ex/main", "ex/main (2)", "ex/lib", "ex/new")
  })

  test("модуль из той же строки публикуется раньше программы, которая его импортирует", () => {
    cleanup("ex2/main", "ex2/lib")
    const programs = [
      { name: "ex2/main", source: MAIN },
      { name: "ex2/lib", source: LIB },
    ]
    const result = applyImport(planImport(programs, "player"), {}, "player")
    expect(result.failed.length).toBe(0)
    expect(result.published).toEqual(["ex2/lib", "ex2/main"])
    // Модуля нет ни у команды, ни в строке — программа не публикуется, ошибка — её.
    const broken = applyImport(planImport([{ name: "ex2/broken", source: 'import { x } from "./нет"' }], "player"), {}, "player")
    expect(broken.failed.map((f) => `${f.name}: ${f.diagnostics[0]?.code}`)).toEqual(["ex2/broken: unknown-module"])
    cleanup("ex2/main", "ex2/lib")
  })
})
