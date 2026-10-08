// Вывод «всегда число» для переменных и функций — без проверки типов (этап 12), только по коду:
// переменная числовая, если каждое её значение — число (литерал, арифметика, числовая переменная,
// вызов числовой функции, Math.*). Тогда a + b компилируется в сложение Lua без проверок,
// а a[i] с числовым i — в прямой индекс таблицы.
//
// Наибольшая неподвижная точка: сначала все кандидаты числовые, затем вычёркиваются те, у которых
// есть нечисловое значение, пока что-то меняется (так работает let i = 0; i = i + 1).
import * as A from "./ast"
import { Analysis, ClassInfo, FnInfo, VarInfo } from "./analyze"

/** Известный вид значения переменной: массив, обычный объект или экземпляр именно этого класса. */
export type Kind = "array" | "object" | ClassInfo

export interface NumericInfo {
  vars: Set<VarInfo>
  fns: Set<FnInfo>
  /** Переменные, значение которых всегда одного вида (и не undefined). */
  kinds: Map<VarInfo, Kind>
}

/** Источник значения переменной: выражение (=), арифметика с выражением (+=), массив (…rest) или «неизвестно». */
type Source = { expr: A.Expr } | { plus: A.Expr } | { always: true } | { array: true } | { unknown: true }

const NUMERIC_LIBRARY_FUNCTIONS = new Set(["parseInt", "parseFloat"])

