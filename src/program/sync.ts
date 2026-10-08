// Синхронизация с VS Code (5.10). Утилита mod/tools/automaton-sync.mjs публикует сохранённые файлы и
// скачивает программы команды. Два пути связи, один протокол (запрос и ответ — JSON):
// - UDP (игра с окном, одиночная и по сети): игра запущена с --enable-lua-udp <порт>; мод каждые несколько
//   тиков вызывает helpers.recv_udp — пакеты становятся событием у всех участников (через действия ввода),
//   ответ уходит с экземпляра игры, который получил пакет; читаются только экземпляры игроков: выделенный
//   сервер без игрока падает на пакете UDP (ошибка движка 2.0.77 «invalid input action») — там нужен RCON;
// - RCON (выделенный сервер): команда /automaton-sync <json>, ответ — rcon.print.
// Большая программа передаётся частями с номерами (повтор потерянного пакета не задваивает текст). Части
// копятся в storage: запросы исполняют все участники, и подключившийся посреди передачи получит тот же текст.
// Каждая опубликованная программа выгружается в script-output/automaton/<команда>/<имя>.ts (только на сервере).
import { CustomCommandData, LuaPlayer, PlayerIndex } from "factorio:runtime"
import { onEvent, onTick } from "../events"
import { Diagnostic } from "../lang/lexer"
import { DTS, SYNC_TOOL, TSCONFIG } from "../gui/dts.generated"
import { findProgram, notePublish, onProgramPublished, programsOf, publish, publishDenied } from "./store"

/** Задача VS Code: при открытии папки следить за ней и публиковать сохранённые программы (ошибки — в коде). */
// (JSON.stringify в Lua Factorio нет — готовая строка.)
const TASKS = `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Automaton: публиковать при сохранении",
      "type": "shell",
      "command": "node",
      "args": [
        "\${workspaceFolder}/automaton-sync.mjs",
        "watch",
        "\${workspaceFolder}"
      ],
      "isBackground": true,
      "runOptions": {
        "runOn": "folderOpen"
      },
      "presentation": {
        "reveal": "silent"
      },
      "problemMatcher": {
        "owner": "automaton",
        "fileLocation": "absolute",
        "pattern": {
          "regexp": "^(.+?):(\\\\d+):(\\\\d+): (error|warning): (.*)$",
          "file": 1,
          "line": 2,
          "column": 3,
          "severity": 4,
          "message": 5
        },
        "background": {
          "activeBegin": true,
          "beginsPattern": "^automaton: публикация начата",
          "endsPattern": "^automaton: публикация закончена"
        }
      }
    }
  ]
}
`

const README = `Папка программ автоматонов для VS Code (мод Automaton).

1. Откройте эту папку в VS Code (Файл → Открыть папку) и разрешите автоматическую задачу
   «Automaton: публиковать при сохранении» (нужен Node.js 18+).
2. Запускайте игру с параметром «--enable-lua-udp 27155» (Steam: Factorio → Свойства → Параметры запуска).
3. Сохранили файл .ts — программа опубликована в игре; ошибки подчёркнуты в коде.
   Имя программы — имя файла. Новые программы из игры: «node automaton-sync.mjs pull».
Выделенный сервер: RCON — «node automaton-sync.mjs watch . --rcon --port … --password …».
`


const GET_CHUNK = 2000
const UDP_POLL_TICKS = 6

export interface SyncBuffer {
  name: string
  force: string
  parts: Record<number, string>
}

interface Request {
  id?: number
  cmd?: string
  name?: string
  force?: string
  seq?: number
  text?: string
  parts?: number
  from?: number
}

function buffers(): Record<string, SyncBuffer | undefined> {
  storage.sync ??= {}
  return storage.sync
}

/** Имя файла из имени программы: без символов, запрещённых в путях. */
export function fileName(name: string): string {
  const [safe] = string.gsub(name, '[/\\:*?"<>|%c]', "_")
  return safe
}

function diagnosticsJson(diagnostics: Diagnostic[]): unknown[] {
  return diagnostics.map((d) => ({ line: d.line, column: d.column, code: d.code, params: d.params.map((p) => tostring(p)) }))
}

