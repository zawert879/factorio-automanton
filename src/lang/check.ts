// Проверка типов (этап 12): постепенная — ошибка только там, где она точно есть, остальное — any.
// Проверяется: свойства известных типов (me.cargo.cout → нет такого), число аргументов, явно
// несовместимые аргументы, присваивания и return (строка вместо числа, "middle" вместо "left" | "center"),
// вызов не-функции, арифметика не над числами. «Возможно null» не проверяется (см. src/lang/types.ts).
// Типы API и библиотеки — из automaton.d.ts и src/lang/stdlib.ts, тем же парсером (один источник, 12.2).
// Сужение (12.3): === null / !== undefined, typeof, instanceof, поле-дискриминант, ранний выход из блока.
import * as A from "./ast"
import { Diagnostic } from "./lexer"
import { parse } from "./parser"
import { STDLIB } from "./stdlib"
import { DTS } from "../gui/dts.generated"
import {
  ANY,
  BOOLEAN,
  hasNull,
  mentions,
  NEVER,
  NULL,
  NUMBER,
  obj,
  ObjType,
  nonNull,
  printType,
  Prop,
  resetTypeKeys,
  Sig,
  SigParam,
  STRING,
  subst,
  TParam,
  Type,
  typeKey,
  union,
  UNKNOWN,
  VOID,
  widen,
} from "./types"

const MAX_TYPE_ERRORS = 20

// ---------- Именованные типы ----------

interface TypeDef {
  name: string
  tparams: TParam[]
  /** Построить тип для аргументов (или undefined — тогда any). */
  build: (this: void, args: Type[]) => Type
  cache: Map<string, Type>
}

interface Globals {
  types: Map<string, TypeDef>
  values: Map<string, Type>
}

type TypeContext = {
  types: Map<string, TypeDef>
  /** Параметры обобщений в области видимости. */
  params: Map<string, Type>
  /** Тип значения по имени — для typeof x. */
  valueOf?: (this: void, name: string) => Type | undefined
}

let globals: Globals | undefined

/** Раскрыть именованный тип (с кэшем на набор аргументов). */
function resolveRef(types: Map<string, TypeDef>, name: string, args: Type[]): Type {
  const def = types.get(name)
  if (def === undefined) return ANY
  const key = args.map((x) => typeKey(x)).join(",")
  const cached = def.cache.get(key)
  if (cached !== undefined) return cached
  // Заглушка на время построения — рекурсия через extends не зациклится.
  def.cache.set(key, ANY)
  const built = def.build(args)
  def.cache.set(key, built)
  return built
}

/** Параметры обобщения → аргументы (недостающие — по умолчанию или any). */
function bindParams(tparams: TParam[], args: Type[]): Map<string, Type> {
  const map = new Map<string, Type>()
  tparams.forEach((p, i) => map.set(p.name, args[i] ?? p.def ?? ANY))
  return map
}

function tparamsOf(decls: A.TypeParamDecl[] | undefined, ctx: TypeContext): TParam[] {
  return (decls ?? []).map((d) => ({ name: d.name, def: d.default === undefined ? undefined : toType(d.default, ctx) }))
}

function withParams(ctx: TypeContext, names: string[]): TypeContext {
  if (names.length === 0) return ctx
  const params = new Map(ctx.params)
  for (const name of names) params.set(name, { k: "param", name })
  return { ...ctx, params }
}

/** Узел типа → тип. */
function toType(node: A.TypeNode | undefined, ctx: TypeContext): Type {
  if (node === undefined) return ANY
  switch (node.kind) {
    case "KeywordType":
      switch (node.name) {
        case "number":
          return NUMBER
        case "string":
          return STRING
        case "boolean":
          return BOOLEAN
        case "void":
          return VOID
        case "null":
        case "undefined":
          return NULL
        case "never":
          return NEVER
        case "unknown":
          return UNKNOWN
        case "object":
          return obj({ open: true, name: "object" })
        default:
          return ANY
      }
    case "LiteralType":
      return { k: "lit", v: node.value }
    case "ArrayType":
      return { k: "array", el: toType(node.element, ctx) }
    case "TupleType":
      return { k: "tuple", els: node.elements.map((e) => toType(e, ctx)) }
    case "UnionType":
      return union(node.types.map((t) => toType(t, ctx)))
    case "IntersectionType": {
      // Пересечение объектов — объединение их свойств; что-то иное — any.
      const props = new Map<string, Prop>()
      for (const part of node.types) {
        const t = resolve(toType(part, ctx), ctx.types)
        if (t.k !== "obj") return ANY
        for (const [name, prop] of t.o.props) props.set(name, prop)
      }
      return obj({ props })
    }
    case "FunctionType":
      return obj({ calls: [sigOf(node, ctx)] })
    case "ObjectType":
      return membersToObject(node.members, ctx)
    case "TypeofType": {
      const value = ctx.valueOf?.(node.name)
      return value ?? ANY
    }
    case "KeyofType":
      return STRING
    case "IndexedType": {
      const object = resolve(toType(node.object, ctx), ctx.types)
      if (node.index.kind === "LiteralType" && typeof node.index.value === "string" && object.k === "obj") {
        return object.o.props.get(node.index.value)?.t ?? ANY
      }
      return ANY
    }
    case "TypeRef": {
      const param = ctx.params.get(node.name)
      if (param !== undefined) return param
      const args = node.args.map((a) => toType(a, ctx))
      switch (node.name) {
        case "Array":
        case "ReadonlyArray":
          return { k: "array", el: args[0] ?? ANY }
        case "Record":
          return obj({ index: args[1] ?? ANY, name: `Record<${printType(args[0] ?? STRING)}, ${printType(args[1] ?? ANY)}>` })
        case "Partial":
        case "Readonly":
        case "Required":
        case "NonNullable":
          return args[0] ?? ANY
      }
      if (!ctx.types.has(node.name)) return ANY
      return { k: "ref", name: node.name, args }
    }
  }
}

function sigOf(node: Extract<A.TypeNode, { kind: "FunctionType" }>, outer: TypeContext): Sig {
  const tparams = tparamsOf(node.typeParams, outer)
  const ctx = withParams(outer, tparams.map((p) => p.name))
  const params: SigParam[] = node.params
    .filter((p) => p.name !== "this")
    .map((p) => ({ name: p.name, t: toType(p.type, ctx), opt: p.optional, rest: p.rest }))
  return { tparams, params, ret: toType(node.result, ctx) }
}

