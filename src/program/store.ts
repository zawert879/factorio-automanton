// Библиотека программ команды (5.4): исходник, версия и скомпилированный Lua (в storage — переживает
// сохранение; при загрузке нужен только load, без компилятора). Публикация = компиляция: программа
// с ошибками не публикуется. Компилируют все игроки одинаково (lockstep), готовый Lua от игрока не принимается.
// Права и лимиты (5.8): кто может публиковать (настройка карты), частота публикаций, число программ команды,
// карантин программ, которые раз за разом упираются в лимиты.
//
// Модули (этап 17, DESIGN.md «Модули»): имя программы — путь с папками; программа собирается вместе
// с программами команды, которые импортирует. Новая версия модуля пересобирает зависимые программы
// (не собралась — остаётся прежняя сборка и предупреждение stale). Используемую библиотеку удалить
// нельзя; переименование правит пути импорта в зависимых.
import { trim } from "../lang/runtime/strings"
import { LuaPlayer } from "factorio:runtime"
import { compile, CompileResult, MAX_SOURCE_BYTES, ProgramVariable } from "../lang/codegen"
import { Diagnostic } from "../lang/lexer"
import { relativeModulePath, resolveModulePath, rewriteImportPaths } from "../lang/modules"
import { loadProgram, Program } from "../lang/runtime"

export interface ProgramVersion {
  version: number
  source: string
  tick: number
  author?: string
  /** Версия собрана заново из-за новой версии этого модуля (текст программы тот же или с исправленным импортом). */
  rebuiltFor?: string
}

/** Новая версия модуля не собралась с программой: машины работают на прежней сборке. */
export interface StaleBuild {
  module: string
  version: number
  diagnostics: Diagnostic[]
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
  /** Модули сборки по номеру (0 — сама программа): строки ошибок вида «lib/Помощники:12». */
  modules: string[]
  /** Модули, которые программа импортирует (прямо и через другие), — полные имена. */
  dependencies: string[]
  /** Библиотека (только объявления и export): машине не назначается. */
  library: boolean
  stale?: StaleBuild
  /** Отладка (18.8): строки, где можно остановиться, и переменные верхнего уровня в кадре; у сборок до 18.8 нет. */
  breakable?: number[]
  variables?: ProgramVariable[]
}

export interface ProgramsState {
  nextId: number
  byId: Record<number, ProgramRecord | undefined>
  /** Последняя публикация игрока (тик) — ограничение частоты. */
  lastPublish: Record<number, number | undefined>
}

export const MAX_PROGRAMS_PER_FORCE = 200
/** Длина полного имени программы (с папками). */
export const MAX_NAME_LENGTH = 100
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
    program.modules ??= [program.name]
    program.dependencies ??= []
    program.library ??= false
  }
}

/**
 * Полное имя программы: папки через «/», пробелы вокруг частей убираются. undefined — имя не годится
 * (пусто, пустая папка, «.» или «..», обратная косая черта, кавычка, слишком длинное).
 */
export function normalizeProgramName(raw: string): string | undefined {
  const segments = raw.split("/").map((segment) => trim(segment))
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return undefined
  const name = segments.join("/")
  if (name.length > MAX_NAME_LENGTH || name.includes("\\") || name.includes('"')) return undefined
  return name
}

