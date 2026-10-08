// Генератор automaton.d.ts (5.5): объявления API из docs/API.md (блоки ```ts с declare / type / interface).
// Пишет mod/automaton.d.ts (для игроков, VS Code) и src/gui/dts.generated.ts (окно «Типы для VS Code»,
// папка для VS Code: типы, tsconfig, утилита синхронизации mod/tools/automaton-sync.mjs, задача VS Code).
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
// Проще всего: в игре окно «Программы команды» → «Папка для VS Code» — мод запишет готовую папку
// (программы, этот файл, tsconfig.json, синхронизацию с игрой). Вручную:
//   1. Создайте папку, положите в неё этот файл и tsconfig.json:
//      { "compilerOptions": { "strict": true, "target": "es2020", "lib": ["es2020"], "noEmit": true, "moduleDetection": "force" } }
//   2. Пишите программу в файле .ts рядом — VS Code подскажет функции и найдёт ошибки.
//   3. Скопируйте текст программы в окно «Программы команды» в игре и нажмите «Опубликовать».
// Справка по языку и API — docs/API.md и docs/LANGUAGE.md.
`
const tsconfig = JSON.stringify(
  { compilerOptions: { strict: true, target: "es2020", lib: ["es2020"], noEmit: true, moduleDetection: "force", types: [] } },
  null,
  2,
)
const tool = readFileSync(join(root, "mod", "tools", "automaton-sync.mjs"), "utf8")
const dts = header + "\n" + declarations.join("\n")
writeFileSync(join(root, "mod", "automaton.d.ts"), dts)
writeFileSync(
  join(root, "src", "gui", "dts.generated.ts"),
  "// Создаётся tools/dts/generate.mjs из docs/API.md — не править руками.\n" +
    `export const DTS = ${JSON.stringify(dts)}\n` +
    `export const TSCONFIG = ${JSON.stringify(tsconfig)}\n` +
    `export const SYNC_TOOL = ${JSON.stringify(tool)}\n`,
)

if (process.argv.includes("--check")) {
  const dir = join(tmpdir(), "automaton-dts-check")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "automaton.d.ts"), dts)
  // Каждый пример — отдельный файл; moduleDetection: force делает их модулями (одинаковые имена не мешают).
  examples.forEach((source, i) => writeFileSync(join(dir, `example${i + 1}.ts`), source))
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...JSON.parse(tsconfig), include: ["*.ts"] }))
  try {
    execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(dir, "tsconfig.json")], { stdio: "pipe" })
    console.log(`automaton.d.ts: ${examples.length} примеров из API.md проходят tsc --strict`)
  } catch (error) {
    console.error(String(error.stdout ?? error))
    process.exit(1)
  }
}