/** Члены описания типа → объект: свойства, методы (с перегрузками), индекс, вызов, конструктор. */
function membersToObject(members: A.TypeMember[], ctx: TypeContext, name?: string, base?: Map<string, Prop>): Type {
  const props = new Map<string, Prop>(base ?? new Map())
  const calls: Sig[] = []
  const ctors: Sig[] = []
  let index: Type | undefined
  let numberIndex: Type | undefined
  for (const member of members) {
    if (member.name === "[index]") index = toType(member.type, ctx)
    else if (member.name === "[number-index]") numberIndex = toType(member.type, ctx)
    else if (member.name === "[call]" && member.type?.kind === "FunctionType") calls.push(sigOf(member.type, ctx))
    else if (member.name === "constructor" && member.type?.kind === "FunctionType") ctors.push(sigOf(member.type, ctx))
    else if (member.method && member.type?.kind === "FunctionType") {
      const sig = sigOf(member.type, ctx)
      const existing = props.get(member.name)
      // Перегрузка: та же сигнатура дописывается к методу, объявленному в этом же описании.
      if (existing !== undefined && existing.t.k === "obj" && existing.t.o.calls.length > 0 && !(base?.has(member.name) && base.get(member.name) === existing)) {
        existing.t.o.calls.push(sig)
      } else props.set(member.name, { t: obj({ calls: [sig] }), opt: member.optional })
    } else props.set(member.name, { t: toType(member.type, ctx), opt: member.optional })
  }
  const result = obj({ props, calls, ctors, index, name })
  if (result.k === "obj") result.o.numberIndex = numberIndex
  return result
}

/** Раскрыть ссылку на именованный тип (до объекта, примитива или объединения). */
function resolve(t: Type, types: Map<string, TypeDef>, depth = 0): Type {
  if (t.k === "ref" && depth < 10) return resolve(resolveRef(types, t.name, t.args), types, depth + 1)
  return t
}

/** Определение интерфейса: члены, предки и параметры. */
function interfaceDef(decl: Extract<A.Stmt, { kind: "TypeDecl" }>, types: Map<string, TypeDef>, valueOf?: (this: void, name: string) => Type | undefined): TypeDef {
  const outer: TypeContext = { types, params: new Map(), valueOf }
  const tparams = tparamsOf(decl.typeParams, outer)
  return {
    name: decl.name,
    tparams,
    cache: new Map(),
    build: (args) => {
      const params = bindParams(tparams, args)
      const ctx: TypeContext = { types, params, valueOf }
      if (decl.alias !== undefined) return toType(decl.alias, ctx)
      // Свойства предков — сначала, свои их перекрывают.
      const base = new Map<string, Prop>()
      let index: Type | undefined
      for (const parent of decl.extends ?? []) {
        const t = resolve(toType(parent, ctx), types)
        if (t.k !== "obj") continue
        for (const [name, prop] of t.o.props) base.set(name, prop)
        index ??= t.o.index
      }
      const name = args.length === 0 ? decl.name : `${decl.name}<${args.map((a) => printType(a)).join(", ")}>`
      const result = membersToObject(decl.members ?? [], ctx, name, base)
      if (result.k === "obj" && result.o.index === undefined) result.o.index = index
      return result
    },
  }
}

// ---------- Библиотека и API: один раз за загрузку мода ----------

function loadGlobals(): Globals {
  const types = new Map<string, TypeDef>()
  const values = new Map<string, Type>()
  const valueOf = (name: string) => values.get(name)
  const declarations: A.Stmt[] = []
  for (const source of [STDLIB, DTS]) {
    const parsed = parse(source, { declarations: true })
    for (const stmt of parsed.program.body) declarations.push(stmt)
  }
  const ctx: TypeContext = { types, params: new Map(), valueOf }
  for (const stmt of declarations) {
    if (stmt.kind === "TypeDecl") types.set(stmt.name, interfaceDef(stmt, types, valueOf))
  }
  for (const stmt of declarations) {
    if (stmt.kind === "DeclareClass") {
      const decl = stmt
      const tparams = tparamsOf(decl.typeParams, ctx)
      const def: TypeDef = {
        name: decl.name,
        tparams,
        cache: new Map(),
        build: (args) => {
          const inner: TypeContext = { types, params: bindParams(tparams, args), valueOf }
          const base = new Map<string, Prop>()
          if (decl.superClass !== undefined) {
            const parent = resolve({ k: "ref", name: decl.superClass, args: [] }, types)
            if (parent.k === "obj") for (const [name, prop] of parent.o.props) base.set(name, prop)
          }
          const instance = membersToObject(
            decl.members.filter((m) => m.name !== "constructor"),
            inner,
            decl.name,
            base,
          )
          return instance
        },
      }
      types.set(decl.name, def)
      // Значение класса: конструктор (из constructor(...) или как у предка) и instanceof.
      const ctorMembers = decl.members.filter((m) => m.name === "constructor")
      const ctorObj = membersToObject(ctorMembers, ctx)
      const ctors = ctorObj.k === "obj" ? ctorObj.o.ctors : []
      const instance: Type = { k: "ref", name: decl.name, args: [] }
      values.set(decl.name, obj({ ctors: (ctors.length > 0 ? ctors : [{ tparams: [], params: [{ name: "message", t: ANY, opt: true, rest: false }], ret: instance }]).map((s) => ({ ...s, ret: instance })), name: `typeof ${decl.name}` }))
    }
  }
  for (const stmt of declarations) {
    if (stmt.kind === "DeclareFunction") values.set(stmt.name, toType(stmt.type, ctx))
    if (stmt.kind === "DeclareVar") values.set(stmt.name, toType(stmt.type, ctx))
  }
  // Конструкторы Map и Set (в библиотеке они — интерфейсы).
  for (const [name, count] of [
    ["Map", 2],
    ["Set", 1],
  ] as [string, number][]) {
    const tparams: TParam[] = count === 2 ? [{ name: "K", def: ANY }, { name: "V", def: ANY }] : [{ name: "T", def: ANY }]
    const args: Type[] = tparams.map((p) => ({ k: "param", name: p.name }) as Type)
    values.set(name, obj({ ctors: [{ tparams, params: [{ name: "entries", t: ANY, opt: true, rest: false }], ret: { k: "ref", name, args } }], name: `typeof ${name}` }))
  }
  return { types, values }
}

export function checkGlobals(): Globals {
  globals ??= loadGlobals()
  return globals
}

// ---------- Проверка программы ----------

class Scope {
  readonly vars = new Map<string, Type>()
  constructor(readonly parent?: Scope) {}
  lookup(name: string): Type | undefined {
    let scope: Scope | undefined = this
    while (scope !== undefined) {
      const t = scope.vars.get(name)
      if (t !== undefined) return t
      scope = scope.parent
    }
    return undefined
  }
  /** Переопределить тип в этой области (сужение). */
  narrow(name: string, t: Type): void {
    this.vars.set(name, t)
  }
}

interface FunctionContext {
  ret?: Type
  returns: Type[]
  thisType?: Type
}

