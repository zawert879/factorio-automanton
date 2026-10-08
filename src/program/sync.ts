// Синхронизация с VS Code (5.10). Утилита mod/tools/automaton-sync.mjs публикует сохранённые файлы и
// скачивает программы команды. Два пути связи, один протокол (запрос и ответ — JSON):
// - UDP (игра с окном, одиночная и по сети): игра запущена с --enable-lua-udp <порт>; мод каждые несколько
//   тиков вызывает helpers.recv_udp — пакеты становятся событием у всех участников (через действия ввода),
//   ответ уходит с экземпляра игры, который получил пакет; читаются только экземпляры игроков: выделенный
//   сервер без игрока падает на пакете UDP (ошибка движка 2.0.77 «invalid input action») — там нужен RCON;
// - RCON (выделенный сервер): команда /automaton-sync <json>, ответ — rcon.print.
// Большая программа передаётся частями с номерами (повтор потерянного пакета не задваивает текст). Части
// копятся в storage: запросы исполняют все участники, и подключившийся посреди передачи получит тот же текст.
// Папка src — зеркало программ команды в обе стороны:
// - игра → файлы: опубликованная программа выгружается в script-output/automaton/<карта>/<команда>/src/<имя>.ts
//   у каждого участника (у каждого своя папка для VS Code); удалённая — удаляется, переименованная — переезжает
//   (импорты зависимых игра правит сама, их файлы переписываются вместе с новыми версиями);
// - файлы → игра: утилита публикует сохранённый файл, удалённый — удаляет (delete), перенесённый — переименовывает
//   (rename). Изменения, которые сделала сама игра, утилита видит как свои — игра отвечает «уже так».
// Папки в имени программы (этап 17) — подпапки; служебные файлы (типы, tsconfig, утилита) — рядом с src. У каждой карты своя папка: имя карты — по номеру
// (seed), запоминается в сохранении. В папке лежит .automaton-map.json — утилита передаёт имя карты, и игра
// не принимает файлы из папки другой карты.
import { CustomCommandData, LuaPlayer, PlayerIndex } from "factorio:runtime"
import { onEvent, onTick } from "../events"
import { Diagnostic } from "../lang/lexer"
import { DTS, SYNC_TOOL, SYNC_TOOL_HASH, TS_PLUGIN, TSCONFIG } from "../gui/dts.generated"
import {
  deleteProgram,
  findProgram,
  notePublish,
  onProgramPublished,
  onProgramRemoved,
  onProgramRenamed,
  programsOf,
  publish,
  publishDenied,
  PublishResult,
  rightsDenied,
} from "./store"

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

Это папка одной карты: программы из неё публикуются только в эту карту (имя — в .automaton-map.json).

1. Откройте эту папку в VS Code (Файл → Открыть папку) и разрешите автоматическую задачу
   «Automaton: публиковать при сохранении» (нужен Node.js 18+).
2. Запускайте игру с параметром «--enable-lua-udp 27155» (Steam: Factorio → Свойства → Параметры запуска).
3. Программы лежат в папке src. Сохранили файл .ts — программа опубликована в игре; ошибки подчёркнуты
   в коде. Удалили файл — программа удалена и в игре; переименовали или перенесли — переименована (импорты
   в других программах поправятся). Имя программы — путь файла в src без .ts: src/lib/Помощники.ts —
   программа «lib/Помощники».
   Импорт между программами — как между файлами: import { nearMarker } from "../lib/Помощники".
   Новые программы из игры: «node automaton-sync.mjs pull». Меняли файлы без задачи синхронизации —
   кнопка «Обновить из папки» в окне программ.
4. Плагин TypeScript подчёркивает то, чего нет в языке машин (async/await, var, enum…), и подсказывает,
   сколько тиков займёт цикл (наведите на for / while). Не заработал — «TypeScript: Restart TS Server».
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
  /** refresh-done: итог сверки src с игрой. */
  published?: string[]
  failed?: string[]
  missing?: string[]
  id?: number
  /** Версия утилиты (хеш её файла): другая — запрос отклоняется. */
  tool?: string
  cmd?: string
  /** rename: новое имя программы (старое — name). */
  to?: string
  /** Имя карты из .automaton-map.json папки: файлы другой карты не принимаются. */
  map?: string
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

/**
 * Имя карты для папки VS Code. Задаётся при создании карты, а в сохранении, где его ещё нет (мод обновили
 * без смены версии — on_configuration_changed не было), — при первом обращении: обращаются только
 * обработчики событий, одинаковые у всех участников, поэтому запись в storage десинка не даёт.
 */
export function mapName(): string {
  storage.mapName ??= `карта-${game.get_surface("nauvis")?.map_gen_settings.seed ?? 0}`
  return storage.mapName
}

export function initSync(): void {
  mapName()
}

/** Папка программ команды этой карты в script-output. */
export function syncFolder(force: string): string {
  return `automaton/${fileName(mapName())}/${fileName(force)}`
}