export function inferNumeric(program: A.Program, analysis: Analysis): NumericInfo {
  const sources = new Map<VarInfo, Source[]>()
  const returns = new Map<FnInfo, A.Expr[]>()
  /** Функции, у которых может быть return без числа (или выход из тела без return). */
  const notNumericFns = new Set<FnInfo>()

  function varOf(node: object): VarInfo | undefined {
    const r = analysis.resolutions.get(node)
    return r !== undefined && "var" in r ? r.var : undefined
  }

  function add(v: VarInfo | undefined, source: Source): void {
    if (v === undefined) return
    const list = sources.get(v)
    if (list === undefined) sources.set(v, [source])
    else list.push(source)
  }

  function patternUnknown(p: A.Pattern): void {
    if (p.kind === "IdentifierPattern") add(varOf(p), { unknown: true })
    else if (p.kind === "ObjectPattern") {
      for (const prop of p.properties) patternUnknown(prop.value)
      add(varOf(p), { unknown: true })
    } else {
      for (const e of p.elements) if (e.value !== undefined) patternUnknown(e.value)
      if (p.rest !== undefined) patternUnknown(p.rest)
    }
  }

  // ---------- Сбор источников ----------

  function stmts(list: A.Stmt[], fn: FnInfo | undefined): void {
    for (const s of list) stmt(s, fn)
  }

  function stmt(s: A.Stmt, fn: FnInfo | undefined): void {
    switch (s.kind) {
      case "VarDecl":
        for (const d of s.declarations) {
          if (d.init !== undefined) expr(d.init, fn)
          if (d.target.kind === "IdentifierPattern") add(varOf(d.target), d.init !== undefined ? { expr: d.init } : { unknown: true })
          else patternUnknown(d.target)
        }
        return
      case "FunctionDecl":
        func(s.fn)
        add(analysis.declOf.get(s), { unknown: true })
        return
      case "ClassDecl":
        cls(s.cls)
        add(analysis.declOf.get(s), { unknown: true })
        return
      case "ExprStmt":
        expr(s.expression, fn)
        return
      case "If":
        expr(s.test, fn)
        stmt(s.consequent, fn)
        if (s.alternate !== undefined) stmt(s.alternate, fn)
        return
      case "While":
      case "DoWhile":
        expr(s.test, fn)
        stmt(s.body, fn)
        return
      case "For":
        if (s.init !== undefined) {
          if (s.init.kind === "VarDecl") stmt(s.init as A.VarDecl, fn)
          else expr(s.init as A.Expr, fn)
        }
        if (s.test !== undefined) expr(s.test, fn)
        if (s.update !== undefined) expr(s.update, fn)
        stmt(s.body, fn)
        return
      case "ForOf":
        expr(s.iterable, fn)
        patternUnknown(s.target)
        stmt(s.body, fn)
        return
      case "Return":
        if (fn !== undefined) {
          if (s.value === undefined) notNumericFns.add(fn)
          else {
            const list = returns.get(fn)
            if (list === undefined) returns.set(fn, [s.value])
            else list.push(s.value)
          }
        }
        if (s.value !== undefined) expr(s.value, fn)
        return
      case "Throw":
        expr(s.value, fn)
        return
      case "Try":
        stmts(s.block, fn)
        if (s.param !== undefined) patternUnknown(s.param)
        if (s.handler !== undefined) stmts(s.handler, fn)
        if (s.finalizer !== undefined) stmts(s.finalizer, fn)
        return
      case "Switch":
        expr(s.discriminant, fn)
        for (const c of s.cases) {
          if (c.test !== undefined) expr(c.test, fn)
          stmts(c.body, fn)
        }
        return
      case "Block":
        stmts(s.body, fn)
        return
      case "Labeled":
        stmt(s.body, fn)
        return
    }
  }

  function func(node: A.FunctionNode): void {
    const fn = analysis.fnOf.get(node)
    for (const p of node.params) {
      if (p.default !== undefined) expr(p.default, fn)
      if (p.rest && p.target.kind === "IdentifierPattern") add(varOf(p.target), { array: true })
      else patternUnknown(p.target)
    }
    if (Array.isArray(node.body)) {
      const body = node.body as A.Stmt[]
      stmts(body, fn)
      // Выход из тела без return — undefined.
      const last = body[body.length - 1]
      if (fn !== undefined && (last === undefined || (last.kind !== "Return" && last.kind !== "Throw"))) notNumericFns.add(fn)
    } else {
      const body = node.body as A.Expr
      expr(body, fn)
      if (fn !== undefined) returns.set(fn, [body])
    }
  }

  function cls(node: A.ClassNode): void {
    if (node.superClass !== undefined) expr(node.superClass, undefined)
    for (const m of node.members) {
      if (m.kind === "Field" && m.value !== undefined) expr(m.value, undefined)
      else if (m.kind === "Method" || m.kind === "Constructor") func(m.fn)
    }
  }

  function assignTarget(target: A.Pattern | A.Expr, source: Source): void {
    if (target.kind === "Identifier" || target.kind === "IdentifierPattern") add(varOf(target), source)
    else if (target.kind === "ObjectPattern" || target.kind === "ArrayPattern") patternUnknown(target)
  }

  function expr(e: A.Expr, fn: FnInfo | undefined): void {
    switch (e.kind) {
      case "Template":
        for (const x of e.expressions) expr(x, fn)
        return
      case "Array":
        for (const x of e.elements) expr(x.kind === "Spread" ? x.argument : x, fn)
        return
      case "Object":
        for (const m of e.members) {
          if (m.kind === "Spread") expr(m.argument, fn)
          else {
            if (m.computed !== undefined) expr(m.computed, fn)
            expr(m.value, fn)
          }
        }
        return
      case "Function":
        func(e.fn)
        return
      case "Class":
        cls(e.cls)
        return
      case "Unary":
        expr(e.argument, fn)
        return
      case "Update":
        assignTarget(e.target, { always: true })
        expr(e.target, fn)
        return
      case "Binary":
      case "Logical":
        expr(e.left, fn)
        expr(e.right, fn)
        return
      case "Assign": {
        expr(e.value, fn)
        if (e.target.kind !== "Identifier" && e.target.kind !== "IdentifierPattern" && e.target.kind !== "ObjectPattern" && e.target.kind !== "ArrayPattern") {
          expr(e.target as A.Expr, fn)
        }
        const op = e.operator
        if (op === "=") assignTarget(e.target, { expr: e.value })
        else if (op === "+=") assignTarget(e.target, { plus: e.value })
        else if (op === "??=" || op === "||=" || op === "&&=") assignTarget(e.target, { expr: e.value })
        else assignTarget(e.target, { always: true })
        return
      }
      case "Conditional":
        expr(e.test, fn)
        expr(e.consequent, fn)
        expr(e.alternate, fn)
        return
      case "Call":
        expr(e.callee, fn)
        for (const a of e.args) expr(a.kind === "Spread" ? a.argument : a, fn)
        return
      case "New":
        expr(e.callee, fn)
        for (const a of e.args) expr(a.kind === "Spread" ? a.argument : a, fn)
        return
      case "Member":
        expr(e.object, fn)
        return
      case "Index":
        expr(e.object, fn)
        expr(e.index, fn)
        return
      case "Sequence":
        for (const x of e.expressions) expr(x, fn)
        return
    }
  }

  stmts(program.body, analysis.main)

  // ---------- Неподвижная точка ----------

  const vars = new Set<VarInfo>()
  for (const [v, list] of sources) {
    if (v.kind !== "param" && v.kind !== "catch" && v.kind !== "this" && list.every((s) => !("unknown" in s) && !("array" in s))) vars.add(v)
  }
  const fns = new Set<FnInfo>()
  for (const [fn, list] of returns) if (!notNumericFns.has(fn) && list.length > 0) fns.add(fn)

  const isNumeric = (e: A.Expr): boolean => numericExpr(e, analysis, vars, fns)
  let changed = true
  while (changed) {
    changed = false
    for (const v of vars) {
      const ok = sources.get(v)!.every((s) => ("always" in s ? true : "plus" in s ? isNumeric(s.plus) : isNumeric((s as { expr: A.Expr }).expr)))
      if (!ok) {
        vars.delete(v)
        changed = true
      }
    }
    for (const fn of fns) {
      if (!returns.get(fn)!.every((e) => isNumeric(e))) {
        fns.delete(fn)
        changed = true
      }
    }
  }
  return { vars, fns, kinds: inferKinds(sources, analysis) }
}