/** Обработать запрос утилиты; sender — ключ передачи (кто шлёт), player — игрок (нет — сервер). */
function handle(request: Request, sender: string, player: LuaPlayer | undefined): Record<string, unknown> {
  const force = request.force ?? player?.force.name ?? "player"
  if (player !== undefined && (request.cmd === "begin" || request.cmd === "end")) {
    const denied = publishDenied(player)
    if (denied !== undefined) return { ok: false, errors: [{ line: 0, column: 0, code: denied, params: [] }] }
  }
  switch (request.cmd) {
    case "begin":
      if (typeof request.name !== "string") return { ok: false, error: "bad request" }
      buffers()[sender] = { name: request.name, force, parts: {} }
      return { ok: true }
    case "part": {
      const buffer = buffers()[sender]
      if (buffer === undefined || typeof request.seq !== "number" || typeof request.text !== "string") return { ok: false, error: "no transfer" }
      buffer.parts[request.seq] = request.text
      return { ok: true }
    }
    case "end": {
      const buffer = buffers()[sender]
      if (buffer === undefined) return { ok: false, error: "no transfer" }
      const parts: string[] = []
      for (let i = 1; i <= (request.parts ?? 0); i++) {
        const part = buffer.parts[i]
        if (part === undefined) return { ok: false, error: `missing part ${i}` }
        parts.push(part)
      }
      buffers()[sender] = undefined
      if (player !== undefined) notePublish(player)
      const result = publish({ name: buffer.name, source: parts.join(""), force: buffer.force, author: player?.name ?? "VS Code" })
      if (!result.ok) return { ok: false, errors: diagnosticsJson(result.diagnostics) }
      return { ok: true, version: result.program.version }
    }
    case "list":
      return { ok: true, programs: programsOf(force).map((p) => ({ name: p.name, version: p.version })) }
    case "get": {
      // Ответ ограничен по размеру: программа отдаётся частями по ~2000 байт с позиции from,
      // граница части — между символами UTF-8; next — откуда продолжать (нет — всё).
      const program = typeof request.name === "string" ? findProgram(request.name, force) : undefined
      if (program === undefined) return { ok: false, error: "no program" }
      const source = program.source
      const from = request.from ?? 1
      let to = math.min(from + GET_CHUNK - 1, source.length)
      while (to < source.length && to > from) {
        const next = string.byte(source, to + 1)
        if (next < 0x80 || next >= 0xc0) break
        to--
      }
      return { ok: true, version: program.version, text: string.sub(source, from, to), next: to < source.length ? to + 1 : undefined }
    }
  }
  return { ok: false, error: "unknown command" }
}

function parse(text: string): Request | undefined {
  const [ok, value] = pcall(helpers.json_to_table, text)
  return ok && type(value) === "table" ? (value as Request) : undefined
}

function reply(request: Request | undefined, result: Record<string, unknown>): string {
  result.id = request?.id
  return helpers.table_to_json(result as never)
}

function onCommand(command: CustomCommandData): void {
  const request = parse(command.parameter ?? "")
  const player = command.player_index === undefined ? undefined : game.get_player(command.player_index)
  const sender = player === undefined ? "rcon" : `player:${player.index}`
  const text = reply(request, request === undefined ? { ok: false, error: "bad request" } : handle(request, sender, player))
  if (player === undefined) rcon.print(text)
  else player.print(text)
}

/** Экземпляры игроков, у которых UDP не включён (вызов recv_udp — ошибка): больше не пробуем. */
const udpDisabled = new LuaSet<number>()

/** Записать папку для VS Code (у игрока): программы команды, типы, tsconfig, утилиту, задачу VS Code. */
export function writeVsCodeFolder(player: LuaPlayer): string {
  const dir = `automaton/${fileName(player.force.name)}`
  const write = (path: string, text: string) => helpers.write_file(`${dir}/${path}`, text, false, player.index)
  write("automaton.d.ts", DTS)
  write("tsconfig.json", TSCONFIG)
  write("automaton-sync.mjs", SYNC_TOOL)
  write(".vscode/tasks.json", TASKS)
  write("README.txt", README)
  for (const program of programsOf(player.force.name)) write(`${fileName(program.name)}.ts`, program.source)
  return dir
}

export function registerSync(): void {
  commands.add_command("automaton-sync", ["automaton.sync-help"], (command) => onCommand(command))
  // UDP: пакеты, полученные игрой, — событием у всех участников; ответ — с того же экземпляра игры.
  onTick((tick) => {
    if (tick % UDP_POLL_TICKS !== 0) return
    for (const player of game.connected_players) {
      if (udpDisabled.has(player.index)) continue
      // Без --enable-lua-udp у экземпляра игрока вызов — ошибка: тогда у него больше не пробуем.
      const [ok] = pcall(() => helpers.recv_udp(player.index))
      if (!ok) udpDisabled.add(player.index)
    }
  })
  onEvent(defines.events.on_udp_packet_received, (e) => {
    const request = parse(e.payload)
    const player = e.player_index === 0 ? undefined : game.get_player(e.player_index as PlayerIndex)
    const sender = `udp:${e.player_index}:${e.source_port}`
    const text = reply(request, request === undefined ? { ok: false, error: "bad request" } : handle(request, sender, player))
    helpers.send_udp(e.source_port, text, e.player_index)
  })
  // Выгрузка опубликованных программ — только на сервере (в одиночной игре — у игрока).
  onProgramPublished((program) => {
    helpers.write_file(`automaton/${fileName(program.force)}/${fileName(program.name)}.ts`, program.source, false, 0)
  })
}
