#!/usr/bin/env node
// Automaton: синхронизация программ между VS Code и игрой (через RCON). Нужен Node.js 18+, зависимостей нет.
//
//   node automaton-sync.mjs [watch] [папка]   — следить за папкой: сохранили файл .ts — программа опубликована,
//                                               удалили — удалена, переименовали или перенесли — переименована
//                                               (обратно игра сама: удалили или переименовали в игре — файл тоже)
//   node automaton-sync.mjs push файл.ts…     — опубликовать файлы один раз
//   node automaton-sync.mjs delete файл.ts…   — удалить программы этих файлов в игре
//   node automaton-sync.mjs pull [папка]      — скачать программы команды из игры в папку
//
// Программы лежат в папке src (рядом — служебные файлы). Имя программы — путь файла в src без .ts, папки
// через «/»: src/lib/Помощники.ts → «lib/Помощники» (или первая строка «// @program Имя»). Импорт между
// программами — как между файлами: "../lib/Помощники". В старой папке без src программы — прямо в ней.
// Связь с игрой:
//   UDP (по умолчанию; игра с окном — одиночная или по сети): параметр запуска игры «--enable-lua-udp 27155»
//     (в Steam: Свойства → Параметры запуска); утилита: --udp 27155 (по умолчанию);
//   RCON (выделенный сервер): --rcon --port 27015 --password … (или AUTOMATON_RCON_PASSWORD).
// Параметры можно положить в .automaton-sync.json в папке: { "udp": 27155 } или { "rcon": true, "port": …, "password": … }.
// Ошибки печатаются как «файл:строка:столбец: error: текст» — VS Code показывает их в коде (docs/VSCODE.md).
// Папка одной карты: .automaton-map.json (пишет игра) — имя карты; в другую карту файлы не публикуются.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createSocket } from "node:dgram"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const SELF = fileURLToPath(import.meta.url)
const HERE = dirname(SELF)
/** Версия утилиты — хеш её файла: игра отклоняет утилиту другой версии, чем мод. */
const TOOL = createHash("sha1").update(readFileSync(SELF)).digest("hex").slice(0, 12)
const PART = 1500

// ---------- Параметры ----------

const argv = process.argv.slice(2)
const options = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--rcon") options.rcon = true
  else if (argv[i] === "--worker") continue
  else if (argv[i].startsWith("--")) options[argv[i].slice(2)] = argv[++i]
  else positional.push(argv[i])
}
const mode = ["watch", "push", "pull", "delete"].includes(positional[0]) ? positional.shift() : "watch"
const folder = resolve(mode === "push" || mode === "delete" ? "." : (positional[0] ?? "."))
const configFile = join(folder, ".automaton-sync.json")
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {}
const useRcon = options.rcon === true || config.rcon === true
const host = options.host ?? config.host ?? "127.0.0.1"
const port = Number(options.port ?? config.port ?? 27015)
const udpPort = Number(options.udp ?? config.udp ?? 27155)
const password = options.password ?? process.env.AUTOMATON_RCON_PASSWORD ?? config.password
const lang = options.lang ?? config.lang ?? (/^ru/i.test(process.env.LANG ?? "ru") ? "ru" : "en")
/** Порт для сигналов игры (кнопка «Обновить из папки» в окне программ) — в режиме слежения. */
const listenPort = Number(options.listen ?? config.listen ?? 27154)

if (useRcon && password === undefined) {
  console.error("automaton: нужен пароль RCON: --password, AUTOMATON_RCON_PASSWORD или .automaton-sync.json")
  process.exit(2)
}

// ---------- Тексты ошибок — из локали мода ----------

function loadLocale() {
  const file = join(HERE, "..", "locale", lang, "automaton.cfg")
  const messages = {}
  if (!existsSync(file)) return messages
  let section = ""
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const header = /^\[(.+)\]$/.exec(line.trim())
    if (header) section = header[1]
    else {
      const eq = line.indexOf("=")
      if (eq > 0) messages[`${section}.${line.slice(0, eq)}`] = line.slice(eq + 1)
    }
  }
  return messages
}
const locale = loadLocale()

function message(error) {
  const template = locale[`automaton-diagnostic.${error.code}`] ?? error.code
  const params = (error.params ?? []).map((p, i) => (error.code === "unsupported" && i === 0 ? (locale[`automaton-feature.${p}`] ?? p) : p))
  return template.replace(/__(\d+)__/g, (_, n) => params[Number(n) - 1] ?? "")
}

