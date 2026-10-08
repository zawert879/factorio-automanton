#!/usr/bin/env node
// Automaton: синхронизация программ между VS Code и игрой (через RCON). Нужен Node.js 18+, зависимостей нет.
//
//   node automaton-sync.mjs [watch] [папка]   — следить за папкой: сохранили файл .ts — программа опубликована
//   node automaton-sync.mjs push файл.ts…     — опубликовать файлы один раз
//   node automaton-sync.mjs pull [папка]      — скачать программы команды из игры в папку
//
// Имя программы — имя файла без .ts (или первая строка «// @program Имя»).
// Связь с игрой:
//   UDP (по умолчанию; игра с окном — одиночная или по сети): параметр запуска игры «--enable-lua-udp 27155»
//     (в Steam: Свойства → Параметры запуска); утилита: --udp 27155 (по умолчанию);
//   RCON (выделенный сервер): --rcon --port 27015 --password … (или AUTOMATON_RCON_PASSWORD).
// Параметры можно положить в .automaton-sync.json в папке: { "udp": 27155 } или { "rcon": true, "port": …, "password": … }.
// Ошибки печатаются как «файл:строка:столбец: error: текст» — VS Code показывает их в коде (docs/VSCODE.md).
import { createSocket } from "node:dgram"
import { copyFileSync, existsSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PART = 1500

// ---------- Параметры ----------

const argv = process.argv.slice(2)
const options = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--rcon") options.rcon = true
  else if (argv[i].startsWith("--")) options[argv[i].slice(2)] = argv[++i]
  else positional.push(argv[i])
}
const mode = ["watch", "push", "pull"].includes(positional[0]) ? positional.shift() : "watch"
const folder = resolve(mode === "push" ? "." : (positional[0] ?? "."))
const configFile = join(folder, ".automaton-sync.json")
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {}
const useRcon = options.rcon === true || config.rcon === true
const host = options.host ?? config.host ?? "127.0.0.1"
const port = Number(options.port ?? config.port ?? 27015)
const udpPort = Number(options.udp ?? config.udp ?? 27155)
const password = options.password ?? process.env.AUTOMATON_RCON_PASSWORD ?? config.password
const lang = options.lang ?? config.lang ?? (/^ru/i.test(process.env.LANG ?? "ru") ? "ru" : "en")

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
    const reply = (await this.command(`/automaton-sync ${JSON.stringify(data)}`)).trim()
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
      this.socket.send(JSON.stringify({ ...data, id }), udpPort, "127.0.0.1")
    })
  }

  close() {
    this.socket?.close()
  }
}

// ---------- Публикация и загрузка ----------

function programName(file, source) {
  const marker = /^\/\/\s*@program\s+(.+)$/m.exec(source.split("\n")[0] ?? "")
  return marker ? marker[1].trim() : basename(file).replace(/\.ts$/, "")
}

/** Текст, который уже есть в игре (опубликован или скачан): такой файл не публикуется повторно. */
const synced = new Map()

async function push(link, file, force = false) {
  const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
  if (!force && synced.get(file) === source) return true
  const name = programName(file, source)
  const begin = await link.request({ cmd: "begin", name })
  if (!begin.ok) {
    for (const error of begin.errors ?? []) console.log(`${file}:1:1: error: ${message(error)}`)
    if (begin.errors === undefined) throw new Error(`игра не приняла программу: ${begin.error}`)
    return false
  }
  let parts = 0
  for (let i = 0; i < source.length; i += PART) {
    parts++
    const part = await link.request({ cmd: "part", seq: parts, text: source.slice(i, i + PART) })
    if (!part.ok) throw new Error(`игра не приняла часть программы: ${part.error}`)
  }
  const result = await link.request({ cmd: "end", parts })
  if (result.ok) {
    synced.set(file, source)
    console.log(`automaton: «${name}» опубликована, v${result.version}`)
    return true
  }
  for (const error of result.errors ?? [{ line: 1, column: 1, code: result.error ?? "error" }]) {
    console.log(`${file}:${Math.max(1, error.line)}:${Math.max(1, error.column)}: error: ${message(error)}`)
  }
  return false
}

async function pull(link) {
  const list = await link.request({ cmd: "list" })
  for (const program of list.programs ?? []) {
    let text = ""
    let from = 1
    while (from !== undefined) {
      const part = await link.request({ cmd: "get", name: program.name, from })
      if (!part.ok) throw new Error(`не удалось скачать «${program.name}»`)
      text += part.text
      from = part.next
    }
    const file = join(folder, `${program.name.replace(/[/\\:*?"<>|]/g, "_")}.ts`)
    synced.set(file, text)
    writeFileSync(file, text)
    console.log(`automaton: «${program.name}» v${program.version} → ${file}`)
  }
  const types = join(HERE, "..", "automaton.d.ts")
  if (existsSync(types) && !existsSync(join(folder, "automaton.d.ts"))) copyFileSync(types, join(folder, "automaton.d.ts"))
}

async function main() {
  const rcon = useRcon ? new Rcon() : new Udp()
  await rcon.connect()
  if (mode === "pull") {
    await pull(rcon)
    rcon.close()
    return
  }
  if (mode === "push") {
    let ok = true
    for (const file of positional) ok = (await push(rcon, resolve(file), true)) && ok
    rcon.close()
    process.exitCode = ok ? 0 : 1
    return
  }
  // watch: начало и конец каждой публикации отмечены — по ним VS Code обновляет список ошибок.
  // Файлы, которые уже лежат в папке, считаются синхронными (иначе запуск опубликовал бы все разом).
  for (const file of readdirSync(folder)) {
    if (file.endsWith(".ts") && !file.endsWith(".d.ts")) synced.set(join(folder, file), readFileSync(join(folder, file), "utf8").replace(/\r\n/g, "\n"))
  }
  console.log(`automaton: слежу за ${folder} (Ctrl+C — выход)`)
  const timers = new Map()
  let queue = Promise.resolve()
  watch(folder, (_event, file) => {
    if (file === null || !file.endsWith(".ts") || file.endsWith(".d.ts")) return
    clearTimeout(timers.get(file))
    timers.set(
      file,
      setTimeout(() => {
        const path = join(folder, file)
        if (!existsSync(path)) return
        queue = queue.then(async () => {
          console.log("automaton: публикация начата")
          try {
            await push(rcon, path)
          } catch (error) {
            console.log(`automaton: ${error.message}`)
          }
          console.log("automaton: публикация закончена")
        })
      }, 300),
    )
  })
}

main().catch((error) => {
  console.error(`automaton: ${error.message}`)
  process.exit(1)
})