function inferKinds(sources: Map<VarInfo, Source[]>, analysis: Analysis): Map<VarInfo, Kind> {
  const kinds = new Map<VarInfo, Kind>()
  const kindOf = (e: A.Expr): Kind | undefined => {
    switch (e.kind) {
      case "Array":
        return "array"
      case "Object":
        return "object"
      case "New": {
        if (e.callee.kind !== "Identifier") return undefined
        const r = analysis.resolutions.get(e.callee)
        return r !== undefined && "var" in r && !r.var.assigned ? r.var.cls : undefined
      }
      case "Identifier": {
        const r = analysis.resolutions.get(e)
        return r !== undefined && "var" in r ? kinds.get(r.var) : undefined
      }
      case "Conditional": {
        const a = kindOf(e.consequent)
        return a !== undefined && a === kindOf(e.alternate) ? a : undefined
      }
    }
    return undefined
  }
  const sourceKind = (s: Source): Kind | undefined => ("array" in s ? "array" : "expr" in s ? kindOf(s.expr) : undefined)
  // Начальное предположение — вид первого источника, который определяется без других переменных.
  for (const [v, list] of sources) {
    if (v.kind === "catch" || v.kind === "this") continue
    if (v.kind === "param" && !list.every((s) => "array" in s)) continue
    for (const s of list) {
      const k = "array" in s ? "array" : "expr" in s && s.expr.kind !== "Identifier" && s.expr.kind !== "Conditional" ? kindOf(s.expr) : undefined
      if (k !== undefined) {
        kinds.set(v, k)
        break
      }
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [v, k] of kinds) {
      if (!sources.get(v)!.every((s) => sourceKind(s) === k)) {
        kinds.delete(v)
        changed = true
      }
    }
  }
  return kinds
}

/** Выражение всегда даёт число (или ошибку) при текущих числовых переменных и функциях. */
export function numericExpr(e: A.Expr, analysis: Analysis, vars: Set<VarInfo>, fns: Set<FnInfo>): boolean {
  const num = (x: A.Expr): boolean => numericExpr(x, analysis, vars, fns)
  switch (e.kind) {
    case "Number":
      return true
    case "Unary":
      return e.operator === "-" || e.operator === "+" || e.operator === "~"
    case "Update":
      return true
    case "Binary":
      if (e.operator === "+") return num(e.left) && num(e.right)
      return ["-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"].includes(e.operator)
    case "Logical":
      return num(e.left) && num(e.right)
    case "Conditional":
      return num(e.consequent) && num(e.alternate)
    case "Assign":
      if (e.operator === "=" || e.operator === "??=" || e.operator === "||=" || e.operator === "&&=") return num(e.value)
      if (e.operator === "+=") return (e.target.kind === "Identifier" ? num(e.target) : false) && num(e.value)
      return true
    case "Sequence":
      return num(e.expressions[e.expressions.length - 1])
    case "Identifier": {
      const r = analysis.resolutions.get(e)
      if (r === undefined) return false
      if ("var" in r) return vars.has(r.var)
      return r.builtin.name === "NaN" || r.builtin.name === "Infinity"
    }
    case "Member": {
      if (e.object.kind !== "Identifier") return false
      const r = analysis.resolutions.get(e.object)
      return r !== undefined && "builtin" in r && (r.builtin.name === "Math" || r.builtin.name === "Number")
    }
    case "Call": {
      const callee = e.callee
      if (callee.kind === "Identifier") {
        const r = analysis.resolutions.get(callee)
        if (r === undefined) return false
        if ("var" in r) return r.var.fn !== undefined && !r.var.assigned && fns.has(r.var.fn)
        return NUMERIC_LIBRARY_FUNCTIONS.has(r.builtin.name) || r.builtin.name === "Number"
      }
      if (callee.kind === "Member" && callee.object.kind === "Identifier") {
        const r = analysis.resolutions.get(callee.object)
        if (r === undefined || !("builtin" in r)) return false
        if (r.builtin.name === "Math") return true
        if (r.builtin.name === "Number") return callee.property === "parseInt" || callee.property === "parseFloat"
      }
      return false
    }
  }
  return false
}
