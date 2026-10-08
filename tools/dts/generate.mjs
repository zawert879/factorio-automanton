// Генератор automaton.d.ts (5.5): объявления API из docs/API.md (блоки ```ts с declare / type / interface).
// Пишет mod/automaton.d.ts (для игроков, VS Code) и src/gui/dts.generated.ts (окно «Типы для VS Code»,
// папка для VS Code: типы, tsconfig, утилита синхронизации mod/tools/automaton-sync.mjs, задача VS Code).
// Стартовые программы библиотеки (examples/*.ts, имя — из строки «// @program Имя») — в
// src/program/examples.generated.ts (6.4).
// С флагом --check проверяет tsc --strict, что программы-примеры из API.md и стартовые программы с этими
// типами компилируются.
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const api = readFileSync(join(root, "docs", "API.md"), "utf8")
const blocks = [...api.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1])
const declarations = blocks.filter((b) => /\bdeclare\b/.test(b) || b.startsWith("type Item"))
const examples = blocks.filter((b) => !declarations.includes(b))
// Примеры из руководства игрока — тоже программы, они должны проходить tsc.
for (const doc of [join(root, "docs", "PLAYER_GUIDE.md"), join(root, "README.md")]) {
  for (const m of readFileSync(doc, "utf8").matchAll(/```ts\n([\s\S]*?)```/g)) examples.push(m[1])
}

const header = `// Типы API автоматонов (мод Automaton для Factorio) — для редактора VS Code.
// Проще всего: в игре окно «Программы команды» → «Папка для VS Code» — мод запишет готовую папку
// (программы, этот файл, tsconfig.json, синхронизацию с игрой). Вручную:
//   1. Создайте папку, положите в неё этот файл и tsconfig.json:
//      { "compilerOptions": { "strict": true, "target": "es2020", "lib": ["es2020"], "noEmit": true, "moduleDetection": "force",
//        "module": "preserve", "moduleResolution": "bundler" } }
//   2. Пишите программу в файле .ts рядом — VS Code подскажет функции и найдёт ошибки.
//   3. Скопируйте текст программы в окно «Программы команды» в игре и нажмите «Опубликовать».
// Справка по языку и API — docs/API.md и docs/LANGUAGE.md.
`
const tsconfig = JSON.stringify(
  {
    // module / moduleResolution: import "../lib/Помощники" находит соседний файл без расширения (этап 17).
    compilerOptions: { strict: true, target: "es2020", lib: ["es2020"], noEmit: true, moduleDetection: "force", module: "preserve", moduleResolution: "bundler", types: [] },
    // Программы — в src (рядом — служебные файлы); старые файлы в корне папки не мешают.
    include: ["automaton.d.ts", "src"],
  },
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

const starters = readdirSync(join(root, "examples"))
  .filter((file) => file.endsWith(".ts"))
  .sort()
  .map((file) => {
    const source = readFileSync(join(root, "examples", file), "utf8")
    const name = /^\/\/ @program (.+)$/m.exec(source)?.[1].trim()
    if (name === undefined) throw new Error(`examples/${file}: нет строки «// @program Имя»`)
    return { file, name, source }
  })
writeFileSync(
  join(root, "src", "program", "examples.generated.ts"),
  "// Создаётся tools/dts/generate.mjs из examples/*.ts — не править руками.\n" +
    `export const STARTER_PROGRAMS: { name: string; source: string }[] = ${JSON.stringify(
      starters.map(({ name, source }) => ({ name, source })),
      null,
      2,
    )}\n`,
)

if (process.argv.includes("--check")) {
  const dir = join(tmpdir(), "automaton-dts-check")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "automaton.d.ts"), dts)
  // Каждый пример — отдельный файл; moduleDetection: force делает их модулями (одинаковые имена не мешают).
  examples.forEach((source, i) => writeFileSync(join(dir, `example${i + 1}.ts`), source))
  // Стартовые программы — по своим именам (папки — подпапки), как в папке для VS Code: так проверяются и импорты
  // (и в примерах из документации: import из "./lib/Помощники").
  for (const { name, source } of starters) {
    const path = join(dir, ...name.split("/")) + ".ts"
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, source)
  }
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...JSON.parse(tsconfig), include: ["**/*.ts"] }))
  try {
    execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(dir, "tsconfig.json")], { stdio: "pipe" })
    console.log(`automaton.d.ts: ${examples.length} примеров из API.md и руководства и ${starters.length} стартовых программ проходят tsc --strict`)
  } catch (error) {
    console.error(String(error.stdout ?? error))
    process.exit(1)
  }
}
