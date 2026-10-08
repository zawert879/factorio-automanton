// npm run bench:game: бенчмарк языка (src/test/langBench.ts) в Lua Factorio без окна.
// Для каждого варианта — лучшее из трёх замеров и отношение к обычному Lua.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, runFactorio, scriptError } from "../test/factorio.mjs"

buildMod()
const env = prepareWork("automaton-bench-lang", "automaton-bench")
const create = createMap(env)
const run = create.status === 0 ? runFactorio([...env.common, "--benchmark", env.map, "--benchmark-ticks", "2"]) : create
const log = readFileSync(join(env.data, "factorio-current.log"), "utf8")
const best = new Map()
for (const match of log.matchAll(/BENCH (.+?): Duration: ([\d.]+)ms/g)) {
  const [, label, ms] = match
  best.set(label, Math.min(best.get(label) ?? Infinity, Number(ms)))
}
if (best.size === 0) {
  console.error(`Нет замеров (код ${run.status}):\n${scriptError(run.stdout)}`)
  process.exit(1)
}
let base = 1
for (const [label, ms] of best) {
  if (label.endsWith("| Lua")) base = ms
  console.log(`${label.padEnd(70)} ${ms.toFixed(2).padStart(8)} мс  ${(ms / base).toFixed(2)}×`)
}