// ---------- RCON ----------

class Rcon {
  constructor() {
    this.nextId = 10
    this.buffer = Buffer.alloc(0)
    this.waiters = new Map()
  }

  connect() {
    return new Promise((resolveConnect, reject) => {
      this.socket = createConnection({ host, port }, () => {
        this.send(1, 3, password)
        this.waiters.set(1, { auth: true, resolve: resolveConnect, reject })
      })
      this.socket.on("data", (data) => this.receive(data))
      this.socket.on("error", (error) => reject(new Error(`нет связи с игрой ${host}:${port} (${error.message}) — игра запущена с --rcon-port и по сети?`)))
    })
  }

  send(id, type, body) {
    const text = Buffer.from(body, "utf8")
    const packet = Buffer.alloc(14 + text.length)
    packet.writeInt32LE(10 + text.length, 0)
    packet.writeInt32LE(id, 4)
    packet.writeInt32LE(type, 8)
    text.copy(packet, 12)
    this.socket.write(packet)
  }

  receive(data) {
    this.buffer = Buffer.concat([this.buffer, data])
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0)
      if (this.buffer.length < 4 + size) break
      const id = this.buffer.readInt32LE(4)
      const type = this.buffer.readInt32LE(8)
      const body = this.buffer.toString("utf8", 12, 4 + size - 2)
      this.buffer = this.buffer.subarray(4 + size)
      if (type === 2 && id === -1) {
        for (const waiter of this.waiters.values()) waiter.reject(new Error("RCON: неверный пароль"))
        this.waiters.clear()
        continue
      }
      const waiter = this.waiters.get(id)
      if (waiter === undefined) continue
      if (waiter.auth) {
        if (type === 2) {
          this.waiters.delete(id)
          waiter.resolve()
        }
        continue
      }
      // Ответ может прийти несколькими пакетами: ждём паузу.
      waiter.body += body
      clearTimeout(waiter.timer)
      waiter.timer = setTimeout(() => {
        this.waiters.delete(id)
        waiter.resolve(waiter.body)
      }, 80)
    }
  }

  command(text) {
    const id = this.nextId++
    return new Promise((resolveCommand, reject) => {
      this.waiters.set(id, { body: "", resolve: resolveCommand, reject })
      this.send(id, 2, text)
    })
  }

  async request(data) {
    const reply = (await this.command(`/automaton-sync ${JSON.stringify({ ...data, tool: TOOL })}`)).trim()
    try {
      return JSON.parse(reply)
    } catch {
      throw new Error(`игра ответила не JSON: ${reply.slice(0, 300)} — мод Automaton включён?`)
    }
  }

  close() {
    this.socket?.end()
  }
}

/** UDP: запрос — пакет JSON с номером; ответ ждём с тем же номером, при потере — повтор. */
class Udp {
  constructor() {
    this.nextId = 1
    this.waiters = new Map()
  }

  connect() {
    return new Promise((resolveConnect, reject) => {
      this.socket = createSocket("udp4")
      this.socket.on("message", (data) => {
        let reply
        try {
          reply = JSON.parse(data.toString("utf8"))
        } catch {
          return
        }
        const waiter = this.waiters.get(reply.id)
        if (waiter === undefined) return
        this.waiters.delete(reply.id)
        clearTimeout(waiter.timer)
        waiter.resolve(reply)
      })
      this.socket.on("error", reject)
      this.socket.bind(0, "127.0.0.1", () => resolveConnect())
    })
  }

  request(data, attempt = 1) {
    const id = this.nextId++
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id)
        if (attempt >= 4) reject(new Error(`игра не отвечает по UDP на порту ${udpPort} — запущена с --enable-lua-udp ${udpPort}? Игра не на паузе?`))
        else this.request(data, attempt + 1).then(resolveRequest, reject)
      }, 2000)
      this.waiters.set(id, { resolve: resolveRequest, timer })
      this.socket.send(JSON.stringify({ ...data, id, tool: TOOL }), udpPort, "127.0.0.1")
    })
  }

  close() {
    this.socket?.close()
  }
}

// ---------- Публикация и загрузка ----------

