// Модули программы (этап 17, DESIGN.md «Модули»): программа команды импортирует другие программы
// команды по относительному пути. Компоновщик загружает и разбирает все импортированные модули,
// проверяет пути, циклы и имена экспорта и упорядочивает модули: зависимости раньше тех, кто их
// импортирует, сама программа — последней. Дальше анализ, проверка типов и генерация работают с
// модулями как с одной программой (каждый модуль — свой блок главной функции).
//
// Номера строк модуля сдвинуты на номер модуля × LINE_BASE: таблица строк Lua, точки остановки и
// строки ошибок времени выполнения остаются числами, а по числу видно, в каком модуле строка.
import * as A from "./ast"
import { Diagnostic, tokenize } from "./lexer"
import { parse } from "./parser"

export const LINE_BASE = 1000000
/** Модулей в одной программе (вместе с ней самой). */
export const MAX_MODULES = 50
/** Исходники модулей программы вместе (без самой программы — у неё свой предел). */
export const MAX_BUNDLE_BYTES = 300000

export interface ModuleSource {
  name: string
  source: string
}

/** Найти программу команды по полному имени (с папками). */
export type ModuleResolver = (this: void, name: string) => ModuleSource | undefined

/** Куда ведёт экспортированное имя: модуль и имя объявления в нём. */
export interface ExportTarget {
  unit: ModuleUnit
  local: string
  /** Значение (переменная, функция, класс). */
  value: boolean
  /** Тип (interface, type, класс). */
  type: boolean
}

export interface ImportBinding {
  target: ExportTarget
  typeOnly: boolean
  at: A.Loc
}

export interface ModuleUnit {
  /** Номер модуля в кодировке строк: 0 — сама программа. */
  index: number
  name: string
  program: A.Program
  /** Путь импорта (как написан) → модуль. */
  resolved: Map<string, ModuleUnit>
  /** Объявления верхнего уровня: значения и типы. */
  values: Set<string>
  types: Set<string>
  /** Экспортированное имя → объявление (реэкспорт прослежен до исходного модуля). */
  exports: Map<string, ExportTarget>
  /** Локальное имя → импортированное объявление. */
  imports: Map<string, ImportBinding>
  /** import * as имя → модуль. */
  namespaces: Map<string, ModuleUnit>
}

export interface LinkResult {
  /** Модули в порядке исполнения: зависимости первыми, программа — последней. */
  units: ModuleUnit[]
  /** Имена модулей по номеру (0 — сама программа). */
  modules: string[]
  diagnostics: Diagnostic[]
}

/**
 * Путь импорта относительно модуля from → полное имя программы. Ошибка — код диагностики.
 * "./x" и "../lib/x" как в TypeScript; расширение .ts / .js можно не писать.
 */
export function resolveModulePath(from: string, spec: string): { name: string } | { error: string } {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return { error: "import-not-relative" }
  const parts = from === "" ? [] : from.split("/")
  parts.pop()
  for (const segment of spec.split("/")) {
    if (segment === "." || segment === "") continue
    if (segment === "..") {
      if (parts.length === 0) return { error: "import-outside" }
      parts.pop()
    } else parts.push(segment)
  }
  let name = parts.join("/")
  if (name.endsWith(".ts") || name.endsWith(".js")) name = name.substring(0, name.length - 3)
  if (name === "") return { error: "import-outside" }
  return { name }
}

/** Путь импорта от модуля from к модулю to: "./x", "../lib/x" (обратное к resolveModulePath). */
export function relativeModulePath(from: string, to: string): string {
  const fromDir = from === "" ? [] : from.split("/")
  fromDir.pop()
  const target = to.split("/")
  let common = 0
  while (common < fromDir.length && common < target.length - 1 && fromDir[common] === target[common]) common++
  const ups = fromDir.length - common
  const rest = target.slice(common).join("/")
  return ups === 0 ? `./${rest}` : `${string.rep("../", ups)}${rest}`
}

/**
 * Заменить пути импорта в исходнике (import … from "x", import "x", export … from "x"): rewrite
 * получает путь и возвращает новый (или undefined — не менять). Остальной текст не трогается.
 */
export function rewriteImportPaths(source: string, rewrite: (this: void, spec: string) => string | undefined): string {
  const { tokens } = tokenize(source)
  const parts: string[] = []
  let last = 0
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.kind !== "string") continue
    const before = tokens[i - 1]
    const isPath = (before.kind === "identifier" && before.value === "from") || (before.kind === "keyword" && before.value === "import")
    if (!isPath) continue
    const replacement = rewrite(token.value)
    if (replacement === undefined || replacement === token.value) continue
    const start = token.start.offset!
    const quote = source.substring(start, start + 1)
    parts.push(source.substring(last, start), quote + replacement.split(quote).join("\\" + quote) + quote)
    last = token.end.offset!
  }
  if (parts.length === 0) return source
  parts.push(source.substring(last))
  return parts.join("")
}

