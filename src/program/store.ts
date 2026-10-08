// Библиотека программ команды (5.4): исходник, версия и скомпилированный Lua (в storage — переживает
// сохранение; при загрузке нужен только load, без компилятора). Публикация = компиляция: программа
// с ошибками не публикуется. Компилируют все игроки одинаково (lockstep), готовый Lua от игрока не принимается.
// Права и лимиты (5.8): кто может публиковать (настройка карты), частота публикаций, число программ команды,
// карантин программ, которые раз за разом упираются в лимиты.
import { LuaPlayer } from "factorio:runtime"
import { compile, MAX_SOURCE_BYTES } from "../lang/codegen"
import { Diagnostic } from "../lang/lexer"
import { loadProgram, Program } from "../lang/runtime"

export interface ProgramVersion {
  version: number
  source: string
  tick: number
  author?: string
}

export interface ProgramRecord {
  id: number
  name: string
  /** Команда (force), которой принадлежит программа. */
  force: string
  source: string
  version: number
  lua: string
  lines: number[]
  keys: Record<number, string>
  pauses: Record<number, number[]>
  updatedTick: number
  /** Кто опубликовал последнюю версию. */
  author?: string
  /** Последние версии (новые в конце). */
  history: ProgramVersion[]
  /** Ошибки лимитов у машин с программой (тики) — для карантина. */
  limitErrors: number[]
  /** Программа остановлена за постоянные ошибки лимитов; снимается новой публикацией. */
  quarantined?: boolean
}

export interface ProgramsState {
  nextId: number
  byId: Record<number, ProgramRecord | undefined>
  /** Последняя публикация игрока (тик) — ограничение частоты. */
  lastPublish: Record<number, number | undefined>
}

export const MAX_PROGRAMS_PER_FORCE = 200
export const HISTORY_VERSIONS = 10
export const PUBLISH_INTERVAL_TICKS = 60
/** Карантин: столько ошибок лимитов за окно — программа останавливается. */
export const QUARANTINE_ERRORS = 10
export const QUARANTINE_WINDOW_TICKS = 10 * 60 * 60

export function initPrograms(): void {
  storage.programs ??= { nextId: 1, byId: {}, lastPublish: {} }
  storage.programs.lastPublish ??= {}
  for (const [, program] of pairs(storage.programs.byId)) {
    program.force ??= "player"
    program.history ??= []
    program.limitErrors ??= []
    program.pauses ??= {}
  }
}

export function findProgram(name: string, force = "player"): ProgramRecord | undefined {
  for (const [, program] of pairs(storage.programs.byId)) {
    if (program.name === name && program.force === force) return program
  }
  return undefined
}

/** Программы команды по алфавиту. */
export function programsOf(force: string): ProgramRecord[] {
  const list: ProgramRecord[] = []
  for (const [, program] of pairs(storage.programs.byId)) if (program.force === force) list.push(program)
  table.sort(list, (a, b) => a.name < b.name)
  return list
}

export type PublishResult = { ok: true; program: ProgramRecord } | { ok: false; diagnostics: Diagnostic[] }

const publishedListeners: Array<(this: void, program: ProgramRecord) => void> = []
const removedListeners: Array<(this: void, program: ProgramRecord) => void> = []

/** Новая версия программы опубликована (машины с ней перезапускаются). */
export function onProgramPublished(listener: (this: void, program: ProgramRecord) => void): void {
  publishedListeners.push(listener)
}

/** Программу удалили или отправили в карантин (машины с ней останавливаются). */
export function onProgramRemoved(listener: (this: void, program: ProgramRecord) => void): void {
  removedListeners.push(listener)
}

function failure(code: string, params: (string | number)[] = []): PublishResult {
  return { ok: false, diagnostics: [{ code, params, line: 1, column: 1 }] }
}

export interface PublishRequest {
  name: string
  source: string
  author?: string
  force?: string
  /** Опубликовать новую версию этой программы (возможно, с новым именем). */
  id?: number
}