/** Корень папки: в watch и pull — папка; у push и delete — ближайшая выше с tsconfig.json или automaton.d.ts. */
function rootOf(file) {
  if (mode !== "push" && mode !== "delete") return folder
  let dir = dirname(file)
  for (;;) {
    if (["tsconfig.json", "automaton.d.ts", ".automaton-sync.json"].some((f) => existsSync(join(dir, f)))) return dir
    const parent = dirname(dir)
    if (parent === dir) return dirname(file)
    dir = parent
  }
}

/** Где лежат программы: папка src, а в старой папке без src — сама папка. */
function programsDir(root) {
  const src = join(root, "src")
  return existsSync(src) ? src : root
}

function programName(file, source) {
  const marker = /^\/\/\s*@program\s+(.+)$/m.exec(source.split("\n")[0] ?? "")
  if (marker) return marker[1].trim()
  return relative(programsDir(rootOf(file)), file).split(sep).join("/").replace(/\.ts$/, "")
}

/** Файл программы по имени: папки — подпапки, запрещённые в путях символы — «_». */
function fileOf(root, name) {
  return join(programsDir(root), ...name.split("/").map((part) => part.replace(/[\\:*?"<>|]/g, "_"))) + ".ts"
}

/** Текст без путей импорта: перенос файла в другую папку меняет пути, но это та же программа. */
function withoutImportPaths(source) {
  return source.replace(/\b(from|import)(\s*)(["'])[^"']*\3/g, "$1$2$3$3")
}

/** Имя карты папки (из .automaton-map.json, его пишет «Папка для VS Code»); нет файла — без проверки. */
function mapOf(root) {
  const file = join(root, ".automaton-map.json")
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")).map || undefined
  } catch {
    return undefined
  }
}

/** Игра открыта на другой карте: понятная ошибка вместо публикации не туда. */
function wrongMap(reply) {
  return reply.error === "wrong-map"
    ? `эта папка — для карты «${reply.folderMap}», а в игре открыта «${reply.map}»: откройте в игре «Программы…» → «Папка для VS Code» и работайте в её папке`
    : undefined
}

/** Список из ответа игры: пустая таблица Lua приходит как {}, а не []. */
const list = (value) => (Array.isArray(value) ? value : [])

/** Ошибка компиляции для VS Code; ошибка в модуле — в файле модуля. */
function printError(root, file, error) {
  const where = error.module ? fileOf(root, error.module) : file
  console.log(`${where}:${Math.max(1, error.line)}:${Math.max(1, error.column)}: error: ${message(error)}`)
}

/** Текст, который уже есть в игре (опубликован или скачан): такой файл не публикуется повторно. */
const synced = new Map()

async function push(link, file, force = false, quiet = false) {
  const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
  if (!force && synced.get(file) === source) return true
  const name = programName(file, source)
  const map = mapOf(rootOf(file))
  const begin = await link.request({ cmd: "begin", name, map })
  if (!begin.ok && begin.outdated) {
    if (!quiet) console.log(`${file}:1:1: error: ${begin.error}`)
    return false
  }
  if (!begin.ok && wrongMap(begin)) {
    if (!quiet) console.log(`${file}:1:1: error: ${wrongMap(begin)}`)
    return false
  }
  if (!begin.ok) {
    for (const error of begin.errors ?? []) console.log(`${file}:1:1: error: ${message(error)}`)
    if (begin.errors === undefined) throw new Error(`игра не приняла программу: ${begin.error}`)
    return false
  }
  let parts = 0
  for (let i = 0; i < source.length; i += PART) {
    parts++
    const part = await link.request({ cmd: "part", seq: parts, text: source.slice(i, i + PART), map })
    if (!part.ok) throw new Error(`игра не приняла часть программы: ${part.error}`)
  }
  const result = await link.request({ cmd: "end", parts, map })
  const root = rootOf(file)
  if (result.ok) {
    synced.set(file, source)
    // Тот же текст уже в игре (файл записала сама игра) — молча.
    if (!result.unchanged && !quiet) console.log(`automaton: «${name}» опубликована, v${result.version}`)
    if (list(result.rebuilt).length > 0) console.log(`automaton: пересобраны: ${result.rebuilt.join(", ")}`)
    // Зависимые, которые с новой версией не собрались, — ошибки в их файлах (в игре работает прежняя сборка).
    for (const stale of list(result.stale)) {
      for (const error of list(stale.errors)) printError(root, fileOf(root, stale.name), error)
    }
    return true
  }
  if (!quiet) for (const error of result.errors ?? [{ line: 1, column: 1, code: result.error ?? "error" }]) printError(root, file, error)
  return false
}

/**
 * Кнопка «Обновить из папки»: опубликовать новые и изменённые файлы src (проходами — библиотеки раньше тех,
 * кто их импортирует) и сообщить игре итог; программы без файлов игра предложит удалить сама.
 */
async function refresh(link) {
  const reply = await link.request({ cmd: "list", map: mapOf(folder) })
  if (!reply.ok) {
    console.log(`automaton: ${wrongMap(reply) ?? reply.error}`)
    return
  }
  const game = new Map(list(reply.programs).map((p) => [p.name, p]))
  const local = new Map()
  for (const file of programFiles(programsDir(folder))) {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    local.set(programName(file, source), file)
    synced.set(file, source)
  }
  const changed = (name) => game.get(name)?.sum !== checksum(synced.get(local.get(name)))
  let pending = [...local.keys()].filter(changed)
  const published = []
  while (pending.length > 0) {
    const next = []
    for (const name of pending) {
      if (await push(link, local.get(name), true, true)) published.push(name)
      else next.push(name)
    }
    if (next.length === pending.length) break
    pending = next
  }
  // Не собрались — ещё раз, уже с ошибками в их файлах.
  for (const name of pending) await push(link, local.get(name), true)
  const missing = [...game.keys()].filter((name) => !local.has(name))
  await link.request({ cmd: "refresh-done", published, failed: pending, missing, map: mapOf(folder) })
  console.log(`automaton: из папки опубликовано ${published.length}${published.length > 0 ? `: ${published.join(", ")}` : ""}`)
  if (pending.length > 0) console.log(`automaton: не собрались: ${pending.join(", ")}`)
  if (missing.length > 0) console.log(`automaton: в игре без файлов (игра спросит, удалить ли): ${missing.join(", ")}`)
}

/** Слушать сигналы игры: кнопка «Обновить из папки». */
function listen(link, run) {
  const socket = createSocket("udp4")
  socket.on("message", (data) => {
    let message
    try {
      message = JSON.parse(data.toString("utf8"))
    } catch {
      return
    }
    if (message.cmd !== "refresh") return
    const map = mapOf(folder)
    if (map !== undefined && message.map !== map) {
      console.log(`automaton: «Обновить из папки» из карты «${message.map}», а это папка карты «${map}» — пропускаю`)
      return
    }
    console.log("automaton: игра просит обновить из папки")
    // Сразу ответить, что сигнал получен (иначе через 3 секунды игра подскажет, что утилита не отвечает).
    link.request({ cmd: "refresh-started", map }).catch(() => {})
    run(() => refresh(link))
  })
  // Порт может ещё держать прежний процесс (перезапуск после обновления утилиты) — пробуем снова.
  let attempts = 0
  socket.on("error", (error) => {
    if (error.code === "EADDRINUSE" && ++attempts < 15) setTimeout(() => socket.bind(listenPort, "127.0.0.1"), 1000)
    else console.log(`automaton: кнопка «Обновить из папки» работать не будет: порт ${listenPort} занят (${error.message})`)
  })
  socket.bind(listenPort, "127.0.0.1")
}

/** Контрольная сумма текста (байты UTF-8) — как в игре (src/program/sync.ts, checksum). */
function checksum(text) {
  let h = 0
  for (const byte of Buffer.from(text, "utf8")) h = (h * 31 + byte) % 2147483647
  return h
}

/** Сверка src с игрой при запуске слежения: что изменилось, пока утилита не работала. Только сообщает. */
async function compare(link, files) {
  const reply = await link.request({ cmd: "list", map: mapOf(folder) })
  if (!reply.ok) {
    console.log(`automaton: ${wrongMap(reply) ?? reply.error}`)
    return
  }
  const game = new Map(list(reply.programs).map((p) => [p.name, p]))
  const local = new Map(files.map((file) => [programName(file, synced.get(file)), file]))
  const missing = [...game.keys()].filter((name) => !local.has(name))
  const fresh = [...local.keys()].filter((name) => !game.has(name))
  const differ = [...local.keys()].filter((name) => game.has(name) && game.get(name).sum !== checksum(synced.get(local.get(name))))
  if (missing.length > 0) {
    console.log(`automaton: в игре есть, а файла в src нет: ${missing.join(", ")}`)
    console.log(`automaton:   вернуть файлы — node automaton-sync.mjs pull; удалить в игре — в окне программ или node automaton-sync.mjs delete ${missing.map((n) => `src/${n}.ts`).join(" ")}`)
  }
  if (fresh.length > 0) console.log(`automaton: файлы без программы в игре (сохраните файл — опубликуется): ${fresh.join(", ")}`)
  if (differ.length > 0) console.log(`automaton: отличаются от игры (сохраните файл — опубликуется ваш; pull — взять из игры): ${differ.join(", ")}`)
  if (missing.length + fresh.length + differ.length === 0) console.log("automaton: src совпадает с игрой")
}

/** Удалить программу файла в игре (файл удалён). Используемую библиотеку игра не удаляет. */
async function remove(link, file, source) {
  const root = rootOf(file)
  const name = programName(file, source ?? "")
  const reply = await link.request({ cmd: "delete", name, map: mapOf(root) })
  if (reply.ok) {
    synced.delete(file)
    // already — программу уже удалили в игре (и файл удалила игра).
    if (!reply.already) console.log(`automaton: «${name}» удалена`)
    return true
  }
  if (wrongMap(reply)) console.log(`${file}:1:1: error: ${wrongMap(reply)}`)
  else if (reply.error === "in-use") {
    // Файла уже нет — ошибки показываем в тех, кто импортирует: программа в игре осталась.
    for (const user of list(reply.usedBy)) {
      console.log(`${fileOf(root, user)}:1:1: error: импортирует «${name}», файл которой удалён: в игре она осталась — уберите импорт или верните файл`)
    }
  } else for (const error of list(reply.errors)) printError(root, file, error)
  return false
}

/** Переименовать программу (файл перенесли или переименовали): импорты зависимых игра поправит сама. */
async function rename(link, from, to, source) {
  const root = rootOf(to)
  const oldName = programName(from, source)
  const newName = programName(to, source)
  if (oldName === newName) return true
  const reply = await link.request({ cmd: "rename", name: oldName, to: newName, map: mapOf(root) })
  if (!reply.ok) {
    if (wrongMap(reply)) console.log(`${to}:1:1: error: ${wrongMap(reply)}`)
    else for (const error of reply.errors ?? [{ line: 1, column: 1, code: reply.error ?? "error" }]) printError(root, to, error)
    return false
  }
  synced.delete(from)
  if (reply.already) return true
  console.log(`automaton: «${oldName}» → «${newName}»`)
  if (list(reply.rebuilt).length > 0) console.log(`automaton: пересобраны: ${reply.rebuilt.join(", ")}`)
  return true
}

async function pull(link) {
  const map = mapOf(folder)
  const list = await link.request({ cmd: "list", map })
  if (!list.ok && wrongMap(list)) throw new Error(wrongMap(list))
  for (const program of list.programs ?? []) {
    let text = ""
    let from = 1
    while (from !== undefined) {
      const part = await link.request({ cmd: "get", name: program.name, from, map })
      if (!part.ok) throw new Error(`не удалось скачать «${program.name}»`)
      text += part.text
      from = part.next
    }
    // Новая папка — сразу с src.
    mkdirSync(join(folder, "src"), { recursive: true })
    const file = fileOf(folder, program.name)
    mkdirSync(dirname(file), { recursive: true })
    synced.set(file, text)
    writeFileSync(file, text)
    console.log(`automaton: «${program.name}» v${program.version} → ${file}`)
  }
  const types = join(HERE, "..", "automaton.d.ts")
  if (existsSync(types) && !existsSync(join(folder, "automaton.d.ts"))) copyFileSync(types, join(folder, "automaton.d.ts"))
}

/**
 * Слежение — в отдельном процессе: когда игра записывает новую версию утилиты («Папка для VS Code»),
 * процесс-сторож перезапускает его, и задача VS Code продолжает работать уже с новой версией.
 */
function supervise() {
  let worker
  const start = () => {
    worker = spawn(process.execPath, [SELF, ...process.argv.slice(2), "--worker"], { stdio: "inherit" })
    worker.on("exit", (code, signal) => {
      if (!restarting && signal === null) process.exit(code ?? 0)
    })
  }
  let restarting = false
  let timer
  let running = TOOL
  watch(SELF, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      // macOS сообщает и о правке, сделанной незадолго до начала слежения: перезапуск — только если текст другой.
      const now = existsSync(SELF) ? createHash("sha1").update(readFileSync(SELF)).digest("hex").slice(0, 12) : running
      if (now === running) return
      running = now
      console.log("automaton: утилита обновилась — перезапускаю")
      restarting = true
      worker.once("exit", () => {
        restarting = false
        start()
      })
      worker.kill()
    }, 500)
  })
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      worker.kill()
      process.exit(0)
    })
  }
  start()
}

