// npm run test:game: прогнать внутриигровые тесты (src/test/*.test.ts) в Factorio без окна.
// 6200 тиков — с запасом к пределу DEADLINE_TICK = 6000 в src/test/runner.ts.
// Служебный мод automaton-test включает их в control.ts; итог — script-output/automaton-test-results.json.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, runFactorio, scriptError } from "./factorio.mjs"

buildMod()
const env = prepareWork("automaton-test-game", "automaton-test")
const resultsFile = join(env.data, "script-output", "automaton-test-results.json")

const create = createMap(env)
const bench = create.status === 0 ? runFactorio([...env.common, "--benchmark", env.map, "--benchmark-ticks", "6200"]) : create

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