/** Программы команды, которые импортируют модуль (прямо или через другие). */
export function dependentsOf(name: string, force: string): ProgramRecord[] {
  return programsOf(force).filter((p) => p.name !== name && p.dependencies.includes(name))
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

export type PublishResult =
  | {
      ok: true
      program: ProgramRecord
      /** Пересобраны зависимые программы (новые версии). */
      rebuilt?: string[]
      /** Зависимые, которые с новой версией не собрались (работает прежняя сборка). */
      stale?: string[]
    }
  | { ok: false; diagnostics: Diagnostic[] }

const publishedListeners: Array<(this: void, program: ProgramRecord) => void> = []
const removedListeners: Array<(this: void, program: ProgramRecord) => void> = []

/** Новая версия программы опубликована (машины с ней перезапускаются). */
export function onProgramPublished(listener: (this: void, program: ProgramRecord) => void): void {
  publishedListeners.push(listener)
}

const renamedListeners: Array<(this: void, program: ProgramRecord, oldName: string) => void> = []

/** Программу переименовали (новое имя уже у записи; новая версия уже опубликована). */
export function onProgramRenamed(listener: (this: void, program: ProgramRecord, oldName: string) => void): void {
  renamedListeners.push(listener)
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

/** Скомпилировать программу команды (модули — программы команды; overlay — ещё не сохранённые тексты). */
function compileFor(name: string, source: string, force: string, overlay?: Map<string, string>): CompileResult {
  const resolve = (module: string) => {
    const pending = overlay?.get(module)
    if (pending !== undefined) return { name: module, source: pending }
    const found = findProgram(module, force)
    return found === undefined ? undefined : { name: found.name, source: found.source }
  }
  // Ошибка в самом компиляторе не должна ронять мод: она становится ошибкой публикации.
  const [ok, result] = pcall(compile, source, { name, resolve })
  if (!ok) return { ok: false, lua: "", lines: [], keys: {}, pauses: {}, diagnostics: [{ code: "internal-error", params: [tostring(result)], line: 1, column: 1 }] }
  return result as CompileResult
}

/** Записать новую сборку: новая версия программы, машины с ней перезапускаются. */
function applyBuild(program: ProgramRecord, compiled: CompileResult, source: string, author: string | undefined, rebuiltFor?: string): void {
  program.source = source
  program.version++
  program.lua = compiled.lua
  program.lines = compiled.lines
  program.keys = compiled.keys
  program.pauses = compiled.pauses
  program.modules = compiled.modules ?? [program.name]
  program.dependencies = (compiled.modules ?? []).slice(1)
  program.library = compiled.library === true
  program.breakable = compiled.breakable
  program.variables = compiled.variables
  program.updatedTick = game.tick
  program.author = author
  program.quarantined = undefined
  program.stale = undefined
  program.limitErrors = []
  program.history.push({ version: program.version, source, tick: game.tick, author, rebuiltFor })
  while (program.history.length > HISTORY_VERSIONS) program.history.shift()
  for (const listener of publishedListeners) listener(program)
}

/**
 * Пересобрать программу тем же текстом (18.8): сборки до отладки не знают точек остановки и переменных.
 * Новая версия — машины с ней перезапускаются. Ошибки сборки (модуль изменился) — как у публикации.
 */
export function rebuildProgram(program: ProgramRecord, author: string | undefined): Diagnostic[] {
  const compiled = compileFor(program.name, program.source, program.force)
  if (!compiled.ok) return compiled.diagnostics
  applyBuild(program, compiled, program.source, author)
  return []
}

/**
 * Пересобрать программы, которые зависят от модуля (новая версия или новое имя). При переименовании
 * пути импорта старого имени в их тексте заменяются на путь к новому.
 */
function rebuildDependents(module: ProgramRecord, oldName: string | undefined, author: string | undefined): { rebuilt: string[]; stale: string[] } {
  const affected = programsOf(module.force).filter(
    (p) => p !== module && (p.dependencies.includes(module.name) || (oldName !== undefined && p.dependencies.includes(oldName))),
  )
  // Сначала все новые тексты (зависимые могут импортировать друг друга), потом сборка.
  const overlay = new Map<string, string>()
  if (oldName !== undefined) {
    for (const p of affected) {
      const source = rewriteImportPaths(p.source, (spec) => {
        const target = resolveModulePath(p.name, spec)
        return "name" in target && target.name === oldName ? relativeModulePath(p.name, module.name) : undefined
      })
      if (source !== p.source) overlay.set(p.name, source)
    }
  }
  const rebuilt: string[] = []
  const stale: string[] = []
  for (const p of affected) {
    const source = overlay.get(p.name) ?? p.source
    const compiled = compileFor(p.name, source, p.force, overlay)
    if (compiled.ok) {
      applyBuild(p, compiled, source, author, module.name)
      rebuilt.push(p.name)
    } else {
      p.stale = { module: module.name, version: module.version, diagnostics: compiled.diagnostics }
      stale.push(p.name)
    }
  }
  return { rebuilt, stale }
}

/** Опубликовать программу: новую или новую версию существующей (по id или по имени в команде). */
export function publish(request: PublishRequest): PublishResult {
  const force = request.force ?? "player"
  const name = normalizeProgramName(request.name)
  if (name === undefined) return failure("bad-program-name", [MAX_NAME_LENGTH])
  if (request.source.length > MAX_SOURCE_BYTES) return failure("program-too-large", [MAX_SOURCE_BYTES])
  let program = request.id !== undefined ? storage.programs.byId[request.id] : findProgram(name, force)
  const sameName = findProgram(name, force)
  if (program !== undefined && sameName !== undefined && sameName !== program) return failure("program-name-taken", [name])
  if (program === undefined && programsOf(force).length >= MAX_PROGRAMS_PER_FORCE) return failure("too-many-programs", [MAX_PROGRAMS_PER_FORCE])
  // Тот же текст — не новая версия (машины не перезапускаются): так повторная публикация из VS Code безвредна.
  if (program !== undefined && program.name === name && program.source === request.source && !program.quarantined) return { ok: true, program }
  const oldName = program !== undefined && program.name !== name ? program.name : undefined
  let source = request.source
  if (oldName !== undefined) {
    // Переезд в другую папку: свои относительные импорты, которые сломались бы, ведут туда же, что и раньше.
    source = rewriteImportPaths(source, (spec) => {
      const before = resolveModulePath(oldName, spec)
      if (!("name" in before) || findProgram(before.name, force) === undefined) return undefined
      const after = resolveModulePath(name, spec)
      return "name" in after && findProgram(after.name, force) !== undefined ? undefined : relativeModulePath(name, before.name)
    })
  }
  const compiled = compileFor(name, source, force)
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
      modules: [name],
      dependencies: [],
      library: false,
    }
    storage.programs.byId[id] = program
  }
  program.name = name
  applyBuild(program, compiled, source, request.author)
  if (oldName !== undefined) for (const listener of renamedListeners) listener(program, oldName)
  const { rebuilt, stale } = rebuildDependents(program, oldName, request.author)
  return { ok: true, program, rebuilt, stale }
}

