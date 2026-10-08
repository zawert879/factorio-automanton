// Генератор automaton.d.ts (5.5): объявления API из docs/API.md (блоки ```ts с declare / type / interface).
// Пишет mod/automaton.d.ts (для игроков, VS Code) и src/gui/dts.generated.ts (окно «Типы для VS Code»).
// С флагом --check проверяет tsc --strict, что программы-примеры из API.md с этими типами компилируются.
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const api = readFileSync(join(root, "docs", "API.md"), "utf8")
const blocks = [...api.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1])
const declarations = blocks.filter((b) => /\bdeclare\b/.test(b) || b.startsWith("type Item"))
const examples = blocks.filter((b) => !declarations.includes(b))

const header = `// Типы API автоматонов (мод Automaton для Factorio) — для редактора VS Code.
// Как писать программы в VS Code:
//   1. Создайте папку, положите в неё этот файл и tsconfig.json:
//      { "compilerOptions": { "strict": true, "target": "es2020", "lib": ["es2020"], "noEmit": true } }
//   2. Пишите программу в файле .ts рядом — VS Code подскажет функции и найдёт ошибки.
//   3. Скопируйте текст программы в окно «Программы команды» в игре и нажмите «Опубликовать».
// Справка по языку и API — docs/API.md и docs/LANGUAGE.md.
`
const dts = header + "\n" + declarations.join("\n")
writeFileSync(join(root, "mod", "automaton.d.ts"), dts)
writeFileSync(
  join(root, "src", "gui", "dts.generated.ts"),
  "// Создаётся tools/dts/generate.mjs из docs/API.md — не править руками.\n" + `export const DTS = ${JSON.stringify(dts)}\n`,
)

if (process.argv.includes("--check")) {
  const dir = join(tmpdir(), "automaton-dts-check")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "automaton.d.ts"), dts)
  examples.forEach((source, i) => writeFileSync(join(dir, `example${i + 1}.ts`), source + "\nexport {}\n"))
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, target: "es2020", lib: ["es2020"], noEmit: true, types: [] }, include: ["*.ts"] }),
  )
  try {
    execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(dir, "tsconfig.json")], { stdio: "pipe" })
    console.log(`automaton.d.ts: ${examples.length} примеров из API.md проходят tsc --strict`)
  } catch (error) {
    console.error(String(error.stdout ?? error))
    process.exit(1)
  }
}