/** Путь файла программы: папки из имени — подпапки (lib/Помощники → lib/Помощники.ts). */
export function programPath(name: string): string {
  return `${name.split("/").map((part) => fileName(part)).join("/")}.ts`
}

/** Ответ на публикацию: версия, пересобранные зависимые и те, что не собрались (их ошибки — в их файлах). */
function publishReply(result: PublishResult, force: string): Record<string, unknown> {
  if (!result.ok) return { ok: false, errors: diagnosticsJson(result.diagnostics) }
  // Тот же текст — новой версии нет (например, файл записала сама игра).
  if (result.rebuilt === undefined) return { ok: true, version: result.program.version, unchanged: true }
  const stale = (result.stale ?? []).map((name) => ({ name, errors: diagnosticsJson(findProgram(name, force)?.stale?.diagnostics ?? []) }))
  return { ok: true, version: result.program.version, rebuilt: result.rebuilt, stale }
}

function diagnosticsJson(diagnostics: Diagnostic[]): unknown[] {
  return diagnostics.map((d) => ({ line: d.line, column: d.column, code: d.code, params: d.params.map((p) => tostring(p)), module: d.module }))
}

/** Порт, на котором утилита в режиме слежения ждёт сигналы игры (кнопка «Обновить из папки»). */
export const TOOL_PORT = 27154

/**
 * Попросить утилиту сверить src с игрой: она опубликует новые и изменённые файлы и пришлёт итог
 * (refresh-done). Пакет уходит только с экземпляра игры этого игрока; без --enable-lua-udp — не уходит
 * (результат вызова не используется: он у участников разный, а состояние игры — общее).
 */
export function requestRefresh(player: LuaPlayer): void {
  storage.refreshPending ??= {}
  storage.refreshPending[player.index] = game.tick
  pcall(() => helpers.send_udp(TOOL_PORT, helpers.table_to_json({ cmd: "refresh", map: mapName(), force: player.force.name }), player.index))
}

type RefreshListener = (this: void, player: LuaPlayer, published: string[], failed: string[], missing: string[]) => void
const refreshListeners: RefreshListener[] = []
const timeoutListeners: Array<(this: void, player: LuaPlayer) => void> = []

/** Утилита не ответила на «Обновить из папки» (задача не запущена, старая утилита, игра без UDP). */
export function onRefreshTimeout(listener: (this: void, player: LuaPlayer) => void): void {
  timeoutListeners.push(listener)
}

/** Утилита сверила src с игрой (окно программ показывает итог и спрашивает про программы без файлов). */
export function onRefreshResult(listener: RefreshListener): void {
  refreshListeners.push(listener)
}

/** Настройки VS Code для папки: где искать плагин TypeScript (.automaton/node_modules), скрыть служебное. */
const VSCODE_SETTINGS = `{
  "typescript.tsserver.pluginPaths": ["./.automaton"],
  "files.exclude": { ".automaton": true }
}
`

/** Утилита другой версии, чем мод (её запустили до обновления): что сделать — текстом (старая утилита его покажет). */
const OUTDATED_TOOL =
  "утилита синхронизации устарела: игра записала новую в папку (или нажмите «Программы…» → «Папка для VS Code») — перезапустите задачу синхронизации в VS Code (Cmd/Ctrl+Shift+P → Tasks: Restart Running Task)"

/** Сколько ждать ответа утилиты на «Обновить из папки», тиков. */
const REFRESH_TIMEOUT = 180

/**
 * Устаревшая утилита постучалась от игрока: переписать его папку (новая утилита, плагин, настройки) —
 * не чаще раза в минуту — и сказать, что задачу нужно перезапустить.
 */
function updateOutdatedFolder(player: LuaPlayer): void {
  storage.syncFolderUpdated ??= {}
  const last = storage.syncFolderUpdated[player.index]
  if (last !== undefined && game.tick - last < 3600) return
  storage.syncFolderUpdated[player.index] = game.tick
  writeVsCodeFolder(player)
  player.print(["automaton-gui.tool-updated"])
}

/** Контрольная сумма текста (байты UTF-8) — та же считается в утилите: сверить файлы с игрой, не скачивая. */
export function checksum(text: string): number {
  let h = 0
  for (let i = 1; i <= text.length; i++) h = (h * 31 + string.byte(text, i)) % 2147483647
  return h
}

