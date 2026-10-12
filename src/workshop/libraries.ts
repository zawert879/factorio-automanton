// Функции библиотек в мастерской (20.1, DESIGN.md «Библиотеки из схем»): что предложить в узле «Вызвать» — функции
// своей схемы и функции библиотек команды (схем и кода); снимок подписи в узле обновляется при входе в мастерскую,
// имя библиотеки в узлах — при её переименовании.
import { callLibrary } from "../graph/codegen"
import { GraphValue } from "../graph/model"
import { LibraryFunction, libraryFunctions, signatureValues } from "../graph/signatures"
import { findProgram, programsOf } from "../program/store"
import { refreshNode } from "./entities"
import { Workshop, workshopState } from "./state"

export interface CallChoice {
  /** Библиотека — полное имя программы; у своей функции схемы — undefined. */
  library?: string
  name: string
  fn?: LibraryFunction
}

/** Функции для узла «Вызвать»: свои (узлы «Функция») по алфавиту, потом функции библиотек команды, кроме самой программы. */
export function callChoices(ws: Workshop): CallChoice[] {
  const own: CallChoice[] = []
  for (const [, node] of pairs(ws.nodes)) {
    const name = node.values.name
    if (node.kind === "function" && typeof name === "string" && name !== "" && !own.some((c) => c.name === name)) own.push({ name })
  }
  table.sort(own, (a, b) => a.name < b.name)
  const result = own
  for (const program of programsOf(ws.force)) {
    if (!program.library || program.id === ws.programId) continue
    for (const fn of libraryFunctions(program.source)) result.push({ library: program.name, name: fn.name, fn })
  }
  return result
}

/** Выбрать функцию в узле «Вызвать»: имя, библиотека и снимок подписи (у своей функции снимка нет). */
export function applyCall(values: Record<string, GraphValue | undefined>, choice: CallChoice): void {
  const signature = choice.fn === undefined ? undefined : signatureValues(choice.fn)
  values.name = choice.name
  values.library = choice.library
  values.params = signature?.params
  values.returns = signature?.returns
  values.nullable = signature?.nullable
}

/** Снимки подписей у вызовов функций библиотек — по нынешним библиотекам (вход в мастерскую). Разъёмы узла — заново. */
export function refreshLibraryCalls(ws: Workshop): void {
  const cache: Record<string, LibraryFunction[] | undefined> = {}
  for (const [, node] of pairs(ws.nodes)) {
    const library = node.kind === "call" ? callLibrary(node) : undefined
    if (library === undefined || !node.body.valid) continue
    const program = findProgram(library, ws.force)
    if (program === undefined) continue
    const fns = (cache[library] ??= libraryFunctions(program.source))
    const fn = fns.find((f) => f.name === node.values.name)
    if (fn === undefined) continue
    const values = signatureValues(fn)
    if (values.params === node.values.params && values.returns === node.values.returns && values.nullable === node.values.nullable) continue
    applyCall(node.values, { library, name: fn.name, fn })
    refreshNode(ws, node)
  }
}

/** Библиотеку переименовали: вызовы её функций в мастерских команды — под новым именем. */
export function renameLibraryCalls(force: string, oldName: string, newName: string): void {
  for (const [, ws] of pairs(workshopState().byProgram)) {
    if (ws.force !== force) continue
    for (const [, node] of pairs(ws.nodes)) if (node.kind === "call" && node.values.library === oldName) node.values.library = newName
  }
}
