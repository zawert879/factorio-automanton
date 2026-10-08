// npm run bench:scale [N…] [--no-graphics] [--no-radio]: сколько стоят машины в масштабе — 100, 1000, 5000,
// 10 000 рабочих по программе толпы (src/test/machinesBench.ts); --no-radio — без рассылки всем (она растёт
// как N² и при тысячах машин занимает почти всё время). Для каждого N две карты-прогона:
// - без окна (--benchmark): время тика → UPS (чистая симуляция, не больше 60);
// - с окном (--benchmark-graphics, --output-perf-stats): игра идёт как обычно, камера у машин → FPS и UPS.
// Карта — без воды, скал, деревьев, руды и врагов: только машины и их полосы руды.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { buildMod, createMap, prepareWork, runFactorio, scriptError } from "../test/factorio.mjs"

const args = process.argv.slice(2)
const graphics = !args.includes("--no-graphics")
const radio = !args.includes("--no-radio")
const counts = args.filter((a) => /^\d+$/.test(a)).map(Number)
const COUNTS = counts.length > 0 ? counts : [100, 1000, 5000, 10000]
/** Без окна: тиков всего и сколько первых пропустить (расстановка, разгон — все разом ищут путь). */
const TICKS = 1500
const SKIP = 600
/** С окном: тиков (при 60 UPS — 10 с) и сколько первых кадров не считать. */
const GRAPHICS_TICKS = 900
const GRAPHICS_SKIP = 300

const factorio =
  process.env.FACTORIO_BIN ??
  join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")

// Размер 0 — «нет» в меню новой карты (частота 0 генератор не принимает: бесконечный шум).
const none = { frequency: 1, size: 0, richness: 1 }
const MAP_GEN = {
  seed: 1,
  autoplace_controls: Object.fromEntries(
    ["enemy-base", "trees", "rocks", "water", "iron-ore", "copper-ore", "coal", "stone", "crude-oil", "uranium-ore"].map((name) => [name, none]),
  ),
  cliff_settings: { richness: 0 },
}

function prepare(count) {
  const env = prepareWork(`automaton-bench-scale-${count}`, "automaton-bench-machines", `0.${count}.${radio ? 0 : 1}`)
  writeFileSync(env.mapGen, JSON.stringify(MAP_GEN))
  // Без вертикальной синхронизации: иначе кадр ждёт экран (на батарее и за другим окном macOS даёт 30 Гц)
  // и замер показывает частоту экрана, а не игру.
  appendFileSync(join(env.work, "config.ini"), "[graphics]\nv-sync=false\n")
  const create = createMap(env)
  if (create.status !== 0) throw new Error(scriptError(create.stdout))
  return env
}

function notes(env) {
  const log = readFileSync(join(env.data, "factorio-current.log"), "utf8")
  return [...log.matchAll(/MACHINES: (.+)/g)].map((m) => m[1]).join("; ")
}

/** Без окна: среднее и худшее время тика после разгона. */
function headless(env) {
  const started = Date.now()
  const result = runFactorio([...env.common, "--benchmark", env.map, "--benchmark-ticks", String(TICKS), "--benchmark-verbose", "wholeUpdate"])
  const ticks = []
  for (const line of result.stdout.split("\n")) {
    const m = /^t(\d+),(\d+)/.exec(line.trim())
    if (m) ticks.push({ tick: Number(m[1]), ns: Number(m[2]) })
  }
  if (ticks.length === 0) throw new Error(`нет замеров:\n${scriptError(result.stdout)}`)
  const measured = ticks.filter((t) => t.tick > SKIP).map((t) => t.ns / 1e6)
  const avg = measured.reduce((a, b) => a + b, 0) / measured.length
  const sorted = [...measured].sort((a, b) => a - b)
  return { avg, p99: sorted[Math.floor(sorted.length * 0.99)], seconds: (Date.now() - started) / 1000, notes: notes(env) }
}

/**
 * С окном: статистика кадров игры (по строке на кадр; update — мс обновления в этом кадре, 0 — без
 * обновления; cpu-frame — время кадра). FPS — кадров в секунду, UPS — кадров с обновлением в секунду.
 */
function frameStats(file) {
  const [header, ...lines] = readFileSync(file, "utf8").trim().split("\n")
  const column = Object.fromEntries(header.split(",").map((name, i) => [name, i]))
  const frames = lines.map((line) => line.split(",")).slice(GRAPHICS_SKIP)
  const seconds = frames.reduce((sum, f) => sum + Number(f[column["cpu-frame"]]), 0) / 1000
  const updates = frames.filter((f) => Number(f[column.update]) > 0)
  const render = frames.reduce((sum, f) => sum + Number(f[column.prepare]) + Number(f[column["cpu-render"]]), 0) / frames.length
  const sprites = frames.reduce((sum, f) => sum + Number(f[column["sprite-count"]]), 0) / frames.length
  return { fps: frames.length / seconds, ups: updates.length / seconds, render, sprites }
}

/** С окном: файл статистики кадров игры. */
function windowed(env) {
  const perf = join(env.work, "perf.csv")
  const result = spawnSync(
    factorio,
    [...env.common, "--benchmark-graphics", env.map, "--benchmark-ticks", String(GRAPHICS_TICKS), "--output-perf-stats", perf],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SteamAppId: "427520" } },
  )
  if (!existsSync(perf)) throw new Error(`нет статистики кадров:\n${scriptError(result.stdout)}`)
  return { perf, stdout: result.stdout }
}

buildMod()
const results = []
for (const count of COUNTS) {
  const env = prepare(count)
  const h = headless(env)
  const ups = Math.min(60, 1000 / h.avg)
  console.log(`${String(count).padStart(6)} машин без окна: ${h.avg.toFixed(2)} мс/тик (99% тиков ≤ ${h.p99.toFixed(2)}), UPS ≈ ${ups.toFixed(1)} — ${h.notes} (${h.seconds.toFixed(0)} с)`)
  if (graphics) {
    const w = frameStats(windowed(env).perf)
    console.log(`${" ".repeat(13)}с окном: FPS ${w.fps.toFixed(1)}, UPS ${w.ups.toFixed(1)} (отрисовка ${w.render.toFixed(2)} мс/кадр, спрайтов в кадре ${w.sprites.toFixed(0)})`)
  }
  results.push({ count, ups, ...h })
}