/** Опубликовать программу: новую или новую версию существующей (по id или по имени в команде). */
export function publish(request: PublishRequest): PublishResult {
  const force = request.force ?? "player"
  const name = request.name.trim()
  if (name === "" || name.length > 60) return failure("bad-program-name")
  if (request.source.length > MAX_SOURCE_BYTES) return failure("program-too-large", [MAX_SOURCE_BYTES])
  let program = request.id !== undefined ? storage.programs.byId[request.id] : findProgram(name, force)
  const sameName = findProgram(name, force)
  if (program !== undefined && sameName !== undefined && sameName !== program) return failure("program-name-taken", [name])
  if (program === undefined && programsOf(force).length >= MAX_PROGRAMS_PER_FORCE) return failure("too-many-programs", [MAX_PROGRAMS_PER_FORCE])
  // Ошибка в самом компиляторе не должна ронять мод: она становится ошибкой публикации.
  const [ok, result] = pcall(compile, request.source)
  if (!ok) return failure("internal-error", [tostring(result)])
  const compiled = result as ReturnType<typeof compile>
  if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics }
  if (program === undefined) {
    const id = storage.programs.nextId++
    program = {
      id,
      name,
      force,
      source: "",
      version: 0,
      lua: "",
      lines: [],
      keys: {},
      pauses: {},
      updatedTick: game.tick,
      history: [],
      limitErrors: [],
    }
    storage.programs.byId[id] = program
  }
  program.name = name
  program.source = request.source
  program.version++
  program.lua = compiled.lua
  program.lines = compiled.lines
  program.keys = compiled.keys
  program.pauses = compiled.pauses
  program.updatedTick = game.tick
  program.author = request.author
  program.quarantined = undefined
  program.limitErrors = []
  program.history.push({ version: program.version, source: request.source, tick: game.tick, author: request.author })
  while (program.history.length > HISTORY_VERSIONS) program.history.shift()
  for (const listener of publishedListeners) listener(program)
  return { ok: true, program }
}

/** Опубликовать по имени (тесты, remote-интерфейс). */
export function publishProgram(name: string, source: string, author?: string): PublishResult {
  return publish({ name, source, author })
}

export function deleteProgram(id: number): void {
  const program = storage.programs.byId[id]
  if (program === undefined) return
  storage.programs.byId[id] = undefined
  for (const listener of removedListeners) listener(program)
}

/** Может ли игрок публиковать (настройка карты «кто может публиковать», частота). */
export function publishDenied(player: LuaPlayer): string | undefined {
  const rights = settings.global["automaton-publish-rights"]?.value as string | undefined
  if (rights === "admins" && game.is_multiplayer() && !player.admin) return "publish-admins-only"
  const last = storage.programs.lastPublish[player.index]
  if (last !== undefined && game.tick - last < PUBLISH_INTERVAL_TICKS) return "publish-too-often"
  return undefined
}

export function notePublish(player: LuaPlayer): void {
  storage.programs.lastPublish[player.index] = game.tick
}

/** Ошибка лимита у машины с программой. true — программа уходит в карантин. */
export function noteLimitError(program: ProgramRecord): boolean {
  const now = game.tick
  program.limitErrors.push(now)
  while (program.limitErrors.length > 0 && now - program.limitErrors[0] > QUARANTINE_WINDOW_TICKS) program.limitErrors.shift()
  if (program.quarantined || program.limitErrors.length < QUARANTINE_ERRORS) return false
  program.quarantined = true
  for (const listener of removedListeners) listener(program)
  return true
}

/** Загруженные программы: функции Lua хранить в storage нельзя, поэтому кэш собирается заново после загрузки игры. */
const loaded = new LuaMap<number, { version: number; program: Program }>()

export function loadedProgram(record: ProgramRecord): Program | string {
  const cached = loaded.get(record.id)
  if (cached !== undefined && cached.version === record.version) return cached.program
  const program = loadProgram(record.lua, record.lines, record.keys, record.pauses ?? {})
  if (typeof program === "string") return program
  loaded.set(record.id, { version: record.version, program })
  return program
}
