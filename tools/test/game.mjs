// npm run test:game: прогнать внутриигровые тесты (src/test/) в Factorio без окна.
// Своя папка данных и модов во временной папке — открытой игре не мешает.
// Мод automaton-test включает тесты в control.ts; mod-list.json создаётся здесь, не в репозитории.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const factorio =
  process.env.FACTORIO_BIN ??
  join(homedir(), "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")
const work = join(tmpdir(), "automaton-test-game")
const mods = join(work, "mods")
const data = join(work, "data")
const resultsFile = join(data, "script-output", "automaton-test-results.json")

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts })
  if (r.error) throw r.error
  return r
}

const build = run("npm", ["run", "build", "--silent"], { cwd: root, stdio: "inherit" })
if (build.status !== 0) process.exit(build.status ?? 1)

rmSync(work, { recursive: true, force: true })
mkdirSync(join(mods, "automaton-test"), { recursive: true })
mkdirSync(data, { recursive: true })
symlinkSync(join(root, "mod"), join(mods, "automaton"))
writeFileSync(
  join(mods, "automaton-test", "info.json"),
  JSON.stringify({
    name: "automaton-test",
    version: "0.0.1",
    title: "Automaton tests",
    author: "automaton",
    factorio_version: "2.0",
    dependencies: ["automaton"],
  }),
)
writeFileSync(
  join(mods, "mod-list.json"),
  JSON.stringify({ mods: ["base", "automaton", "automaton-test"].map((name) => ({ name, enabled: true })) }),
)
writeFileSync(join(work, "config.ini"), `[path]\nread-data=__PATH__system-read-data__\nwrite-data=${data}\n`)
writeFileSync(
  join(work, "map-gen.json"),
  JSON.stringify({ seed: 1, autoplace_controls: { "enemy-base": { frequency: 0, size: 0, richness: 0 } } }),
)

const common = ["--config", join(work, "config.ini"), "--mod-directory", mods]
const create = run(factorio, [...common, "--map-gen-settings", join(work, "map-gen.json"), "--create", join(work, "map.zip")])
const bench = create.status === 0
  ? run(factorio, [...common, "--benchmark", join(work, "map.zip"), "--benchmark-ticks", "5", "--disable-audio"])
  : create

// Ошибки скриптов Factorio печатает в stdout (в factorio-current.log их нет): блок «Error…» со стеком.
function scriptError(output) {
  const lines = output.split("\n")
  const start = lines.findIndex((line) => line.startsWith("Error"))
  if (start < 0) return lines.slice(-20).join("\n")
  const end = lines.findIndex((line, i) => i > start && /^\s+\d+\.\d+ /.test(line))
  return lines.slice(start, end < 0 ? undefined : end).join("\n")
}

if (!existsSync(resultsFile)) {
  console.error(`Игра не выдала результатов тестов (код ${bench.status}):\n${scriptError(bench.stdout)}`)
  process.exit(1)
}

const results = JSON.parse(readFileSync(resultsFile, "utf8"))
for (const r of results) {
  if (!r.ok) console.log(`✗ ${r.name}\n    ${r.error}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\nв игре — пройдено: ${results.length - failed}, упало: ${failed}`)
if (results.length === 0) {
  console.error("Тесты не найдены: проверь src/test/index.ts")
  process.exit(1)
}
process.exit(failed === 0 ? 0 : 1)