/**
 * Проверить программу, не публикуя (18.1): та же компиляция с модулями команды, что у публикации, но без новой
 * версии и перезапуска машин. Пустое или неверное имя проверке не мешает: импорты — от корня библиотеки.
 */
export function checkProgram(name: string, source: string, force: string): Diagnostic[] {
  if (source.length > MAX_SOURCE_BYTES) return [{ code: "program-too-large", params: [MAX_SOURCE_BYTES], line: 0, column: 0 }]
  const compiled = compileFor(normalizeProgramName(name) ?? "", source, force)
  return compiled.ok ? [] : compiled.diagnostics
}

/** Опубликовать по имени (тесты, remote-интерфейс). */
export function publishProgram(name: string, source: string, author?: string): PublishResult {
  return publish({ name, source, author })
}

/** Удалить программу. Библиотеку, которую импортируют, удалить нельзя: usedBy — кто импортирует. */
export function deleteProgram(id: number): { ok: true } | { ok: false; usedBy: string[] } {
  const program = storage.programs.byId[id]
  if (program === undefined) return { ok: true }
  const usedBy = dependentsOf(program.name, program.force).map((p) => p.name)
  if (usedBy.length > 0) return { ok: false, usedBy }
  storage.programs.byId[id] = undefined
  for (const listener of removedListeners) listener(program)
  return { ok: true }
}

/**
 * Удалить программы по именам: проходами, чтобы библиотека удалялась после тех, кто её импортирует.
 * kept — не удалены: их импортируют программы не из списка.
 */
export function deletePrograms(names: string[], force: string): { deleted: string[]; kept: string[] } {
  let pending = names.filter((name) => findProgram(name, force) !== undefined)
  const deleted: string[] = []
  while (pending.length > 0) {
    const next: string[] = []
    for (const name of pending) {
      const program = findProgram(name, force)
      if (program === undefined) continue
      if (deleteProgram(program.id).ok) deleted.push(name)
      else next.push(name)
    }
    if (next.length === pending.length) break
    pending = next
  }
  return { deleted, kept: pending }
}

/** Может ли игрок менять программы команды (настройка карты «кто может публиковать»). */
export function rightsDenied(player: LuaPlayer): string | undefined {
  const rights = settings.global["automaton-publish-rights"]?.value as string | undefined
  if (rights === "admins" && game.is_multiplayer() && !player.admin) return "publish-admins-only"
  return undefined
}

/** Может ли игрок публиковать (права и частота). */
export function publishDenied(player: LuaPlayer): string | undefined {
  const denied = rightsDenied(player)
  if (denied !== undefined) return denied
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