/** Номер строки → модуль (имя, если не сама программа) и строка в нём. */
export function decodeLine(line: number, modules: string[] | undefined): { module?: string; line: number } {
  if (line < LINE_BASE) return { line }
  const index = math.floor(line / LINE_BASE)
  return { module: modules?.[index] ?? `#${index}`, line: line % LINE_BASE }
}

/** Строка для людей: «12» или «lib/Помощники:12». */
export function formatLine(line: number, modules: string[] | undefined): string {
  const decoded = decodeLine(line, modules)
  return decoded.module === undefined ? tostring(decoded.line) : `${decoded.module}:${decoded.line}`
}

/** Перевести строки диагностик из кодировки модулей. */
export function decodeDiagnostics(diagnostics: Diagnostic[], modules: string[]): Diagnostic[] {
  return diagnostics.map((d) => {
    if (d.line < LINE_BASE) return d
    const decoded = decodeLine(d.line, modules)
    return { ...d, line: decoded.line, module: decoded.module }
  })
}

/** Объявления верхнего уровня модуля. */
function declarations(program: A.Program): { values: Set<string>; types: Set<string> } {
  const values = new Set<string>()
  const types = new Set<string>()
  const addPattern = (pattern: A.Pattern): void => {
    if (pattern.kind === "IdentifierPattern") values.add(pattern.name)
    else if (pattern.kind === "ObjectPattern") {
      for (const prop of pattern.properties) addPattern(prop.value)
      if (pattern.rest !== undefined) values.add(pattern.rest)
    } else {
      for (const element of pattern.elements) if (element.value !== undefined) addPattern(element.value)
      if (pattern.rest !== undefined) addPattern(pattern.rest)
    }
  }
  for (const stmt of program.body) {
    if (stmt.kind === "VarDecl") for (const d of stmt.declarations) addPattern(d.target)
    else if (stmt.kind === "FunctionDecl" && stmt.fn.name !== undefined) values.add(stmt.fn.name)
    else if (stmt.kind === "ClassDecl" && stmt.cls.name !== undefined) {
      values.add(stmt.cls.name)
      types.add(stmt.cls.name)
    } else if (stmt.kind === "TypeDecl") types.add(stmt.name)
  }
  return { values, types }
}

/** Библиотека (DESIGN.md, 2A): есть экспорт, а на верхнем уровне только объявления. */
export function isLibrary(program: A.Program): boolean {
  if ((program.exports ?? []).length === 0) return false
  return program.body.every((s) => s.kind === "VarDecl" || s.kind === "FunctionDecl" || s.kind === "ClassDecl" || s.kind === "TypeDecl" || s.kind === "Empty")
}

/**
 * Собрать программу и её модули. main — сама программа (name — её полное имя: от него считаются
 * относительные пути), resolve — поиск других программ команды.
 */
