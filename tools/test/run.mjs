// npm test [фильтр]: собрать тесты TypeScriptToLua и прогнать их в Lua 5.2.
// Фильтр — подстрока в пути файла теста (например, `npm test -- lexer`).
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readdirSync, rmSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const lua = join(root, "tools", "lua", "5.2", "bin", "lua")
const buildDir = join(root, "build")
const filter = process.argv[2] ?? ""

if (!existsSync(lua)) {
  execFileSync(join(root, "tools", "lua", "build.sh"), { stdio: "inherit" })
}

// TSTL не удаляет устаревшие файлы: без чистки удалённый тест продолжал бы запускаться
rmSync(buildDir, { recursive: true, force: true })
const tstl = spawnSync(join(root, "node_modules", ".bin", "tstl"), ["-p", join("tests", "tsconfig.json")], {
  cwd: root,
  stdio: "inherit",
})
if (tstl.status !== 0) process.exit(tstl.status ?? 1)

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