async function main() {
  if (mode === "watch" && !process.argv.includes("--worker")) {
    supervise()
    return
  }
  const rcon = useRcon ? new Rcon() : new Udp()
  await rcon.connect()
  if (mode === "pull") {
    await pull(rcon)
    rcon.close()
    return
  }
  if (mode === "push" || mode === "delete") {
    let ok = true
    for (const file of positional) {
      const path = resolve(file)
      ok = (mode === "push" ? await push(rcon, path, true) : await remove(rcon, path, existsSync(path) ? readFileSync(path, "utf8") : undefined)) && ok
    }
    rcon.close()
    process.exitCode = ok ? 0 : 1
    return
  }
  // watch: начало и конец каждой публикации отмечены — по ним VS Code обновляет список ошибок.
  // Файлы, которые уже лежат в папке (и подпапках), считаются синхронными (иначе запуск опубликовал бы все разом).
  const programs = programsDir(folder)
  const files = programFiles(programs)
  for (const file of files) synced.set(file, readFileSync(file, "utf8").replace(/\r\n/g, "\n"))
  console.log(`automaton: слежу за ${programs} (Ctrl+C — выход)`)
  await compare(rcon, files).catch((error) => console.log(`automaton: ${error.message}`))
  const timers = new Map()
  /** Удалённые файлы ждут немного: если появится такой же файл в другом месте — это перенос, а не удаление. */
  const pendingDeletes = new Map()
  let queue = Promise.resolve()
  const run = (job) => {
    queue = queue.then(async () => {
      console.log("automaton: публикация начата")
      try {
        await job()
      } catch (error) {
        console.log(`automaton: ${error.message}`)
      }
      console.log("automaton: публикация закончена")
    })
  }
  listen(rcon, (job) => run(job))
  /** Файл исчез, а его текст (без путей импорта) совпадает с новым — перенос. */
  const movedFrom = (source) => {
    const key = withoutImportPaths(source)
    for (const [old, pending] of pendingDeletes) if (withoutImportPaths(pending.source) === key) return old
    for (const [old, text] of synced) if (!existsSync(old) && withoutImportPaths(text) === key) return old
    return undefined
  }
  const onChange = (_event, file) => {
    if (file === null || !file.endsWith(".ts") || file.endsWith(".d.ts") || file.split(/[\\/]/).some((part) => part.startsWith(".") || part === "node_modules")) return
    const path = join(folder, file)
    if (programs !== folder && !path.startsWith(programs + sep)) return
    clearTimeout(timers.get(path))
    timers.set(
      path,
      setTimeout(() => {
        if (existsSync(path)) {
          const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n")
          const from = synced.has(path) ? undefined : movedFrom(source)
          if (from !== undefined) {
            const pending = pendingDeletes.get(from)
            if (pending !== undefined) clearTimeout(pending.timer)
            pendingDeletes.delete(from)
            const oldSource = pending?.source ?? synced.get(from)
            run(async () => {
              if (await rename(rcon, from, path, oldSource)) await push(rcon, path)
            })
            return
          }
          run(() => push(rcon, path))
        } else if (synced.has(path)) {
          const source = synced.get(path)
          pendingDeletes.set(path, {
            source,
            timer: setTimeout(() => {
              pendingDeletes.delete(path)
              if (!existsSync(path) && synced.has(path)) run(() => remove(rcon, path, source))
            }, 1000),
          })
        }
      }, 300),
    )
  }
  // Подпапки (модули в папках): recursive есть в macOS и Windows, в Linux — с Node.js 20.
  try {
    watch(folder, { recursive: true }, onChange)
  } catch {
    console.log("automaton: эта версия Node.js не следит за подпапками — обновите Node.js до 20+")
    watch(folder, onChange)
  }
}

/** Файлы программ в папке и подпапках (без .d.ts, скрытых папок и node_modules). */
function programFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) programFiles(path, out)
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(path)
  }
  return out
}

main().catch((error) => {
  console.error(`automaton: ${error.message}`)
  process.exit(1)
})
