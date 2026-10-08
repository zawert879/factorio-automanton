// npm run test:mp: настоящий мультиплеер (13.2). Локальный выделенный сервер на карте сценария desync
// (50 машин по программам: толпа, шахтёры, связь, жидкости, патруль) и клиент с окном, который
// подключается посреди работы (загружает карту — проверяется путь on_load) и играет PLAY_SECONDS.
// Провал — десинк или ошибка скрипта у сервера или клиента.
import { spawn } from "node:child_process"
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, scriptError } from "./factorio.mjs"

const PORT = 34297
const PLAY_SECONDS = 45
const JOIN_TIMEOUT_MS = 120_000

const factorio =
  process.env.FACTORIO_BIN ??
  join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")

let server
let client
function stop() {
  client?.kill()
  server?.kill()
}
function fail(message) {
  stop()
  console.error(message)
  process.exit(1)
}

buildMod()
const env = prepareWork("automaton-mp-server", "automaton-desync-test")
const create = createMap(env)
if (create.status !== 0) fail(`карта не создана:\n${scriptError(create.stdout)}`)

const example = JSON.parse(readFileSync(join(factorio, "..", "..", "data", "server-settings.example.json"), "utf8"))
const settingsFile = join(env.work, "server-settings.json")
writeFileSync(
  settingsFile,
  JSON.stringify({ ...example, name: "automaton-mp", visibility: { public: false, lan: false }, require_user_verification: false, auto_pause: false }),
)

let serverOut = ""
server = spawn(factorio, [...env.common, "--start-server", env.map, "--server-settings", settingsFile, "--port", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
})
server.stdout.on("data", (chunk) => (serverOut += chunk))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(what, condition, timeout) {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeout) fail(`не дождались: ${what}\nсервер:\n${serverOut.slice(-3000)}`)
    if (server.exitCode !== null) fail(`сервер вышел с кодом ${server.exitCode}:\n${scriptError(serverOut)}`)
    await sleep(500)
  }
}

await waitFor("сервер запущен", () => serverOut.includes("to(InGame)"), 60_000)

const gui = prepareWork("automaton-mp-client", "automaton-desync-test")
let clientOut = ""
client = spawn(factorio, [...gui.common, "--mp-connect", `127.0.0.1:${PORT}`], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, SteamAppId: "427520" },
})
client.stdout.on("data", (chunk) => (clientOut += chunk))

await waitFor("клиент подключился", () => /joined the game|\[JOIN\]/.test(serverOut), JOIN_TIMEOUT_MS)
const joinedAt = Date.now()
while (Date.now() - joinedAt < PLAY_SECONDS * 1000) {
  if (server.exitCode !== null) fail(`сервер вышел с кодом ${server.exitCode}:\n${scriptError(serverOut)}`)
  if (client.exitCode !== null) break
  await sleep(1000)
}
stop()
await sleep(1000)

const clientLog = existsSync(join(gui.data, "factorio-current.log")) ? readFileSync(join(gui.data, "factorio-current.log"), "utf8") : clientOut
const problems = []
for (const [who, text] of [
  ["сервер", serverOut],
  ["клиент", clientLog],
]) {
  // Не путать с именем служебного мода automaton-desync-test.
  const desync = /desync(?!-test)|desynchroni[sz]/i
  if (desync.test(text)) problems.push(`${who}: десинк\n${text.split("\n").filter((l) => desync.test(l)).slice(0, 5).join("\n")}`)
  if (/Error.*(control|__automaton__)/.test(text)) problems.push(`${who}: ошибка скрипта\n${scriptError(text)}`)
}
if (client.exitCode !== null && Date.now() - joinedAt < PLAY_SECONDS * 1000 - 2000) problems.push(`клиент вышел раньше времени (код ${client.exitCode})`)
if (problems.length > 0) fail(problems.join("\n\n"))
const seconds = Math.round((Date.now() - joinedAt) / 1000)
console.log(`клиент подключился к серверу посреди работы 50 машин и играл ${seconds} с — без десинков и ошибок`)
