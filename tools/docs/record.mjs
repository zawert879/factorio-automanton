// npm run docs:record: анимации для документации. Игра С ОКНОМ загружает сохранение с фабрикой науки
// (npm run demo:science) со служебным модом automaton-record (src/test/record.ts), снимает сцены
// и закрывается; кадры собираются в GIF в docs/media/. Неизменившиеся пиксели кадра — прозрачные:
// так GIF хранит почти только движение и остаётся небольшим.
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import gifenc from "gifenc"
import { PNG } from "pngjs"
import { buildMod, prepareWork, root, scriptError } from "../test/factorio.mjs"

const { GIFEncoder, quantize, applyPalette } = gifenc
const TIMEOUT_MS = 600_000
/** Ускорение показа относительно игры (общий вид — сильнее). */
const PLAYBACK = { factory: 4, editor: 0.6 }

const save = join(homedir(), "Library", "Application Support", "factorio", "saves", "automaton-science.zip")
if (!existsSync(save)) {
  console.error("Нет сохранения automaton-science.zip — сначала npm run demo:science")
  process.exit(1)
}

buildMod()
const env = prepareWork("automaton-record", "automaton-record")
copyFileSync(save, env.map)
const factorio =
  process.env.FACTORIO_BIN ??
  join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")
const outDir = join(env.data, "script-output", "automaton-record")
const game = spawn(factorio, [...env.common, "--load-game", env.map], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SteamAppId: "427520" } })
let output = ""
game.stdout.on("data", (chunk) => (output += chunk))

const started = Date.now()
await new Promise((resolve) => {
  const timer = setInterval(() => {
    if (existsSync(join(outDir, "done.txt")) || Date.now() - started > TIMEOUT_MS || game.exitCode !== null) {
      clearInterval(timer)
      // Последние кадры пишутся при отрисовке — пара секунд.
      setTimeout(resolve, 3000)
    }
  }, 500)
})
game.kill()
if (!existsSync(join(outDir, "done.txt"))) {
  console.error(`Запись не закончилась:\n${scriptError(output)}`)
  process.exit(1)
}

/** Уменьшить кадр в целое число раз, если он шире 1280. */
function shrink(png) {
  const factor = Math.ceil(png.width / 1200)
  if (png.width <= 1280 || factor <= 1) return png
  const width = Math.floor(png.width / factor)
  const height = Math.floor(png.height / factor)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0
        for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) sum += png.data[((y * factor + dy) * png.width + (x * factor + dx)) * 4 + c]
        data[(y * width + x) * 4 + c] = sum / (factor * factor)
      }
    }
  }
  return { width, height, data }
}

const media = join(root, "docs", "media")
mkdirSync(media, { recursive: true })
// Интервал кадров сцены в тиках — как в src/test/record.ts (там же сцены).
const source = readFileSync(join(root, "src", "test", "record.ts"), "utf8")
const every = Object.fromEntries([...source.matchAll(/name: "([a-z]+)"[^}]*?every: (\d+)/g)].map((m) => [m[1], Number(m[2])]))

for (const scene of readdirSync(outDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const files = readdirSync(join(outDir, scene)).filter((f) => f.endsWith(".png")).sort()
  if (files.length === 0) continue
  // Снимки интерфейса — во всё окно: уменьшаем до ~1200 по ширине (усреднением блоков).
  const frames = files.map((f) => shrink(PNG.sync.read(readFileSync(join(outDir, scene, f)))))
  const { width, height } = frames[0]
  // Палитра — по выборке всех кадров сцены (255 цветов + прозрачный).
  const step = Math.max(1, Math.floor(frames.length / 8))
  const sample = []
  for (let i = 0; i < frames.length; i += step) sample.push(frames[i].data)
  const pooled = new Uint8Array(sample.reduce((n, d) => n + d.length, 0))
  let offset = 0
  for (const d of sample) {
    pooled.set(d, offset)
    offset += d.length
  }
  const palette = quantize(pooled, 255, { format: "rgb565" })
  const transparent = palette.length
  const fullPalette = [...palette, [0, 0, 0]]
  const delay = Math.round(((every[scene] ?? 4) * 1000) / 60 / (PLAYBACK[scene] ?? 1))
  const gif = GIFEncoder()
  let previous
  for (const frame of frames) {
    const index = applyPalette(frame.data, palette, "rgb565")
    let out = index
    if (previous !== undefined) {
      out = new Uint8Array(index.length)
      for (let i = 0; i < index.length; i++) out[i] = index[i] === previous[i] ? transparent : index[i]
    }
    gif.writeFrame(out, width, height, {
      palette: fullPalette,
      delay,
      transparent: previous !== undefined,
      transparentIndex: transparent,
      dispose: 1,
    })
    previous = index
  }
  gif.finish()
  const target = join(media, `${scene}.gif`)
  writeFileSync(target, gif.bytes())
  console.log(`${scene}: ${files.length} кадров, ${(gif.bytes().length / 1024).toFixed(0)} КБ`)
}

// Снимки окон из npm run shot (build/visual) — уменьшенные, для руководства.
for (const name of ["machine-window", "picker", "tech-tree", "models"]) {
  const file = join(root, "build", "visual", `${name}.png`)
  if (!existsSync(file)) continue
  const small = shrink(PNG.sync.read(readFileSync(file)))
  const png = new PNG({ width: small.width, height: small.height })
  png.data = Buffer.from(small.data)
  writeFileSync(join(media, `${name}.png`), PNG.sync.write(png))
  console.log(`${name}.png: ${small.width}×${small.height}`)
}
