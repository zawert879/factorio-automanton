// npm run shot: снимки экрана сцены из src/test/visual.ts — проверить внешний вид без человека.
// npm run shot:graphs — схемы примеров в мастерской и машины, которые их исполняют (src/test/graphShots.ts).
// Запускает игру С ОКНОМ на отдельной карте (своя папка данных), ждёт done.txt и закрывает игру.
// Снимки копируются в build/visual/ (схемы — в build/graph-shots/).
import { spawn } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, root, scriptError } from "../test/factorio.mjs"
import { framesToGif } from "./gif.mjs"

const graphs = process.argv[2] === "graphs"
const TIMEOUT_MS = graphs ? 600_000 : 180_000
const MARKER = graphs ? "automaton-graph-shots" : "automaton-visual"

buildMod()
const env = prepareWork(MARKER, MARKER)
const create = createMap(env)
if (create.status !== 0) {
  console.error(`Карта не создана:\n${scriptError(create.stdout)}`)
  process.exit(1)
}

const outDir = join(env.data, "script-output", MARKER)
const factorio =
  process.env.FACTORIO_BIN ??
  join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")
// SteamAppId — иначе Steam-версия игры с окном перезапускает себя через Steam (так же делает FMTK).
const game = spawn(factorio, [...env.common, "--load-game", env.map], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, SteamAppId: "427520" },
})
let output = ""
game.stdout.on("data", (chunk) => (output += chunk))

const started = Date.now()
const timer = setInterval(() => {
  const done = existsSync(join(outDir, "done.txt"))
  const timedOut = Date.now() - started > TIMEOUT_MS
  if (!done && !timedOut && game.exitCode === null) return
  clearInterval(timer)
  // Снимок пишется при отрисовке кадра, после done.txt (последний — уже на паузе): даём игре пару секунд.
  setTimeout(() => finish(done, timedOut), done ? 3000 : 0)
}, 500)

function finish(done, timedOut) {
  game.kill()
  if (!done) {
    console.error(`Снимки не получены (${timedOut ? "время вышло" : `игра вышла с кодом ${game.exitCode}`}):\n${scriptError(output)}`)
    process.exit(1)
  }
  const target = join(root, "build", graphs ? "graph-shots" : "visual")
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(outDir, target, { recursive: true })
  // Серии кадров (сцены работы схем) — в GIF, последний кадр — отдельной картинкой.
  for (const scene of readdirSync(target, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const dir = join(target, scene)
    const frames = readdirSync(dir).filter((f) => f.endsWith(".png")).sort()
    if (frames.length === 0) continue
    // Кадр — каждые 10 тиков игры, показ — вдвое быстрее.
    const size = framesToGif(dir, join(target, `${scene}.gif`), 80)
    copyFileSync(join(dir, frames[frames.length - 1]), join(target, `${scene}.png`))
    rmSync(dir, { recursive: true, force: true })
    console.log(`${scene}: ${frames.length} кадров, GIF ${(size / 1024).toFixed(0)} КБ`)
  }
  console.log(`Снимки: ${target}`)
}
