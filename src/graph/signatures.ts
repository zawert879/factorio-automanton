// Функции библиотек для узла «Вызвать» (20.1, DESIGN.md «Библиотеки из схем»): экспортированные функции программы
// команды, у которых параметры простых типов, — с типами разъёмов. Библиотека-схема — тоже код (export function),
// так что подписи и у схем, и у кода читаются из текста. В узле хранится снимок подписи (signatureValues):
// разъёмы узла есть и без библиотеки, а при входе в мастерскую снимок обновляется.
import * as A from "../lang/ast"
import { isHostSubclass } from "../lang/hostClasses"
import { parse } from "../lang/parser"
import { GraphValue, PinType } from "./model"

export interface LibraryParam {
  name: string
  type: PinType
  optional: boolean
  /** Аргумент приводится к типу параметра: провод «здание» несёт Building, а параметр — Furnace. */
  cast?: string
}

export interface LibraryFunction {
  /** Имя, под которым функция экспортирована. */
  name: string
  params: LibraryParam[]
  returns: PinType | undefined
  /** Может вернуть null (number | null): результат — с «!» у потребителя. */
  nullable: boolean
}

/** Типы API, которые узнаёт схема. */
const NAMED: Record<string, PinType | undefined> = {
  Item: "item",
  Fluid: "fluid",
  Position: "position",
  Marker: "marker",
  Zone: "zone",
  Target: "target",
  Value: "value",
  Message: "message",
  Enemy: "enemy",
  Machine: "robot",
  Building: "entity",
}

const LISTS: Partial<Record<PinType, PinType>> = { entity: "entities", robot: "robots", enemy: "enemies", target: "targets", value: "list" }

interface Mapped {
  type: PinType
  cast?: string
  nullable?: boolean
}

function named(name: string): Mapped | undefined {
  const type = NAMED[name]
  if (type !== undefined) return { type }
  if (name === "Robot") return { type: "robot", cast: "Robot" }
  if (isHostSubclass(name, "Building")) return { type: "entity", cast: name }
  return undefined
}

function list(element: A.TypeNode | undefined): Mapped | undefined {
  const inner = element === undefined ? undefined : pinOf(element)
  if (inner === undefined || inner.nullable) return undefined
  const type = LISTS[inner.type]
  if (type === undefined) return undefined
  return { type, cast: inner.cast === undefined ? undefined : `${inner.cast}[]` }
}

/** Тип TypeScript → тип разъёма (undefined — схеме такой параметр не передать). */
function pinOf(node: A.TypeNode): Mapped | undefined {
  switch (node.kind) {
    case "KeywordType":
      if (node.name === "number" || node.name === "string" || node.name === "boolean") return { type: node.name }
      if (node.name === "any" || node.name === "unknown") return { type: "value" }
      return undefined
    case "TypeRef":
      if (node.name === "Array" && node.args.length === 1) return list(node.args[0])
      return node.args.length === 0 ? named(node.name) : undefined
    case "ArrayType":
      return list(node.element)
    case "UnionType": {
      const rest = node.types.filter((t) => !(t.kind === "KeywordType" && (t.name === "null" || t.name === "undefined")))
      if (rest.length !== 1 || rest.length === node.types.length) return undefined
      const inner = pinOf(rest[0])
      return inner === undefined ? undefined : { ...inner, nullable: true }
    }
    default:
      return undefined
  }
}

/** Тип по значению по умолчанию: (min = 0.3) — число. */
function literalType(expr: A.Expr | undefined): PinType | undefined {
  if (expr === undefined) return undefined
  if (expr.kind === "Number") return "number"
  if (expr.kind === "String") return "string"
  if (expr.kind === "Boolean") return "boolean"
  return undefined
}

/** Есть ли в теле функции return со значением (не считая вложенных функций). */
function returnsValue(body: A.Stmt[]): boolean {
  const visit = (stmt: A.Stmt | undefined): boolean => {
    if (stmt === undefined) return false
    switch (stmt.kind) {
      case "Return":
        return stmt.value !== undefined
      case "If":
        return visit(stmt.consequent) || visit(stmt.alternate)
      case "While":
      case "DoWhile":
      case "For":
      case "ForOf":
      case "Labeled":
        return visit(stmt.body)
      case "Block":
        return stmt.body.some((s) => visit(s))
      case "Try":
        return [...stmt.block, ...(stmt.handler ?? []), ...(stmt.finalizer ?? [])].some((s) => visit(s))
      case "Switch":
        return stmt.cases.some((c) => c.body.some((s) => visit(s)))
      default:
        return false
    }
  }
  return body.some((s) => visit(s))
}

function signatureOf(fn: A.FunctionNode, name: string): LibraryFunction | undefined {
  if (fn.typeParams.length > 0) return undefined
  const params: LibraryParam[] = []
  for (const p of fn.params) {
    if (p.rest || p.target.kind !== "IdentifierPattern") return undefined
    let mapped: Mapped | undefined
    if (p.type !== undefined) mapped = pinOf(p.type)
    else {
      const type = literalType(p.default) ?? (p.default === undefined ? "value" : undefined)
      mapped = type === undefined ? undefined : { type }
    }
    if (mapped === undefined) return undefined
    const optional = p.optional || p.default !== undefined || mapped.nullable === true
    params.push({ name: p.target.name, type: mapped.type, optional, cast: mapped.cast })
  }
  let returns: PinType | undefined
  let nullable = false
  if (fn.returnType !== undefined) {
    const r = fn.returnType
    if (!(r.kind === "KeywordType" && (r.name === "void" || r.name === "undefined"))) {
      const mapped = pinOf(r)
      if (mapped === undefined) return undefined
      returns = mapped.type
      nullable = mapped.nullable === true
    }
  } else if (!fn.arrow && returnsValue(fn.body as A.Stmt[])) {
    returns = "value"
  }
  return { name, params, returns, nullable }
}

/** Экспортированные функции программы, которые можно вызвать из схемы (по имени экспорта). */
export function libraryFunctions(source: string): LibraryFunction[] {
  const { program } = parse(source)
  const byName: Record<string, A.FunctionNode | undefined> = {}
  for (const stmt of program.body) if (stmt.kind === "FunctionDecl" && stmt.fn.name !== undefined) byName[stmt.fn.name] = stmt.fn
  const result: LibraryFunction[] = []
  for (const decl of program.exports ?? []) {
    if (decl.source !== undefined) continue
    for (const spec of decl.specs) {
      const fn = spec.typeOnly ? undefined : byName[spec.local]
      const signature = fn === undefined ? undefined : signatureOf(fn, spec.exported)
      if (signature !== undefined) result.push(signature)
    }
  }
  return result
}

/** Снимок подписи для значений узла «Вызвать»: params — «a: number, b?: entity as Furnace». */
export function signatureValues(fn: LibraryFunction): Record<string, GraphValue | undefined> {
  const params = fn.params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}${p.cast === undefined ? "" : ` as ${p.cast}`}`)
  return { params: params.join(", "), returns: fn.returns ?? "none", nullable: fn.nullable ? true : undefined }
}
