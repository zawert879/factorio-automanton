// Обмен программами строкой (18.3). Набор программ команды → строка «am1:…» (как строка чертежа:
// helpers.encode_string — сжатие и base64); строка → план импорта (новая / та же / есть с другим текстом) →
// публикация: совпадающие — заменить новой версией, положить рядом «(2)» или пропустить; модули публикуются
// раньше программ, которые их импортируют. Права проверяет окно (те же, что у публикации).
import { englishGraphSource, graphToSource } from "../graph/codegen"
import { Graph, sanitizeGraph } from "../graph/model"
import { Diagnostic } from "../lang/lexer"
import { trim } from "../lang/runtime/strings"
import { findProgram, normalizeProgramName, ProgramRecord, publish } from "./store"

export const EXCHANGE_PREFIX = "am1:"
/** Пределы строки при импорте: длина и число программ. */
const MAX_STRING = 4_000_000
const MAX_PROGRAMS = 200

export interface SharedProgram {
  name: string
  source: string
  /** Программа-схема (этап 15): код в строке — собранный из неё. */
  graph?: Graph
}

/** Отмеченные программы и модули, без которых они не соберутся (из их сборки). */
export function withDependencies(programs: ProgramRecord[], force: string): ProgramRecord[] {
  const result: ProgramRecord[] = []
  const add = (p: ProgramRecord) => {
    if (!result.includes(p)) result.push(p)
  }
  for (const p of programs) {
    for (const name of p.dependencies) {
      const module = findProgram(name, force)
      if (module !== undefined) add(module)
    }
    add(p)
  }
  return result
}

/** Строка обмена: имена и тексты программ (в порядке списка). */
export function exportPrograms(programs: ProgramRecord[]): string {
  const list: SharedProgram[] = programs.map((p) => ({ name: p.name, source: p.source, graph: p.graph }))
  return EXCHANGE_PREFIX + helpers.encode_string(helpers.table_to_json({ v: 1, programs: list }))!
}

export type DecodeResult = { ok: true; programs: SharedProgram[] } | { ok: false; error: string; params?: (string | number)[] }

/** Строка обмена → программы; не та строка, битая, слишком большая — ошибка (ключ automaton-gui.import-…). */
export function decodePrograms(text: string): DecodeResult {
  const s = trim(text)
  if (s === "") return { ok: false, error: "import-empty" }
  if (!s.startsWith(EXCHANGE_PREFIX)) return { ok: false, error: "import-not-programs" }
  if (s.length > MAX_STRING) return { ok: false, error: "import-too-large" }
  const json = helpers.decode_string(s.substring(EXCHANGE_PREFIX.length))
  const data = json === undefined ? undefined : (helpers.json_to_table(json) as { v?: unknown; programs?: unknown } | undefined)
  if (data === undefined || typeof data !== "object" || data.v !== 1 || typeof data.programs !== "object") return { ok: false, error: "import-broken" }
  const raw = data.programs as { name?: unknown; source?: unknown; graph?: unknown }[]
  if (raw.length > MAX_PROGRAMS) return { ok: false, error: "import-too-many", params: [MAX_PROGRAMS] }
  const programs: SharedProgram[] = []
  for (const item of raw) {
    const name = typeof item?.name === "string" ? normalizeProgramName(item.name) : undefined
    if (name === undefined || typeof item.source !== "string") return { ok: false, error: "import-broken" }
    if (programs.some((p) => p.name === name)) return { ok: false, error: "import-broken" }
    // Схема — код пересобирается из неё: код и схема в строке не могут разойтись.
    const graph = item.graph === undefined ? undefined : sanitizeGraph(item.graph)
    if (item.graph !== undefined && graph === undefined) return { ok: false, error: "import-broken" }
    const source = graph === undefined ? item.source : graphToSource(graph, name, englishGraphSource(item.source)).source
    programs.push({ name, source, graph })
  }
  if (programs.length === 0) return { ok: false, error: "import-broken" }
  return { ok: true, programs }
}

/** new — такой у команды нет, same — есть с тем же текстом (пропустится), conflict — есть с другим текстом. */
export type ImportStatus = "new" | "same" | "conflict"
export type ImportChoice = "replace" | "rename" | "skip"

export interface ImportItem extends SharedProgram {
  status: ImportStatus
}

export function planImport(programs: SharedProgram[], force: string): ImportItem[] {
  return programs.map((p) => {
    const existing = findProgram(p.name, force)
    const status: ImportStatus = existing === undefined ? "new" : existing.source === p.source ? "same" : "conflict"
    return { ...p, status }
  })
}

export interface ImportResult {
  /** Опубликованные (новые имена — у положенных рядом). */
  published: string[]
  skipped: string[]
  failed: { name: string; diagnostics: Diagnostic[] }[]
}

/** Свободное имя рядом: «Шахтёр (2)», «Шахтёр (3)»… */
function nameAlongside(name: string, force: string, taken: string[]): string {
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`
    if (findProgram(candidate, force) === undefined && !taken.includes(candidate)) return candidate
  }
}

/**
 * Опубликовать план: по выбору у совпадающих (по умолчанию — заменить). Проходами: программа, которой не хватило
 * модуля из этой же строки, публикуется после него; что не собралось и после всех проходов — в failed.
 */
export function applyImport(items: ImportItem[], choices: Record<string, ImportChoice | undefined>, force: string, author?: string): ImportResult {
  const result: ImportResult = { published: [], skipped: [], failed: [] }
  let pending: SharedProgram[] = []
  const taken: string[] = []
  for (const item of items) {
    const choice = item.status === "conflict" ? (choices[item.name] ?? "replace") : "replace"
    if (item.status === "same" || choice === "skip") {
      result.skipped.push(item.name)
      continue
    }
    const name = choice === "rename" ? nameAlongside(item.name, force, taken) : item.name
    taken.push(name)
    pending.push({ name, source: item.source, graph: item.graph })
  }
  let last: Record<string, Diagnostic[]> = {}
  while (pending.length > 0) {
    const next: SharedProgram[] = []
    last = {}
    for (const p of pending) {
      const lines = p.graph === undefined ? undefined : graphToSource(p.graph, p.name, englishGraphSource(p.source)).lineNodes
      const published = publish({ name: p.name, source: p.source, force, author, graph: p.graph, graphLines: lines })
      if (published.ok) result.published.push(p.name)
      else {
        next.push(p)
        last[p.name] = published.diagnostics
      }
    }
    if (next.length === pending.length) break
    pending = next
  }
  for (const p of pending) result.failed.push({ name: p.name, diagnostics: last[p.name] ?? [] })
  return result
}
