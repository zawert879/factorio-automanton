// npm run test:sync: синхронизация с VS Code (5.10).
// 1) Выделенный сервер с RCON: публикация длинной программы (частями, с кириллицей), ошибка компиляции
//    в формате для VS Code, pull (тот же текст), выгрузка в script-output.
// 2) Игра с окном (одиночная, на несколько секунд) с --enable-lua-udp: публикация и pull по UDP.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, root, scriptError } from "./factorio.mjs"

const PORT = 27115
const UDP_PORT = 27156
const PASSWORD = "automaton-test"

function fail(message) {
  console.error(`✗ ${message}`)
  server?.kill()
  process.exit(1)
}

function portOpen() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: PORT }, () => {
      socket.end()
      resolve(true)
    })
    socket.on("error", () => resolve(false))
  })
}

buildMod()
const env = prepareWork("automaton-sync-test", "automaton-sync-test")
const create = createMap(env)
if (create.status !== 0) fail(`карта не создана:\n${scriptError(create.stdout)}`)
const factorio =
  process.env.FACTORIO_BIN ??
  join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")
// Настройки сервера — пример из игры с нужными изменениями (сервер требует все поля).
const example = JSON.parse(readFileSync(join(factorio, "..", "..", "data", "server-settings.example.json"), "utf8"))
const settingsFile = join(env.work, "server-settings.json")
writeFileSync(
  settingsFile,
  JSON.stringify({ ...example, name: "automaton-test", visibility: { public: false, lan: false }, require_user_verification: false, auto_pause: false }),
)
let output = ""
const server = spawn(
  factorio,
  [
    ...env.common,
    "--start-server",
    env.map,
    "--server-settings",
    settingsFile,
    "--rcon-port",
    String(PORT),
    "--rcon-password",
    PASSWORD,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
)
server.stdout.on("data", (chunk) => (output += chunk))

const started = Date.now()
while (!(await portOpen())) {
  if (Date.now() - started > 60000 || server.exitCode !== null) fail(`сервер не открыл RCON:\n${output.slice(-2000)}`)
  await new Promise((r) => setTimeout(r, 500))
}

const programs = join(env.work, "programs")
const pulled = join(env.work, "pulled")
mkdirSync(programs, { recursive: true })
mkdirSync(pulled, { recursive: true })
let longProgram = "// Длинная программа: передаётся частями\n"
for (let i = 0; i < 120; i++) longProgram += `print("строка номер ${i} — проверка передачи частями")\n`
writeFileSync(join(programs, "Привет.ts"), longProgram)
writeFileSync(join(programs, "Ошибка.ts"), 'print("ок")\nlet x = 1 == 2\n')

const tool = join(root, "mod", "tools", "automaton-sync.mjs")
const rconArgs = ["--rcon", "--port", String(PORT), "--password", PASSWORD, "--lang", "ru"]
const udpArgs = ["--udp", String(UDP_PORT), "--lang", "ru"]
const push = spawnSync("node", [tool, "push", join(programs, "Привет.ts"), join(programs, "Ошибка.ts"), ...rconArgs], { encoding: "utf8" })
const pushOut = push.stdout + push.stderr
if (!pushOut.includes("«Привет» опубликована, v1")) fail(`длинная программа не опубликована:\n${pushOut}`)
if (!pushOut.includes(`${join(programs, "Ошибка.ts")}:2:11: error: «==» нельзя`)) fail(`нет ошибки в формате VS Code:\n${pushOut}`)
if (push.status !== 1) fail(`код выхода с ошибкой компиляции — ${push.status}, ожидался 1`)

const pull = spawnSync("node", [tool, "pull", pulled, ...rconArgs], { encoding: "utf8" })
const pulledFile = join(pulled, "Привет.ts")
if (!existsSync(pulledFile)) fail(`pull не скачал программу:\n${pull.stdout}${pull.stderr}`)
if (readFileSync(pulledFile, "utf8") !== longProgram) fail("pull скачал другой текст")
if (!existsSync(join(pulled, "automaton.d.ts"))) fail("pull не положил automaton.d.ts")

// Своя папка у каждой карты: script-output/automaton/карта-<seed>/player.
const maps = existsSync(join(env.data, "script-output", "automaton")) ? readdirSync(join(env.data, "script-output", "automaton")) : []
if (maps.length !== 1 || !maps[0].startsWith("карта-")) fail(`папка карты: ${maps.join(", ")}`)
const mapName = maps[0]
const mapFolder = join(env.data, "script-output", "automaton", mapName, "player")
const exported = join(mapFolder, "Привет.ts")
if (!existsSync(exported) || readFileSync(exported, "utf8") !== longProgram) fail(`нет выгрузки в ${exported}`)

// Модули в папках (этап 17): имя — путь от папки с tsconfig.json; ошибки зависимой — в её файле.
const project = join(env.work, "project")
mkdirSync(join(project, "lib"), { recursive: true })
mkdirSync(join(project, "app"), { recursive: true })
writeFileSync(join(project, "tsconfig.json"), "{}")
const libFile = join(project, "lib", "Счёт.ts")
const appFile = join(project, "app", "Главная.ts")
writeFileSync(libFile, "export function twice(x: number): number {\n  return x * 2\n}\n")
writeFileSync(appFile, 'import { twice } from "../lib/Счёт"\nprint(twice(2))\n')
const modulesPush = spawnSync("node", [tool, "push", libFile, appFile, ...rconArgs], { encoding: "utf8" })
const modulesOut = modulesPush.stdout + modulesPush.stderr
if (!modulesOut.includes("«lib/Счёт» опубликована") || !modulesOut.includes("«app/Главная» опубликована")) fail(`модули в папках:\n${modulesOut}`)
writeFileSync(libFile, "export function triple(x: number): number {\n  return x * 3\n}\n")
const breakPush = spawnSync("node", [tool, "push", libFile, ...rconArgs], { encoding: "utf8" })
const breakOut = breakPush.stdout + breakPush.stderr
if (!breakOut.includes(`${appFile}:1:10: error: в «lib/Счёт» нет экспорта «twice»`)) fail(`ошибка зависимой — не в её файле:\n${breakOut}`)
const modulesPulled = join(env.work, "pulled-modules")
spawnSync("node", [tool, "pull", modulesPulled, ...rconArgs], { encoding: "utf8" })
if (!existsSync(join(modulesPulled, "lib", "Счёт.ts")) || !existsSync(join(modulesPulled, "app", "Главная.ts"))) fail("pull не разложил программы по папкам")
if (!existsSync(join(mapFolder, "lib", "Счёт.ts"))) fail("выгрузка не разложила программы по папкам")

// Папка другой карты: игра ничего не принимает, утилита объясняет, в чём дело.
writeFileSync(join(project, ".automaton-map.json"), JSON.stringify({ map: "карта-999", force: "player" }))
const wrongPush = spawnSync("node", [tool, "push", appFile, ...rconArgs], { encoding: "utf8" })
const wrongOut = wrongPush.stdout + wrongPush.stderr
if (!wrongOut.includes(`эта папка — для карты «карта-999», а в игре открыта «${mapName}»`)) fail(`папка другой карты:\n${wrongOut}`)
writeFileSync(join(project, ".automaton-map.json"), JSON.stringify({ map: mapName, force: "player" }))
const rightPush = spawnSync("node", [tool, "push", appFile, ...rconArgs], { encoding: "utf8" })
if (!(rightPush.stdout + rightPush.stderr).includes("«app/Главная» опубликована")) fail(`папка своей карты:\n${rightPush.stdout}${rightPush.stderr}`)

// Временную папку не удаляем: сервер ещё дописывает файлы после остановки (её чистит следующий запуск).
server.kill()
console.log("RCON (выделенный сервер): публикация частями, ошибки, pull, выгрузка, модули в папках, папка своей карты — ок")

// ---------- UDP: игра с окном ----------
const gui = prepareWork("automaton-sync-udp", "automaton-sync-udp")
createMap(gui)
const game = spawn(factorio, [...gui.common, "--load-game", gui.map, "--enable-lua-udp", String(UDP_PORT)], {
  stdio: "ignore",
  env: { ...process.env, SteamAppId: "427520" },
})
const udpPulled = join(gui.work, "pulled")
mkdirSync(udpPulled, { recursive: true })
let udpOut = ""
const udpStart = Date.now()
while (!udpOut.includes("«Привет» опубликована, v1")) {
  if (Date.now() - udpStart > 90000) {
    game.kill()
    fail(`публикация по UDP:\n${udpOut}`)
  }
  const udpPush = spawnSync("node", [tool, "push", join(programs, "Привет.ts"), ...udpArgs], { encoding: "utf8" })
  udpOut = udpPush.stdout + udpPush.stderr
}
const udpPull = spawnSync("node", [tool, "pull", udpPulled, ...udpArgs], { encoding: "utf8" })
game.kill()
if (!existsSync(join(udpPulled, "Привет.ts")) || readFileSync(join(udpPulled, "Привет.ts"), "utf8") !== longProgram) {
  fail(`pull по UDP:\n${udpPull.stdout}${udpPull.stderr}`)
}
console.log("UDP (игра с окном): публикация и pull — ок")
