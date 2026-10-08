// npm run bench:machines [N]: стресс-тест машин с программами (13.5) без окна. Два прогона на одной карте:
// без машин и с N рабочими (по умолчанию 300) по программе толпы (src/test/machinesBench.ts).
// Время тика — из --benchmark-verbose, среднее по тикам после расстановки и разгона.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, runFactorio, scriptError } from "../test/factorio.mjs"

const N = Number(process.argv[2] ?? 300)
const TICKS = 1800
const SKIP = 300

function run(count) {
  const env = prepareWork(`automaton-bench-machines-${count}`, "automaton-bench-machines", `0.${count}.0`)
  const create = createMap(env)
  if (create.status !== 0) throw new Error(scriptError(create.stdout))
  const result = runFactorio([...env.common, "--benchmark", env.map, "--benchmark-ticks", String(TICKS), "--benchmark-verbose", "wholeUpdate"])
  const ticks = []
  for (const line of result.stdout.split("\n")) {
    const m = /^t(\d+),(\d+)/.exec(line.trim())
    if (m) ticks.push({ tick: Number(m[1]), ns: Number(m[2]) })
  }
  if (ticks.length === 0) throw new Error(`нет замеров:\n${scriptError(result.stdout)}`)
  const measured = ticks.filter((t) => t.tick > SKIP)
  const avg = measured.reduce((sum, t) => sum + t.ns, 0) / measured.length / 1e6
  const max = Math.max(...measured.map((t) => t.ns)) / 1e6
  const log = readFileSync(join(env.data, "factorio-current.log"), "utf8")
  const notes = [...log.matchAll(/MACHINES: (.+)/g)].map((m) => m[1]).join("; ")
  return { avg, max, notes }
}

buildMod()
const base = run(0)
const loaded = run(N)
console.log(`без машин:       ${base.avg.toFixed(3)} мс/тик (макс. ${base.max.toFixed(2)})`)
console.log(`${N} машин: ${loaded.avg.toFixed(3)} мс/тик (макс. ${loaded.max.toFixed(2)}) — ${loaded.notes}`)
console.log(`прирост: ${(loaded.avg - base.avg).toFixed(3)} мс/тик (для сравнения: тик игры — 16.7 мс)`)