export function link(main: A.Program, mainName: string, resolve: ModuleResolver | undefined): LinkResult {
  const diagnostics: Diagnostic[] = []
  const units: ModuleUnit[] = []
  const modules: string[] = [mainName]
  const byName = new Map<string, ModuleUnit>()
  let bytes = 0

  const report = (code: string, params: (string | number)[], at: A.Loc): void => {
    diagnostics.push({ code, params, line: at.line, column: at.column })
  }

  function newUnit(index: number, name: string, program: A.Program): ModuleUnit {
    const { values, types } = declarations(program)
    return { index, name, program, resolved: new Map(), values, types, exports: new Map(), imports: new Map(), namespaces: new Map() }
  }

  const mainUnit = newUnit(0, mainName, main)
  byName.set(mainName, mainUnit)
  /** 1 — модуль в стеке обхода (для поиска циклов), 2 — обработан. */
  const state = new Map<ModuleUnit, number>()
  const stack: ModuleUnit[] = []

  /** Пути, которые модуль импортирует (import и export … from), по порядку. */
  function sources(unit: ModuleUnit): { source: string; at: A.Loc }[] {
    const list: { source: string; at: A.Loc }[] = []
    for (const decl of unit.program.imports ?? []) list.push({ source: decl.source, at: decl })
    for (const decl of unit.program.exports ?? []) if (decl.source !== undefined) list.push({ source: decl.source, at: decl })
    return list
  }

  function load(name: string, at: A.Loc, spec: string): ModuleUnit | undefined {
    const existing = byName.get(name)
    if (existing !== undefined) return existing
    const found = resolve?.(name)
    if (found === undefined) {
      report("unknown-module", [name, spec], at)
      return undefined
    }
    if (modules.length >= MAX_MODULES) {
      report("too-many-modules", [MAX_MODULES], at)
      return undefined
    }
    bytes += found.source.length
    if (bytes > MAX_BUNDLE_BYTES) {
      report("modules-too-large", [MAX_BUNDLE_BYTES], at)
      return undefined
    }
    const index = modules.length
    modules.push(name)
    const parsed = parse(found.source, { lineBase: index * LINE_BASE })
    for (const d of parsed.diagnostics) diagnostics.push(d)
    const unit = newUnit(index, name, parsed.program)
    byName.set(name, unit)
    return unit
  }

  function visit(unit: ModuleUnit): void {
    state.set(unit, 1)
    stack.push(unit)
    for (const { source, at } of sources(unit)) {
      if (unit.resolved.has(source)) continue
      const path = resolveModulePath(unit.name, source)
      if ("error" in path) {
        report(path.error, [source], at)
        continue
      }
      const target = load(path.name, at, source)
      if (target === undefined) continue
      unit.resolved.set(source, target)
      const s = state.get(target)
      if (s === 1) {
        const from = stack.indexOf(target)
        const chain = [...stack.slice(from), target].map((u) => u.name || "программа").join(" → ")
        report("import-cycle", [chain], at)
      } else if (s === undefined) visit(target)
    }
    stack.pop()
    state.set(unit, 2)
    units.push(unit)
  }

  visit(mainUnit)
  if (diagnostics.length > 0) return { units, modules, diagnostics }

  // Таблицы экспорта и импорта — в порядке исполнения: у зависимостей они уже готовы.
  for (const unit of units) {
    const declared = (local: string): ExportTarget | undefined => {
      const imported = unit.imports.get(local)
      if (imported !== undefined) return imported.target
      const value = unit.values.has(local)
      const type = unit.types.has(local)
      return value || type ? { unit, local, value, type } : undefined
    }
    // Импорты первыми: export { a } может реэкспортировать импортированное имя.
    for (const decl of unit.program.imports ?? []) {
      const source = unit.resolved.get(decl.source)
      if (source === undefined) continue
      if (decl.namespace !== undefined) unit.namespaces.set(decl.namespace, source)
      for (const spec of decl.specs) {
        const target = source.exports.get(spec.imported)
        if (target === undefined) {
          report("no-export", [spec.imported, source.name], spec)
          continue
        }
        if (unit.imports.has(spec.local) || unit.namespaces.has(spec.local)) report("duplicate-declaration", [spec.local], spec)
        unit.imports.set(spec.local, { target, typeOnly: spec.typeOnly, at: spec })
      }
    }
    for (const local of unit.imports.keys()) {
      if (unit.values.has(local) || unit.types.has(local)) report("duplicate-declaration", [local], unit.imports.get(local)!.at)
    }
    for (const local of unit.namespaces.keys()) {
      if (unit.values.has(local)) report("duplicate-declaration", [local], unit.program.imports!.find((d) => d.namespace === local)!)
    }
    const add = (exported: string, target: ExportTarget, at: A.Loc): void => {
      if (unit.exports.has(exported)) report("duplicate-export", [exported], at)
      unit.exports.set(exported, target)
    }
    const stars: ModuleUnit[] = []
    for (const decl of unit.program.exports ?? []) {
      if (decl.source !== undefined) {
        const source = unit.resolved.get(decl.source)
        if (source === undefined) continue
        if (decl.all) {
          stars.push(source)
          continue
        }
        for (const spec of decl.specs) {
          const target = source.exports.get(spec.local)
          if (target === undefined) report("no-export", [spec.local, source.name], spec)
          else add(spec.exported, target, spec)
        }
        continue
      }
      for (const spec of decl.specs) {
        if (unit.namespaces.has(spec.local)) {
          report("unsupported", ["namespace-export"], spec)
          continue
        }
        const target = declared(spec.local)
        if (target === undefined) report("unknown-export", [spec.local], spec)
        else add(spec.exported, target, spec)
      }
    }
    // export * — всё, кроме default и того, что модуль экспортирует сам.
    for (const source of stars) {
      for (const [name, target] of source.exports) {
        if (name !== "default" && !unit.exports.has(name)) unit.exports.set(name, target)
      }
    }
  }
  return { units, modules, diagnostics }
}
