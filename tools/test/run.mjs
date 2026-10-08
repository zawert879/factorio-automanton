// npm test [фильтр]: собрать тесты TypeScriptToLua и прогнать их в Lua 5.2.
// Фильтр — подстрока в пути файла теста (например, `npm test -- lexer`).
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const lua = join(root, "tools", "lua", "5.2", "bin", "lua")
const buildDir = join(root, "build")
const filter = process.argv[2] ?? ""

if (!existsSync(lua)) {
  execFileSync(join(root, "tools", "lua", "build.sh"), { stdio: "inherit" })
}

// Примеры программ из документации — в тесты (их разбор и компиляция проверяются).
generateExamples()

// TSTL не удаляет устаревшие файлы: без чистки удалённый тест продолжал бы запускаться
rmSync(buildDir, { recursive: true, force: true })
const tstl = spawnSync(join(root, "node_modules", ".bin", "tstl"), ["-p", join("tests", "tsconfig.json")], {
  cwd: root,
  stdio: "inherit",
})
if (tstl.status !== 0) process.exit(tstl.status ?? 1)
// npm run bench:lang: только сборка (бенчмарк запускается отдельно).
if (filter === "--build-only") process.exit(0)

/**
 * tests/lang/examples.generated.ts: программы из блоков ```ts в docs/API.md и docs/language-samples/3-typescript.md
 * (без блоков с объявлениями declare — это описание API, а не программы).
 */
function generateExamples() {
  const examples = []
  for (const file of ["docs/API.md", "docs/language-samples/3-typescript.md"]) {
    const text = readFileSync(join(root, file), "utf8")
    let index = 0
    for (const match of text.matchAll(/```ts\n([\s\S]*?)```/g)) {
      index++
      if (/\bdeclare\b/.test(match[1]) || match[1].startsWith("type Item")) continue
      examples.push({ name: `${file} #${index}`, source: match[1] })
    }
  }
  writeFileSync(
    join(root, "tests", "lang", "examples.generated.ts"),
    "// Создаётся tools/test/run.mjs из документации — не править руками.\n" +
      `export const EXAMPLES: { name: string; source: string }[] = ${JSON.stringify(examples, null, 2)}\n`,
  )
}

function findTests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return findTests(path)
    return entry.name.endsWith("_test.lua") ? [path] : [] // TSTL переименовывает x.test.ts в x_test.lua
  })
}

const modules = findTests(join(buildDir, "tests"))
  .filter((path) => path.includes(filter))
  .map((path) => relative(buildDir, path).replace(/\.lua$/, "").split(sep).join("."))

if (modules.length === 0) {
  console.error(`Тесты не найдены${filter ? ` по фильтру «${filter}»` : ""}`)
  process.exit(1)
}

const run = spawnSync(lua, [join(root, "tools", "test", "runner.lua"), buildDir, ...modules], {
  stdio: "inherit",
})
process.exit(run.status ?? 1)