export function checkProgram(program: A.Program): Diagnostic[] {
  // Ключи объектных типов нумеруются заново — кэши раскрытых типов библиотеки тоже чистим.
  resetTypeKeys()
  const g = checkGlobals()
  for (const [, def] of g.types) def.cache.clear()
  const diagnostics: Diagnostic[] = []
  const reported = new Set<string>()
  const types = new Map<string, TypeDef>(g.types)
  const root = new Scope()
  for (const [name, t] of g.values) root.vars.set(name, t)
  const functions: FunctionContext[] = []
  let valueScope: Scope = root
  const ctx: TypeContext = { types, params: new Map(), valueOf: (name) => valueScope.lookup(name) }

  function report(node: A.Loc, code: string, params: (string | number)[]): void {
    if (diagnostics.length >= MAX_TYPE_ERRORS) return
    const key = `${node.line}:${node.column}:${code}`
    if (reported.has(key)) return
    reported.add(key)
    diagnostics.push({ code, params, line: node.line, column: node.column })
  }

  const res = (t: Type): Type => resolve(t, types)

  // ---------- Совместимость ----------

  function assignable(src: Type, dst: Type, depth = 0): boolean {
    if (depth > 6) return true
    if (dst.k === "any" || dst.k === "unknown" || dst.k === "void" || dst.k === "param") return true
    if (src.k === "any" || src.k === "unknown" || src.k === "never" || src.k === "null" || src.k === "param") return true
    if (src.k === "union") return src.ts.every((m) => m.k === "null" || assignable(m, dst, depth + 1))
    if (dst.k === "ref" && src.k === "ref" && dst.name === src.name) {
      const srcArgs = src.args
      return dst.args.every((a, i) => srcArgs[i] === undefined || assignable(srcArgs[i], a, depth + 1))
    }
    dst = res(dst)
    src = res(src)
    if (dst.k === "any" || src.k === "any") return true
    if (dst.k === "union") {
      if (src.k === "boolean" && dst.ts.some((m) => m.k === "lit" && m.v === true) && dst.ts.some((m) => m.k === "lit" && m.v === false)) return true
      if (src.k === "union") return src.ts.every((m) => m.k === "null" || assignable(m, dst, depth + 1))
      return dst.ts.some((m) => assignable(src, m, depth + 1))
    }
    if (src.k === "union") return src.ts.every((m) => m.k === "null" || assignable(m, dst, depth + 1))
    switch (dst.k) {
      case "number":
      case "string":
      case "boolean":
        return src.k === dst.k || (src.k === "lit" && typeof src.v === dst.k)
      case "lit":
        return src.k === "lit" && src.v === dst.v
      case "null":
        return true
      case "never":
        return false
      case "array":
        if (src.k === "array") return assignable(src.el, dst.el, depth + 1)
        if (src.k === "tuple") return src.els.every((e) => assignable(e, dst.el, depth + 1))
        return src.k === "obj" && src.o.open === true
      case "tuple":
        if (src.k === "tuple") return src.els.length >= dst.els.filter(() => true).length && dst.els.every((e, i) => src.els[i] === undefined || assignable(src.els[i], e, depth + 1))
        return src.k === "array" || (src.k === "obj" && src.o.open === true)
      case "obj":
        return objectAssignable(src, dst.o, depth)
    }
    return true
  }

  function objectAssignable(src: Type, dst: ObjType, depth: number): boolean {
    if (dst.open) return true
    // Примитивы и массивы — к описаниям вроде { length: number }: не проверяем.
    if (src.k !== "obj") return src.k === "array" || src.k === "tuple" || src.k === "string" || (src.k === "lit" && typeof src.v === "string") ? true : dst.calls.length === 0 && dst.props.size === 0 && dst.index === undefined
    if (src.o.open) return true
    if (dst.calls.length > 0) {
      if (src.o.calls.length === 0) return false
      const target = dst.calls[0]
      return src.o.calls.some((s) => sigAssignable(s, target, depth))
    }
    for (const [name, prop] of dst.props) {
      const own = src.o.props.get(name)
      if (own === undefined) {
        if (!prop.opt && src.o.index === undefined) return false
        continue
      }
      if (!assignable(own.t, prop.t, depth + 1)) return false
    }
    if (dst.index !== undefined) {
      for (const [, prop] of src.o.props) if (!assignable(prop.t, dst.index, depth + 1)) return false
    }
    return true
  }

  function sigAssignable(src: Sig, dst: Sig, depth: number): boolean {
    const required = src.params.filter((p) => !p.opt && !p.rest).length
    if (required > dst.params.length && !dst.params.some((p) => p.rest)) return false
    if (dst.ret.k === "void" || dst.ret.k === "any") return true
    return assignable(src.ret, dst.ret, depth + 1)
  }

  // ---------- Члены типов ----------

  function libInterface(name: string, args: Type[]): Type {
    return resolveRef(types, name, args)
  }

  /** Тип-объект для доступа к членам (примитивы и массивы — через интерфейсы библиотеки). */
  function apparent(t: Type): Type {
    t = res(t)
    switch (t.k) {
      case "string":
        return libInterface("String", [])
      case "number":
        return libInterface("Number", [])
      case "boolean":
        return libInterface("Boolean", [])
      case "lit":
        return apparent(widen(t))
      case "array":
        return libInterface("Array", [t.el])
      case "tuple":
        return libInterface("Array", [union(t.els)])
    }
    return t
  }

  /** Тип члена или undefined — «точно нет такого». */
  function memberType(t: Type, name: string): Type | undefined {
    t = res(t)
    if (t.k === "any" || t.k === "unknown" || t.k === "param" || t.k === "null" || t.k === "never" || t.k === "void") return ANY
    if (t.k === "union") {
      // Мягко: достаточно, чтобы член был хоть у одного варианта.
      const found: Type[] = []
      for (const m of t.ts) {
        if (m.k === "null") continue
        const mt = memberType(m, name)
        if (mt !== undefined) found.push(mt)
      }
      return found.length === 0 ? undefined : union(found)
    }
    if (t.k === "tuple" && name === "length") return NUMBER
    const a = apparent(t)
    if (a.k !== "obj") return ANY
    const prop = a.o.props.get(name)
    if (prop !== undefined) return prop.opt ? union([prop.t, NULL]) : prop.t
    if (a.o.open) return ANY
    if (a.o.index !== undefined) return a.o.index
    // Функции: name, length, call/apply и т. п. — не проверяем.
    if (a.o.calls.length > 0 || a.o.ctors.length > 0) return ANY
    return undefined
  }

  // ---------- Вызовы ----------

  /** Вывод параметров обобщения: сопоставить тип параметра и аргумента. */
  function infer(param: Type, arg: Type, names: Set<string>, bindings: Map<string, Type>, depth = 0): void {
    if (depth > 8) return
    if (param.k === "param" && names.has(param.name)) {
      if (!bindings.has(param.name) && arg.k !== "any" && arg.k !== "null" && arg.k !== "never") bindings.set(param.name, widen(arg))
      return
    }
    arg = res(arg)
    switch (param.k) {
      case "array":
        if (arg.k === "array") infer(param.el, arg.el, names, bindings, depth + 1)
        else if (arg.k === "tuple") infer(param.el, union(arg.els), names, bindings, depth + 1)
        return
      case "union": {
        // U | U[] (flatMap): массив — в U[], иначе — в U.
        const arrayMember = param.ts.find((m) => m.k === "array")
        if (arrayMember !== undefined && (arg.k === "array" || arg.k === "tuple")) infer(arrayMember, arg, names, bindings, depth + 1)
        else for (const m of param.ts) if (m.k !== "array" && m.k !== "null") infer(m, arg, names, bindings, depth + 1)
        return
      }
      case "ref":
        if (arg.k === "obj" && arg.o.name?.startsWith(param.name + "<")) {
          const resolved = resolve(param, types)
          if (resolved.k === "obj") for (const [name, prop] of resolved.o.props) {
            const own = arg.o.props.get(name)
            if (own !== undefined) infer(prop.t, own.t, names, bindings, depth + 1)
          }
        }
        return
      case "obj":
        if (arg.k !== "obj") return
        if (param.o.calls.length > 0 && arg.o.calls.length > 0) infer(param.o.calls[0].ret, arg.o.calls[0].ret, names, bindings, depth + 1)
        for (const [name, prop] of param.o.props) {
          const own = arg.o.props.get(name)
          if (own !== undefined) infer(prop.t, own.t, names, bindings, depth + 1)
        }
        return
    }
  }

  function paramFor(sig: Sig, i: number): SigParam | undefined {
    if (i < sig.params.length && !sig.params[i].rest) return sig.params[i]
    const last = sig.params[sig.params.length - 1]
    return last !== undefined && last.rest ? last : undefined
  }

  /** Тип элемента rest-параметра (...items: T[] — T). */
  function restElement(p: SigParam): Type {
    const t = res(p.t)
    if (t.k === "array") return t.el
    if (t.k === "tuple") return union(t.els)
    return ANY
  }

  function arityOk(sig: Sig, count: number): boolean {
    const required = sig.params.filter((p) => !p.opt && !p.rest).length
    const max = sig.params.some((p) => p.rest) ? math.huge : sig.params.length
    return count >= required && count <= max
  }

  /** Проверить вызов по сигнатурам; результат — тип возвращаемого значения. */
  function checkCall(node: A.Loc, sigs: Sig[], args: (A.Expr | A.Spread)[], typeArgs: A.TypeNode[], scope: Scope): Type {
    const hasSpread = args.some((a) => a.kind === "Spread")
    const candidates = hasSpread ? sigs : sigs.filter((s) => arityOk(s, args.length))
    if (candidates.length === 0) {
      // Неверное число аргументов — у единственной сигнатуры.
      if (sigs.length === 1) {
        const s = sigs[0]
        const required = s.params.filter((p) => !p.opt && !p.rest).length
        const expected = s.params.some((p) => p.rest) ? `${required}+` : required === s.params.length ? `${required}` : `${required}–${s.params.length}`
        report(node, "type-argument-count", [expected, args.length])
      }
      for (const a of args) typeOf(a.kind === "Spread" ? a.argument : a, scope)
      return sigs.length === 1 ? sigs[0].ret : ANY
    }
    const sig = candidates[0]
    const names = new Set(sig.tparams.map((p) => p.name))
    const bindings = new Map<string, Type>()
    typeArgs.forEach((ta, i) => {
      const p = sig.tparams[i]
      if (p !== undefined) bindings.set(p.name, toType(ta, ctx))
    })
    // Сначала аргументы-не-функции (по ним выводятся параметры), потом лямбды — с контекстом.
    const argTypes: Type[] = []
    const isFn = (a: A.Expr | A.Spread) => a.kind === "Function"
    for (const pass of [false, true]) {
      args.forEach((a, i) => {
        if (isFn(a) !== pass) return
        if (a.kind === "Spread") {
          argTypes[i] = typeOf(a.argument, scope)
          return
        }
        const p = paramFor(sig, i)
        let expected = p === undefined ? undefined : p.rest ? restElement(p) : p.t
        if (expected !== undefined && names.size > 0) {
          expected = subst(expected, bindings)
          if (mentions(expected, names) && !pass) expected = undefined
        }
        const t = typeOf(a, scope, expected)
        argTypes[i] = t
        if (p !== undefined && names.size > 0) infer(p.rest ? restElement(p) : p.t, t, names, bindings)
      })
    }
    // Проверка совместимости аргументов.
    if (!hasSpread) {
      args.forEach((a, i) => {
        const p = paramFor(sig, i)
        if (p === undefined || a.kind === "Spread") return
        const expected = subst(p.rest ? restElement(p) : p.t, bindings)
        if (mentions(expected, names)) return
        const t = argTypes[i]
        if (t !== undefined && !assignable(t, expected)) report(a, "type-not-assignable", [printType(t), printType(expected)])
      })
    }
    for (const p of sig.tparams) if (!bindings.has(p.name)) bindings.set(p.name, p.def ?? ANY)
    return subst(sig.ret, bindings)
  }

  function signaturesOf(t: Type): Sig[] | undefined {
    t = res(t)
    if (t.k === "any" || t.k === "unknown" || t.k === "param" || t.k === "never") return undefined
    if (t.k === "union") {
      const sigs: Sig[] = []
      for (const m of t.ts) {
        if (m.k === "null") continue
        const s = signaturesOf(m)
        if (s === undefined) return undefined
        for (const x of s) sigs.push(x)
      }
      return sigs
    }
    if (t.k === "obj") return t.o.calls.length > 0 ? t.o.calls : t.o.open ? undefined : []
    return []
  }

  // ---------- Выражения ----------

  /** Тип выражения; expected — ожидаемый тип (контекст для лямбд и литералов). x as T — T. */
  function typeOf(e: A.Expr, scope: Scope, expected?: Type): Type {
    if (e.asType !== undefined) {
      const cast = toType(e.asType, ctx)
      typeOfExpr(e, scope, cast)
      return cast
    }
    return typeOfExpr(e, scope, expected)
  }

  function typeOfExpr(e: A.Expr, scope: Scope, expected?: Type): Type {
    switch (e.kind) {
      case "Number":
        return { k: "lit", v: e.value }
      case "String":
        return { k: "lit", v: e.value }
      case "Boolean":
        return { k: "lit", v: e.value }
      case "Null":
        return NULL
      case "Template":
        for (const x of e.expressions) typeOf(x, scope)
        return STRING
      case "Identifier":
        return scope.lookup(e.name) ?? ANY
      case "This":
        return functions[functions.length - 1]?.thisType ?? ANY
      case "Super":
        return ANY
      case "Array":
        return arrayLiteral(e, scope, expected)
      case "Object":
        return objectLiteral(e, scope, expected)
      case "Function":
        return functionType(e.fn, scope, expected)
      case "Class":
        classDeclaration(e.cls, scope)
        return ANY
      case "Unary":
        return unary(e, scope)
      case "Update":
        typeOf(e.target, scope)
        return NUMBER
      case "Binary":
        return binary(e, scope)
      case "Logical": {
        const left = typeOf(e.left, scope, expected)
        const right = typeOf(e.right, narrowScope(e.left, scope, e.operator !== "||"), expected)
        if (e.operator === "&&") return right
        return union([nonNull(left), right])
      }
      case "Assign":
        return assignment(e, scope)
      case "Conditional": {
        typeOf(e.test, scope)
        const a = typeOf(e.consequent, narrowScope(e.test, scope, true), expected)
        const b = typeOf(e.alternate, narrowScope(e.test, scope, false), expected)
        return union([a, b])
      }
      case "Call":
        return call(e, scope)
      case "New":
        return construct(e, scope)
      case "Member": {
        const objectType = typeOf(e.object, scope)
        if (e.object.kind === "Super") return ANY
        const t = memberType(e.optional ? nonNull(objectType) : objectType, e.property)
        if (t === undefined) {
          report(e, "type-no-property", [e.property, printType(objectType)])
          return ANY
        }
        return e.optional ? union([t, NULL]) : t
      }
      case "Index": {
        const objectType = res(typeOf(e.object, scope))
        const index = typeOf(e.index, scope)
        if (objectType.k === "array") return objectType.el
        if (objectType.k === "tuple") return index.k === "lit" && typeof index.v === "number" ? objectType.els[index.v] ?? ANY : union(objectType.els)
        if (objectType.k === "string") return STRING
        if (objectType.k === "obj") {
          if (index.k === "lit" && typeof index.v === "string") return memberType(objectType, index.v) ?? objectType.o.index ?? ANY
          return objectType.o.index ?? objectType.o.numberIndex ?? ANY
        }
        return ANY
      }
      case "Sequence": {
        let last: Type = ANY
        for (const x of e.expressions) last = typeOf(x, scope)
        return last
      }
    }
    return ANY
  }

  function arrayLiteral(e: Extract<A.Expr, { kind: "Array" }>, scope: Scope, expected?: Type): Type {
    const exp = expected === undefined ? undefined : res(expected)
    const elementExpected = exp?.k === "array" ? exp.el : undefined
    const els: Type[] = []
    e.elements.forEach((el, i) => {
      if (el.kind === "Spread") {
        const t = res(typeOf(el.argument, scope))
        els.push(t.k === "array" ? t.el : t.k === "tuple" ? union(t.els) : ANY)
      } else els.push(typeOf(el, scope, exp?.k === "tuple" ? exp.els[i] : elementExpected))
    })
    if (exp?.k === "tuple") return { k: "tuple", els }
    if (els.length === 0) return { k: "array", el: elementExpected ?? ANY }
    return { k: "array", el: elementExpected !== undefined ? union(els) : widen(union(els)) }
  }

  /** Ожидаемый тип свойства объектного литерала: у объекта или у вариантов объединения. */
  function expectedProp(exp: Type | undefined, name: string): Type | undefined {
    if (exp === undefined) return undefined
    if (exp.k === "obj") return exp.o.props.get(name)?.t ?? exp.o.index
    if (exp.k === "union") {
      const found: Type[] = []
      for (const m of exp.ts) {
        const t = expectedProp(res(m), name)
        if (t !== undefined) found.push(t)
      }
      return found.length === 0 ? undefined : union(found)
    }
    return undefined
  }

  function objectLiteral(e: Extract<A.Expr, { kind: "Object" }>, scope: Scope, expected?: Type): Type {
    const exp = expected === undefined ? undefined : res(expected)
    const props = new Map<string, Prop>()
    let open = false
    for (const member of e.members) {
      if (member.kind === "Spread") {
        const t = res(typeOf(member.argument, scope))
        if (t.k === "obj" && !t.o.open) for (const [name, prop] of t.o.props) props.set(name, prop)
        else open = true
        continue
      }
      if (member.computed !== undefined) {
        typeOf(member.computed, scope)
        typeOf(member.value, scope)
        open = true
        continue
      }
      const want = expectedProp(exp, member.key)
      const t = typeOf(member.value, scope, want)
      props.set(member.key, { t: want !== undefined ? t : widen(t), opt: false })
    }
    return obj({ props, open })
  }

  function unary(e: Extract<A.Expr, { kind: "Unary" }>, scope: Scope): Type {
    const t = typeOf(e.argument, scope)
    switch (e.operator) {
      case "!":
        return BOOLEAN
      case "typeof":
        return STRING
      case "void":
        return NULL
      case "-":
      case "+":
      case "~":
        if (e.operator !== "+" && notNumeric(t)) report(e, "type-arithmetic", [e.operator, printType(t)])
        return NUMBER
    }
    return ANY
  }

  /** Тип точно не число (для арифметики): строка, логическое, объект, массив. */
  function notNumeric(t: Type): boolean {
    t = res(t)
    if (t.k === "union") return t.ts.every((m) => m.k === "null" || notNumeric(m))
    if (t.k === "lit") return typeof t.v !== "number"
    return t.k === "string" || t.k === "boolean" || t.k === "array" || t.k === "tuple" || (t.k === "obj" && !t.o.open)
  }

  function isStringish(t: Type): boolean {
    t = res(t)
    if (t.k === "union") return t.ts.some((m) => isStringish(m))
    return t.k === "string" || (t.k === "lit" && typeof t.v === "string")
  }

  function binary(e: Extract<A.Expr, { kind: "Binary" }>, scope: Scope): Type {
    const left = typeOf(e.left, scope)
    const right = typeOf(e.right, scope)
    switch (e.operator) {
      case "+":
        if (isStringish(left) || isStringish(right)) return STRING
        if (left.k === "any" || right.k === "any") return ANY
        if (notNumeric(left)) report(e.left, "type-arithmetic", ["+", printType(left)])
        else if (notNumeric(right)) report(e.right, "type-arithmetic", ["+", printType(right)])
        return NUMBER
      case "-":
      case "*":
      case "/":
      case "%":
      case "**":
      case "&":
      case "|":
      case "^":
      case "<<":
      case ">>":
      case ">>>":
        if (notNumeric(left)) report(e.left, "type-arithmetic", [e.operator, printType(left)])
        else if (notNumeric(right)) report(e.right, "type-arithmetic", [e.operator, printType(right)])
        return NUMBER
      case "as":
        return ANY
    }
    return BOOLEAN
  }

  /** Тип цели присваивания (переменная, свойство, индекс) или undefined — не проверяем. */
  function targetType(target: A.Pattern | A.Expr, scope: Scope): Type | undefined {
    if (target.kind === "Identifier") return declaredType(scope, target.name)
    if (target.kind === "Member") {
      const objectType = typeOf(target.object, scope)
      if (target.object.kind === "Super") return undefined
      const t = memberType(objectType, target.property)
      if (t === undefined) {
        report(target, "type-no-property", [target.property, printType(objectType)])
        return undefined
      }
      return nonNull(t)
    }
    if (target.kind === "Index") {
      typeOf(target.object, scope)
      typeOf(target.index, scope)
    }
    return undefined
  }

  function assignment(e: Extract<A.Expr, { kind: "Assign" }>, scope: Scope): Type {
    if (e.target.kind === "ObjectPattern" || e.target.kind === "ArrayPattern" || e.target.kind === "IdentifierPattern") {
      const t = typeOf(e.value, scope)
      bindPattern(e.target, t, scope, false)
      return t
    }
    const dst = targetType(e.target, scope)
    const value = typeOf(e.value, scope, dst)
    if (e.operator === "=") {
      if (dst !== undefined && !assignable(value, dst)) report(e.value, "type-not-assignable", [printType(value), printType(dst)])
      return value
    }
    if (e.operator === "+=" && dst !== undefined && isStringish(dst)) return STRING
    if (e.operator !== "+=" && e.operator !== "??=" && e.operator !== "||=" && e.operator !== "&&=" && notNumeric(value)) {
      report(e.value, "type-arithmetic", [e.operator, printType(value)])
    }
    return dst ?? ANY
  }

  function call(e: Extract<A.Expr, { kind: "Call" }>, scope: Scope): Type {
    if (e.callee.kind === "Super") {
      for (const a of e.args) typeOf(a.kind === "Spread" ? a.argument : a, scope)
      return VOID
    }
    let calleeType = typeOf(e.callee, scope)
    if (e.optional) calleeType = nonNull(calleeType)
    const sigs = signaturesOf(calleeType)
    if (sigs === undefined) {
      for (const a of e.args) typeOf(a.kind === "Spread" ? a.argument : a, scope)
      return ANY
    }
    if (sigs.length === 0) {
      report(e.callee, "type-not-callable", [printType(calleeType)])
      for (const a of e.args) typeOf(a.kind === "Spread" ? a.argument : a, scope)
      return ANY
    }
    return checkCall(e, sigs, e.args, e.typeArgs, scope)
  }

  function construct(e: Extract<A.Expr, { kind: "New" }>, scope: Scope): Type {
    const calleeType = res(typeOf(e.callee, scope))
    if (calleeType.k !== "obj" || calleeType.o.ctors.length === 0) {
      for (const a of e.args) typeOf(a.kind === "Spread" ? a.argument : a, scope)
      return ANY
    }
    return checkCall(e, calleeType.o.ctors, e.args, e.typeArgs, scope)
  }

  // ---------- Функции ----------

  function functionType(fn: A.FunctionNode, scope: Scope, expected?: Type, thisType?: Type): Type {
    const exp = expected === undefined ? undefined : res(expected)
    const contextual = exp?.k === "obj" ? exp.o.calls[0] : undefined
    const fctx = withParams(ctx, fn.typeParams)
    const inner = new Scope(scope)
    const params: SigParam[] = fn.params.map((p, i) => {
      const fromContext = contextual === undefined ? undefined : paramFor(contextual, i)
      const contextType = fromContext === undefined ? undefined : fromContext.rest && !p.rest ? restElement(fromContext) : fromContext.t
      const annotated = p.type === undefined ? undefined : toType(p.type, fctx)
      const t = annotated ?? (contextType !== undefined && !mentionsAny(contextType) ? contextType : ANY)
      const name = p.target.kind === "IdentifierPattern" ? p.target.name : `arg${i}`
      return { name, t, opt: p.optional || p.default !== undefined, rest: p.rest }
    })
    fn.params.forEach((p, i) => {
      if (p.default !== undefined) typeOf(p.default, inner, params[i].t)
      bindPattern(p.target, params[i].t, inner, true)
    })
    const declaredRet = fn.returnType === undefined ? undefined : toType(fn.returnType, fctx)
    const context: FunctionContext = { ret: declaredRet, returns: [], thisType: thisType ?? (fn.arrow ? functions[functions.length - 1]?.thisType : undefined) }
    functions.push(context)
    const savedParams = ctx.params
    ctx.params = fctx.params
    let ret: Type
    if (Array.isArray(fn.body)) {
      walkBlock(fn.body, inner)
      ret = declaredRet ?? (context.returns.length === 0 ? VOID : widen(union(context.returns)))
    } else {
      const want = declaredRet ?? (contextual !== undefined && !mentionsAny(contextual.ret) ? contextual.ret : undefined)
      const t = typeOf(fn.body, inner, want)
      if (declaredRet !== undefined && !assignable(t, declaredRet)) report(fn.body, "type-not-assignable", [printType(t), printType(declaredRet)])
      ret = declaredRet ?? (want !== undefined ? t : widen(t))
    }
    ctx.params = savedParams
    functions.pop()
    return obj({ calls: [{ tparams: fn.typeParams.map((name) => ({ name })), params, ret }] })
  }

  /** Тип ещё с невыведенными параметрами обобщения — как контекст не годится. */
  function mentionsAny(t: Type): boolean {
    return t.k === "param"
  }

  /** Сигнатура объявленной функции — по аннотациям (тело проверяется в своём месте). */
  function declaredSignature(fn: A.FunctionNode): Type {
    const fctx = withParams(ctx, fn.typeParams)
    const params: SigParam[] = fn.params.map((p, i) => ({
      name: p.target.kind === "IdentifierPattern" ? p.target.name : `arg${i}`,
      t: toType(p.type, fctx),
      opt: p.optional || p.default !== undefined,
      rest: p.rest,
    }))
    return obj({ calls: [{ tparams: fn.typeParams.map((name) => ({ name })), params, ret: fn.returnType === undefined ? ANY : toType(fn.returnType, fctx) }] })
  }

  // ---------- Классы ----------

  /** Простой тип начального значения поля (без переменных: поля объявляются до них). */
  function initializerType(e: A.Expr): Type {
    switch (e.kind) {
      case "Number":
        return NUMBER
      case "String":
      case "Template":
        return STRING
      case "Boolean":
        return BOOLEAN
      case "Array":
        return e.elements.length === 0 ? { k: "array", el: ANY } : { k: "array", el: widen(union(e.elements.map((x) => (x.kind === "Spread" ? ANY : initializerType(x))))) }
      case "New":
        return e.callee.kind === "Identifier" && types.has(e.callee.name) ? { k: "ref", name: e.callee.name, args: e.typeArgs.map((a) => toType(a, ctx)) } : ANY
    }
    return ANY
  }

  function classDeclaration(cls: A.ClassNode, scope: Scope): void {
    const name = cls.name ?? "(class)"
    const cctx = withParams(ctx, cls.typeParams)
    const instanceRef: Type = { k: "ref", name, args: [] }
    const superName = cls.superClass?.kind === "Identifier" ? cls.superClass.name : undefined
    types.set(name, {
      name,
      tparams: [],
      cache: new Map(),
      build: () => {
        const props = new Map<string, Prop>()
        if (superName !== undefined) {
          const parent = resolve({ k: "ref", name: superName, args: [] }, types)
          if (parent.k === "obj") for (const [n, p] of parent.o.props) props.set(n, p)
        }
        for (const member of cls.members) {
          if (member.kind === "Field" && !member.isStatic) {
            props.set(member.name, { t: member.type !== undefined ? toType(member.type, cctx) : member.value !== undefined ? initializerType(member.value) : ANY, opt: member.optional })
          } else if (member.kind === "Method" && !member.isStatic) {
            if (member.accessor === "method") props.set(member.name, { t: declaredSignature(member.fn), opt: false })
            else if (member.accessor === "get") props.set(member.name, { t: member.fn.returnType === undefined ? ANY : toType(member.fn.returnType, cctx), opt: false })
            else if (!props.has(member.name)) props.set(member.name, { t: toType(member.fn.params[0]?.type, cctx), opt: false })
          } else if (member.kind === "Constructor") {
            for (const p of member.fn.params) {
              if (p.property && p.target.kind === "IdentifierPattern") props.set(p.target.name, { t: toType(p.type, cctx), opt: p.optional })
            }
          } else if (member.kind === "AbstractMethod") props.set(member.name, { t: ANY, opt: false })
        }
        // Неизвестный предок (не класс программы) — свойства не знаем: открытый объект.
        const open = superName !== undefined && !types.has(superName)
        return obj({ props, name, open })
      },
    })
    // Значение класса: конструктор и статические члены.
    const ctor = cls.members.find((m) => m.kind === "Constructor") as Extract<A.ClassMember, { kind: "Constructor" }> | undefined
    const statics = new Map<string, Prop>()
    for (const member of cls.members) {
      if (member.kind === "Field" && member.isStatic) statics.set(member.name, { t: member.type !== undefined ? toType(member.type, cctx) : member.value !== undefined ? initializerType(member.value) : ANY, opt: false })
      if (member.kind === "Method" && member.isStatic) statics.set(member.name, { t: member.accessor === "method" ? declaredSignature(member.fn) : ANY, opt: false })
    }
    let ctorSig: Sig
    if (ctor !== undefined) {
      const sigType = declaredSignature(ctor.fn)
      ctorSig = sigType.k === "obj" ? { ...sigType.o.calls[0], ret: instanceRef } : { tparams: [], params: [], ret: instanceRef }
    } else if (superName !== undefined) {
      // Без конструктора — как у предка.
      const parent = res(scope.lookup(superName) ?? ANY)
      ctorSig = parent.k === "obj" && parent.o.ctors.length > 0 ? { ...parent.o.ctors[0], ret: instanceRef } : { tparams: [], params: [{ name: "args", t: { k: "array", el: ANY }, opt: true, rest: true }], ret: instanceRef }
    } else ctorSig = { tparams: [], params: [], ret: instanceRef }
    if (cls.name !== undefined) scope.vars.set(cls.name, obj({ ctors: [ctorSig], props: statics, name: `typeof ${name}` }))
  }

  function checkClassBodies(cls: A.ClassNode, scope: Scope): void {
    const name = cls.name ?? "(class)"
    const instance: Type = { k: "ref", name, args: [] }
    const saved = ctx.params
    ctx.params = withParams(ctx, cls.typeParams).params
    for (const member of cls.members) {
      if (member.kind === "Method" || member.kind === "Constructor") functionType(member.fn, scope, undefined, member.kind === "Method" && member.isStatic ? ANY : instance)
      else if (member.kind === "Field" && member.value !== undefined) {
        functions.push({ returns: [], thisType: instance })
        const want = member.type === undefined ? undefined : toType(member.type, ctx)
        const t = typeOf(member.value, scope, want)
        if (want !== undefined && !assignable(t, want)) report(member.value, "type-not-assignable", [printType(t), printType(want)])
        functions.pop()
      }
    }
    ctx.params = saved
  }

  // ---------- Шаблоны и объявления ----------

  /** Объявленные типы переменных (для проверки присваиваний): область → имя → тип. */
  const declared = new Map<Scope, Map<string, Type>>()

  function declare(scope: Scope, name: string, t: Type, _annotated: boolean): void {
    scope.vars.set(name, t)
    let map = declared.get(scope)
    if (map === undefined) {
      map = new Map()
      declared.set(scope, map)
    }
    // Присваивания проверяются и для выведенных из значения (let x = 1; x = "a"), any — без проверки.
    map.set(name, t)
  }

  /** Объявленный тип переменной: ближайшее объявление вверх по областям (сужения не в счёт). */
  function declaredType(scope: Scope, name: string): Type | undefined {
    let current: Scope | undefined = scope
    while (current !== undefined) {
      const t = declared.get(current)?.get(name)
      if (t !== undefined) return t.k === "any" ? undefined : t
      current = current.parent
    }
    return undefined
  }

  function bindPattern(pattern: A.Pattern, t: Type, scope: Scope, isDeclaration: boolean, annotated = false): void {
    switch (pattern.kind) {
      case "IdentifierPattern":
        if (isDeclaration) declare(scope, pattern.name, t, annotated)
        else {
          const dst = declaredType(scope, pattern.name)
          if (dst !== undefined && !assignable(t, dst)) report(pattern, "type-not-assignable", [printType(t), printType(dst)])
        }
        return
      case "ObjectPattern":
        for (const prop of pattern.properties) {
          let pt = memberType(t, prop.key) ?? ANY
          if (prop.default !== undefined) pt = union([nonNull(pt), typeOf(prop.default, scope, nonNull(pt))])
          bindPattern(prop.value, pt, scope, isDeclaration)
        }
        if (pattern.rest !== undefined && isDeclaration) declare(scope, pattern.rest, ANY, false)
        return
      case "ArrayPattern": {
        const r = res(t)
        pattern.elements.forEach((el, i) => {
          if (el.value === undefined) return
          let et: Type = r.k === "array" ? r.el : r.k === "tuple" ? r.els[i] ?? ANY : r.k === "string" ? STRING : ANY
          if (el.default !== undefined) et = union([nonNull(et), typeOf(el.default, scope, nonNull(et))])
          bindPattern(el.value, et, scope, isDeclaration)
        })
        if (pattern.rest !== undefined) bindPattern(pattern.rest, r.k === "array" ? r : { k: "array", el: ANY }, scope, isDeclaration)
        return
      }
    }
  }

  // ---------- Сужение ----------

  function narrowScope(test: A.Expr, scope: Scope, whenTrue: boolean): Scope {
    const narrowed = new Scope(scope)
    applyNarrowing(test, narrowed, whenTrue)
    return narrowed
  }

  function applyNarrowing(test: A.Expr, scope: Scope, whenTrue: boolean): void {
    if (test.kind === "Unary" && test.operator === "!") return applyNarrowing(test.argument, scope, !whenTrue)
    if (test.kind === "Logical") {
      // a && b — истинно: оба истинны; a || b — ложно: оба ложны.
      if ((test.operator === "&&" && whenTrue) || (test.operator === "||" && !whenTrue)) {
        applyNarrowing(test.left, scope, whenTrue)
        applyNarrowing(test.right, scope, whenTrue)
      }
      return
    }
    if (test.kind === "Identifier") {
      const t = scope.lookup(test.name)
      if (t !== undefined && whenTrue) scope.narrow(test.name, nonNull(t))
      return
    }
    if (test.kind !== "Binary") return
    const equal = test.operator === "===" || test.operator === "=="
    const notEqual = test.operator === "!==" || test.operator === "!="
    if (test.operator === "instanceof" && whenTrue && test.left.kind === "Identifier") {
      const cls = res(scope.lookup(test.right.kind === "Identifier" ? test.right.name : "") ?? ANY)
      if (cls.k === "obj" && cls.o.ctors.length > 0) scope.narrow(test.left.name, cls.o.ctors[0].ret)
      return
    }
    if (!equal && !notEqual) return
    const positive = equal === whenTrue
    const [subject, other] = test.right.kind === "Null" || test.right.kind === "String" || (test.right.kind === "Identifier" && test.right.name === "undefined") ? [test.left, test.right] : [test.right, test.left]
    // x === null / x !== undefined
    if (subject.kind === "Identifier" && (other.kind === "Null" || (other.kind === "Identifier" && other.name === "undefined"))) {
      const t = scope.lookup(subject.name)
      if (t !== undefined) scope.narrow(subject.name, positive ? NULL : nonNull(t))
      return
    }
    // typeof x === "string"
    if (subject.kind === "Unary" && subject.operator === "typeof" && subject.argument.kind === "Identifier" && other.kind === "String" && positive) {
      const byName: Record<string, Type> = { string: STRING, number: NUMBER, boolean: BOOLEAN }
      const t = byName[other.value]
      if (t !== undefined) scope.narrow(subject.argument.name, t)
      return
    }
    // x.kind === "a": варианты объединения с этим значением поля.
    if (subject.kind === "Member" && subject.object.kind === "Identifier" && other.kind === "String") {
      const name = subject.object.name
      const t = res(scope.lookup(name) ?? ANY)
      if (t.k !== "union") return
      const kept = t.ts.filter((m) => {
        const field = memberType(m, subject.property)
        if (field === undefined) return !positive
        const f = res(field)
        if (f.k !== "lit") return true
        return (f.v === other.value) === positive
      })
      if (kept.length > 0) scope.narrow(name, union(kept))
    }
  }

  /** Блок точно не доходит до конца (return, throw, break, continue, exit()). */
  function exits(stmt: A.Stmt, scope: Scope): boolean {
    switch (stmt.kind) {
      case "Return":
      case "Throw":
      case "Break":
      case "Continue":
        return true
      case "Block":
        return stmt.body.length > 0 && exits(stmt.body[stmt.body.length - 1], scope)
      case "If":
        return stmt.alternate !== undefined && exits(stmt.consequent, scope) && exits(stmt.alternate, scope)
      case "ExprStmt":
        if (stmt.expression.kind === "Call" && stmt.expression.callee.kind === "Identifier") {
          const t = res(scope.lookup(stmt.expression.callee.name) ?? ANY)
          return t.k === "obj" && t.o.calls.length > 0 && t.o.calls.every((s) => s.ret.k === "never")
        }
        return false
    }
    return false
  }

  // ---------- Инструкции ----------

  function walkBlock(body: A.Stmt[], scope: Scope): void {
    // Подъём: функции и классы видны во всём блоке.
    for (const stmt of body) {
      if (stmt.kind === "FunctionDecl" && stmt.fn.name !== undefined) scope.vars.set(stmt.fn.name, declaredSignature(stmt.fn))
      if (stmt.kind === "ClassDecl") classDeclaration(stmt.cls, scope)
    }
    let current = scope
    for (const stmt of body) {
      walk(stmt, current)
      // if (x === null) return — дальше x не null.
      if (stmt.kind === "If" && stmt.alternate === undefined && exits(stmt.consequent, current)) {
        const rest = new Scope(current)
        applyNarrowing(stmt.test, rest, false)
        // Объявления дальше пишутся в ту же область, что и раньше.
        current = rest
      }
    }
  }

  function walk(stmt: A.Stmt, scope: Scope): void {
    switch (stmt.kind) {
      case "VarDecl":
        for (const d of stmt.declarations) {
          const annotated = d.type === undefined ? undefined : toType(d.type, ctx)
          let t: Type = annotated ?? ANY
          if (d.init !== undefined) {
            const value = typeOf(d.init, scope, annotated)
            if (annotated !== undefined) {
              if (!assignable(value, annotated)) report(d.init, "type-not-assignable", [printType(value), printType(annotated)])
            } else {
              // let x = 1 — number; const x = "a" — "a"; let x = null / [] — пока неизвестно (any).
              const r = res(value)
              t = r.k === "null" || (r.k === "array" && r.el.k === "any") ? ANY : stmt.declKind === "const" ? value : widen(value)
            }
          }
          bindPattern(d.target, t, scope, true, annotated !== undefined)
        }
        return
      case "FunctionDecl":
        functionType(stmt.fn, scope)
        return
      case "ClassDecl":
        checkClassBodies(stmt.cls, scope)
        return
      case "TypeDecl":
        return
      case "ExprStmt":
        typeOf(stmt.expression, scope)
        return
      case "If":
        typeOf(stmt.test, scope)
        walk(stmt.consequent, narrowScope(stmt.test, scope, true))
        if (stmt.alternate !== undefined) walk(stmt.alternate, narrowScope(stmt.test, scope, false))
        return
      case "While":
        typeOf(stmt.test, scope)
        walk(stmt.body, narrowScope(stmt.test, scope, true))
        return
      case "DoWhile":
        walk(stmt.body, scope)
        typeOf(stmt.test, scope)
        return
      case "For": {
        const inner = new Scope(scope)
        if (stmt.init !== undefined) {
          if (stmt.init.kind === "VarDecl") walk(stmt.init, inner)
          else typeOf(stmt.init, inner)
        }
        if (stmt.test !== undefined) typeOf(stmt.test, inner)
        if (stmt.update !== undefined) typeOf(stmt.update, inner)
        walk(stmt.body, stmt.test === undefined ? inner : narrowScope(stmt.test, inner, true))
        return
      }
      case "ForOf": {
        const inner = new Scope(scope)
        const iterable = res(typeOf(stmt.iterable, scope))
        let element: Type = ANY
        if (iterable.k === "array") element = iterable.el
        else if (iterable.k === "tuple") element = union(iterable.els)
        else if (iterable.k === "string" || (iterable.k === "lit" && typeof iterable.v === "string")) element = STRING
        else if (iterable.k === "obj" && iterable.o.name?.startsWith("Map<")) {
          const entries = memberType(iterable, "entries")
          const sigs = entries === undefined ? undefined : signaturesOf(entries)
          const r = sigs?.[0] === undefined ? ANY : res(sigs[0].ret)
          element = r.k === "array" ? r.el : ANY
        } else if (iterable.k === "obj" && iterable.o.name?.startsWith("Set<")) {
          const values = memberType(iterable, "values")
          const sigs = values === undefined ? undefined : signaturesOf(values)
          const r = sigs?.[0] === undefined ? ANY : res(sigs[0].ret)
          element = r.k === "array" ? r.el : ANY
        }
        bindPattern(stmt.target, element, inner, stmt.declKind !== undefined)
        walk(stmt.body, inner)
        return
      }
      case "Return": {
        const fn = functions[functions.length - 1]
        if (fn === undefined) {
          if (stmt.value !== undefined) typeOf(stmt.value, scope)
          return
        }
        const t = stmt.value === undefined ? VOID : typeOf(stmt.value, scope, fn.ret)
        if (fn.ret !== undefined && stmt.value !== undefined && !assignable(t, fn.ret)) report(stmt.value, "type-not-assignable", [printType(t), printType(fn.ret)])
        fn.returns.push(t)
        return
      }
      case "Throw":
        typeOf(stmt.value, scope)
        return
      case "Try": {
        walkBlock(stmt.block, new Scope(scope))
        if (stmt.handler !== undefined) {
          const inner = new Scope(scope)
          if (stmt.param !== undefined) bindPattern(stmt.param, UNKNOWN, inner, true)
          walkBlock(stmt.handler, inner)
        }
        if (stmt.finalizer !== undefined) walkBlock(stmt.finalizer, new Scope(scope))
        return
      }
      case "Switch": {
        const subject = typeOf(stmt.discriminant, scope)
        const inner = new Scope(scope)
        for (const c of stmt.cases) {
          if (c.test !== undefined) typeOf(c.test, inner, subject)
          walkBlock(c.body, inner)
        }
        return
      }
      case "Block":
        walkBlock(stmt.body, new Scope(scope))
        return
      case "Labeled":
        walk(stmt.body, scope)
        return
    }
  }

  // Программа: типы (interface, type) — на всю программу; потом инструкции.
  const collectTypes = (body: A.Stmt[]) => {
    for (const stmt of body) {
      if (stmt.kind === "TypeDecl") types.set(stmt.name, interfaceDef(stmt, types, (name) => valueScope.lookup(name)))
      else if (stmt.kind === "Block") collectTypes(stmt.body)
    }
  }
  collectTypes(program.body)
  const programScope = new Scope(root)
  valueScope = programScope
  walkBlock(program.body, programScope)
  return diagnostics
}

