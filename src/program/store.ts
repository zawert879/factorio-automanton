// Библиотека программ команды: исходник, версия и скомпилированный Lua (в storage — переживает
// сохранение; при загрузке нужен только load, без компилятора). Публикация = компиляция: программа
// с ошибками не публикуется. Компилируют все игроки одинаково (lockstep), готовый Lua от игрока не принимается.
import { compile } from "../lang/codegen"
import { Diagnostic } from "../lang/lexer"
import { loadProgram, Program } from "../lang/runtime"

export interface ProgramRecord {
  id: number
  name: string
  source: string
  version: number
  lua: string
  lines: number[]
  keys: Record<number, string>
  updatedTick: number
  /** Кто опубликовал последнюю версию. */
  author?: string
}

export interface ProgramsState {
  nextId: number
  byId: Record<number, ProgramRecord | undefined>
}

export function initPrograms(): void {
  storage.programs ??= { nextId: 1, byId: {} }
}

export function findProgram(name: string): ProgramRecord | undefined {
  for (const [, program] of pairs(storage.programs.byId)) {
    if (program.name === name) return program
  }
  return undefined
}

export type PublishResult = { ok: true; program: ProgramRecord } | { ok: false; diagnostics: Diagnostic[] }

const publishedListeners: Array<(this: void, program: ProgramRecord) => void> = []

/** Новая версия программы опубликована (машины с ней перезапускаются). */
export function onProgramPublished(listener: (this: void, program: ProgramRecord) => void): void {
  publishedListeners.push(listener)
}

/** Опубликовать программу (новую или новую версию существующей с тем же именем). */
export function publishProgram(name: string, source: string, author?: string): PublishResult {
  // Ошибка в самом компиляторе не должна ронять мод: она становится ошибкой публикации.
  const [ok, result] = pcall(compile, source)
  if (!ok) return { ok: false, diagnostics: [{ code: "internal-error", params: [tostring(result)], line: 1, column: 1 }] }
  const compiled = result as ReturnType<typeof compile>
  if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics }
  let program = findProgram(name)
  if (program === undefined) {
    const id = storage.programs.nextId++
    program = { id, name, source, version: 0, lua: "", lines: [], keys: {}, updatedTick: game.tick }
    storage.programs.byId[id] = program
  }
  program.source = source
  program.version++
  program.lua = compiled.lua
  program.lines = compiled.lines
  program.keys = compiled.keys
  program.updatedTick = game.tick
  program.author = author
  for (const listener of publishedListeners) listener(program)
  return { ok: true, program }
}

/** Загруженные программы: функции Lua хранить в storage нельзя, поэтому кэш собирается заново после загрузки игры. */
const loaded = new LuaMap<number, { version: number; program: Program }>()

export function loadedProgram(record: ProgramRecord): Program | string {
  const cached = loaded.get(record.id)
  if (cached !== undefined && cached.version === record.version) return cached.program
  const program = loadProgram(record.lua, record.lines, record.keys)
  if (typeof program === "string") return program
  loaded.set(record.id, { version: record.version, program })
  return program
}
