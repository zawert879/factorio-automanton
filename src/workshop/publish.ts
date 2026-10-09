// Проверка и публикация схемы из мастерской (этап 15): схема с поверхности → TypeScript → компилятор мода
// (с модулями команды, как у кода). Ошибки схемы и компилятора — на узлах: красная рамка и текст под узлом.
import { LocalisedString } from "factorio:runtime"
import { graphToSource, GraphSource } from "../graph/codegen"
import { Graph, GraphDiagnostic } from "../graph/model"
import { diagnosticMessage } from "../gui/diagnostics"
import { Diagnostic } from "../lang/lexer"
import { checkProgram, ProgramRecord, publish, PublishResult } from "../program/store"
import { drawNode, readGraph } from "./entities"
import { Workshop } from "./state"

export interface NodeError {
  node: number
  message: LocalisedString
}

export interface WorkshopBuild {
  graph: Graph
  source: GraphSource
  errors: NodeError[]
}

/** Текст ошибки схемы: разъёмы и типы — подписями на языке игрока. */
export function graphDiagnosticText(d: GraphDiagnostic): LocalisedString {
  const params: LocalisedString[] = d.params.map((p, i) => {
    const text = tostring(p)
    if (d.code === "graph-unconnected" || d.code === "graph-no-pin") return [`automaton-pin.${text}`]
    if (d.code === "graph-wire-type") return [`automaton-pin-type.${text}`]
    if (d.code === "graph-unknown-node" && i === 0) return text
    return text
  })
  return [`automaton-diagnostic.${d.code}`, ...params]
}

/** Узел строки кода: сама строка или ближайшая выше со своим узлом. */
function nodeOfLine(lines: Record<number, number>, line: number): number | undefined {
  for (let l = line; l >= 1; l--) if (lines[l] !== undefined) return lines[l]
  return undefined
}

/** Собрать схему мастерской: ошибки схемы, а если их нет — ошибки компилятора (с модулями команды). */
export function buildWorkshop(ws: Workshop, program: ProgramRecord): WorkshopBuild {
  const { graph, problems } = readGraph(ws)
  const source = graphToSource(graph, program.name)
  const errors: NodeError[] = problems.map((p) => ({ node: p.node, message: [`automaton-diagnostic.${p.code}`] }))
  for (const d of source.diagnostics) errors.push({ node: d.node, message: graphDiagnosticText(d) })
  if (errors.length === 0) {
    const diagnostics: Diagnostic[] = checkProgram(program.name, source.source, program.force)
    for (const d of diagnostics) {
      const node = d.module === undefined ? nodeOfLine(source.lineNodes, d.line) : undefined
      errors.push({ node: node ?? 0, message: diagnosticMessage(d) })
    }
  }
  return { graph, source, errors }
}

/** Показать ошибки на узлах (прежние снять). */
export function showErrors(ws: Workshop, errors: NodeError[]): void {
  const byNode: Record<number, LocalisedString | undefined> = {}
  for (const e of errors) if (byNode[e.node] === undefined) byNode[e.node] = e.message
  for (const [id, node] of pairs(ws.nodes)) {
    const error = byNode[id]
    if (error === undefined && node.error === undefined) continue
    node.error = error
    if (node.body.valid) drawNode(ws, node)
  }
}

/** Опубликовать схему: новая версия программы (машины с ней перезапускаются), если код изменился. */
export function publishWorkshop(ws: Workshop, program: ProgramRecord, author: string | undefined): { build: WorkshopBuild; result?: PublishResult } {
  const build = buildWorkshop(ws, program)
  showErrors(ws, build.errors)
  if (build.errors.length > 0) return { build }
  const result = publish({ id: program.id, name: program.name, source: build.source.source, author, force: program.force, graph: build.graph, graphLines: build.source.lineNodes })
  if (!result.ok) {
    const errors = result.diagnostics.map((d) => ({ node: nodeOfLine(build.source.source.length > 0 ? build.source.lineNodes : {}, d.line) ?? 0, message: diagnosticMessage(d) }))
    showErrors(ws, errors)
    build.errors = errors
  }
  return { build, result }
}