/** Обработать запрос утилиты; sender — ключ передачи (кто шлёт), player — игрок (нет — сервер). */
function handle(request: Request, sender: string, player: LuaPlayer | undefined): Record<string, unknown> {
  if (request.tool !== SYNC_TOOL_HASH) {
    if (player !== undefined) updateOutdatedFolder(player)
    return { ok: false, error: OUTDATED_TOOL, outdated: true }
  }
  const force = request.force ?? player?.force.name ?? "player"
  // Папка другой карты (VS Code открыт не на той папке): ничего не публиковать и не отдавать.
  if (request.map !== undefined && request.map !== mapName()) {
    return { ok: false, error: "wrong-map", map: mapName(), folderMap: request.map }
  }
  if (player !== undefined && (request.cmd === "begin" || request.cmd === "end")) {
    const denied = publishDenied(player)
    if (denied !== undefined) return { ok: false, errors: [{ line: 0, column: 0, code: denied, params: [] }] }
  }
  if (player !== undefined && (request.cmd === "delete" || request.cmd === "rename")) {
    // Удаление и переименование — без ограничения частоты (файлы удаляют пачками), но по правам.
    const denied = rightsDenied(player)
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
      return publishReply(publish({ name: buffer.name, source: parts.join(""), force: buffer.force, author: player?.name ?? "VS Code" }), buffer.force)
    }
    case "delete": {
      // Файл удалён: программы нет — уже удалена; используемую библиотеку игра не удаляет.
      const program = typeof request.name === "string" ? findProgram(request.name, force) : undefined
      // Нет — уже удалена (например, в игре: файл удалила сама игра) — тихо.
      if (program === undefined) return { ok: true, already: true }
      const deleted = deleteProgram(program.id)
      return deleted.ok ? { ok: true } : { ok: false, error: "in-use", usedBy: deleted.usedBy }
    }
    case "rename": {
      // Файл переименован или перенесён: та же программа под новым именем (импорты зависимых правятся).
      const program = typeof request.name === "string" ? findProgram(request.name, force) : undefined
      if (typeof request.to !== "string") return { ok: false, error: "bad request" }
      // Уже переименована (в игре: файлы перенесла сама игра) — тихо.
      if (program === undefined) return findProgram(request.to, force) !== undefined ? { ok: true, already: true } : { ok: false, error: "no program" }
      return publishReply(publish({ id: program.id, name: request.to, source: program.source, force, author: player?.name ?? "VS Code" }), force)
    }
    case "refresh-started":
      // Утилита получила «Обновить из папки» — ждать её ответа больше не нужно.
      if (player !== undefined && storage.refreshPending !== undefined) storage.refreshPending[player.index] = undefined
      return { ok: true }
    case "refresh-done":
      // Итог кнопки «Обновить из папки» — тому, кто нажал (пакет пришёл с его экземпляра игры).
      if (player !== undefined) for (const listener of refreshListeners) listener(player, request.published ?? [], request.failed ?? [], request.missing ?? [])
      return { ok: true }
    case "list":
      return { ok: true, programs: programsOf(force).map((p) => ({ name: p.name, version: p.version, sum: checksum(p.source) })) }
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
  const dir = syncFolder(player.force.name)
  const write = (path: string, text: string) => helpers.write_file(`${dir}/${path}`, text, false, player.index)
  write("automaton.d.ts", DTS)
  // Сообщения плагина — на языке игрока.
  write("tsconfig.json", string.gsub(TSCONFIG, '"lang": "ru"', `"lang": "${player.locale === "ru" ? "ru" : "en"}"`)[0])
  write(".automaton/node_modules/automaton-ts-plugin/package.json", '{ "name": "automaton-ts-plugin", "version": "1.0.0", "main": "index.js" }\n')
  write(".automaton/node_modules/automaton-ts-plugin/index.js", TS_PLUGIN)
  write(".vscode/settings.json", VSCODE_SETTINGS)
  write("automaton-sync.mjs", SYNC_TOOL)
  write(".vscode/tasks.json", TASKS)
  write("README.txt", README)
  write(".automaton-map.json", helpers.table_to_json({ map: mapName(), force: player.force.name }))
  for (const program of programsOf(player.force.name)) write(`src/${programPath(program.name)}`, program.source)
  return dir
}

export function registerSync(): void {
  commands.add_command("automaton-sync", ["automaton.sync-help"], (command) => onCommand(command))
  // «Обновить из папки» без ответа утилиты — подсказка, что не так.
  onTick((tick) => {
    if (tick % 30 !== 0 || storage.refreshPending === undefined) return
    for (const [index, at] of pairs(storage.refreshPending)) {
      if (tick - at < REFRESH_TIMEOUT) continue
      storage.refreshPending[index] = undefined
      const player = game.get_player(index as PlayerIndex)
      if (player !== undefined) for (const listener of timeoutListeners) listener(player)
    }
  })
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
  // Зеркало программ в папке VS Code — у каждого участника (без for_player — на всех экземплярах игры).
  onProgramPublished((program) => {
    helpers.write_file(`${syncFolder(program.force)}/src/${programPath(program.name)}`, program.source, false)
  })
  onProgramRenamed((program, oldName) => {
    helpers.remove_path(`${syncFolder(program.force)}/src/${programPath(oldName)}`)
  })
  onProgramRemoved((program) => {
    // Удалена (а не в карантине): записи больше нет.
    if (storage.programs.byId[program.id] === undefined) helpers.remove_path(`${syncFolder(program.force)}/src/${programPath(program.name)}`)
  })
}
