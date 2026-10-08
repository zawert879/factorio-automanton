// Генерация Lua из синтаксического дерева (после анализа).
//
// Устройство сгенерированного кода — docs/DESIGN.md, «Архитектура исполнения», и src/lang/prologue.ts.
// Коротко:
// - каждая функция программы — P[номер] = function(e, this, k, параметры…);
// - код плоский: ветвления и циклы — goto на метки верхнего уровня функции (метку внутри вложенного
//   блока Lua не видно, а продолжение после паузы прыгает прямо на метку);
// - все локальные переменные объявлены в начале функции (goto нельзя «внутрь» области локальной);
// - точка остановки: метка, вызов с кадром ребёнка kc; если вызванный вернул Y — сохранить переменные
//   в кадр {номер точки, кадр ребёнка, переменные…} и вернуть Y, кадр;
// - тело try — вложенная функция под pcall с собственными точками остановки; return / break / continue
//   изнутри возвращают коды 1 / 2 и обрабатываются снаружи.
import * as A from "./ast"
import { analyze, Analysis, ClassInfo, FnInfo, Resolution, VarInfo } from "./analyze"
import { BLOCKING_HOST_METHODS, Builtin, CALLABLE_LIBRARY_OBJECTS, HIGHER_ORDER_METHODS, LIBRARY_CONSTANTS, LIBRARY_METHODS } from "./builtins"
import { Diagnostic } from "./lexer"
import { parse } from "./parser"
import { EPILOGUE, PROLOGUE } from "./prologue"

export interface CompileResult {
  ok: boolean
  lua: string
  /** lines[i] — строка исходника для строки i + 1 сгенерированного Lua (0 — служебная). */
  lines: number[]
  diagnostics: Diagnostic[]
}

/** В Lua 5.2 не больше 200 локальных переменных на функцию; запас — служебным. */
const MAX_LOCALS = 190

const LUA_KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in", "local", "nil", "not",
  "or", "repeat", "return", "then", "true", "until", "while",
])

interface Line {
  text: string
  ts: number
  /** Строка кадра паузы: после text вставляется список сохраняемых переменных, затем save. */
  save?: string
}

/** Скомпилированное выражение. */
interface V {
  code: string
  /** Значение не изменится до использования: литерал, временная, неизменяемая переменная. */
  stable?: boolean
  /** Lua-логическое значение (true/false). */
  bool?: boolean
  num?: boolean
  str?: boolean
  /** Код — вызов функции: годится как инструкция Lua. */
  call?: boolean
}

/** Цель break / continue. */
interface Target {
  id: number
  kind: "loop" | "switch"
  label?: string
  brk: string
  cont?: string
  fn: LuaFn
}

/** Функция Lua в процессе генерации: функция программы или тело try. */
class LuaFn {
  readonly lines: Line[] = []
  /** Метки точек остановки: номер точки = индекс + 1. */
  readonly pauses: string[] = []
  /** Коды break / continue, уходящие из тела try наружу: номер цели * 2 (+1 у continue). */
  readonly exits = new Set<number>()
  hasReturn = false
  tempTop = 0
  maxTemp = 0
  constructor(
    /** Функция программы, в которой живут переменные (у тела try). */
    readonly root: LuaFn | undefined,
    readonly info: FnInfo,
    readonly resumable: boolean,
  ) {}
}

/** Предел размера исходника, байт (кириллица — 2 байта на букву). */
export const MAX_SOURCE_BYTES = 100000

export function compile(source: string): CompileResult {
  if (source.length > MAX_SOURCE_BYTES) {
    return { ok: false, lua: "", lines: [], diagnostics: [{ code: "program-too-large", params: [MAX_SOURCE_BYTES], line: 1, column: 1 }] }
  }
  const parsed = parse(source)
  if (parsed.diagnostics.length > 0) return { ok: false, lua: "", lines: [], diagnostics: parsed.diagnostics }
  const analysis = analyze(parsed.program)
  if (analysis.diagnostics.length > 0) return { ok: false, lua: "", lines: [], diagnostics: analysis.diagnostics }
  const result = generate(parsed.program, analysis)
  if (!result.ok) return result
  // Пределы Lua (регистры, длина переходов) проверяет сам load: такую программу не публикуем.
  const [chunk, message] = load(result.lua, "=prog", "t", {})
  if (chunk === undefined) {
    const [luaLine] = string.match(message ?? "", "^prog:(%d+):")
    const line = luaLine !== undefined ? result.lines[tonumber(luaLine)! - 1] ?? 1 : 1
    return { ok: false, lua: "", lines: [], diagnostics: [{ code: "program-too-complex", params: [], line, column: 1 }] }
  }
  return result
}

// ---------- Литералы Lua ----------

export function luaString(s: string): string {
  const [escaped] = string.gsub(s, '[%c"\\]', (c: string) => {
    if (c === "\n") return "\\n"
    if (c === "\\") return "\\\\"
    if (c === '"') return '\\"'
    return string.format("\\%03d", string.byte(c))
  })
  return `"${escaped}"`
}

export function luaNumber(n: number): string {
  if (n !== n) return "(0/0)"
  if (n === math.huge) return "(1/0)"
  if (n === -math.huge) return "(-1/0)"
  let s: string
  if (n === math.floor(n) && math.abs(n) < 2 ** 53) s = string.format("%d", n)
  else {
    s = string.format("%.17g", n)
    for (const precision of [15, 16]) {
      const shorter = string.format(`%.${precision}g`, n)
      if (tonumber(shorter) === n) {
        s = shorter
        break
      }
    }
  }
  return n < 0 ? `(${s})` : s
}

function isLuaIdentifier(name: string): boolean {
  if (name.length === 0 || LUA_KEYWORDS.has(name)) return false
  for (let i = 1; i <= name.length; i++) {
    const c = string.byte(name, i)
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    if (!letter && !(i > 1 && c >= 48 && c <= 57)) return false
  }
  return true
}

/** Обращение к полю таблицы: .name или ["имя"]. */
function field(name: string): string {
  return isLuaIdentifier(name) ? `.${name}` : `[${luaString(name)}]`
}

/** Ключ в конструкторе таблицы: name или ["имя"]. */
function tableKey(name: string): string {
  return isLuaIdentifier(name) ? name : `[${luaString(name)}]`
}

function isSimpleName(code: string): boolean {
  for (let i = 1; i <= code.length; i++) {
    const c = string.byte(code, i)
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || (c >= 48 && c <= 57)
    if (!ok) return false
  }
  return code.length > 0 && !LUA_KEYWORDS.has(code)
}

/** Разбить список на куски (длинные списки в одной инструкции Lua упираются в лимит регистров). */
function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

export function generate(program: A.Program, analysis: Analysis): CompileResult {
  const diagnostics: Diagnostic[] = []
  const out: Line[] = []
  let cur!: LuaFn
  let info!: FnInfo
  let tsLine = 0
  let labelCounter = 0
  let targetCounter = 0
  const targets: Target[] = []
  const targetById = new Map<number, Target>()
  /** Метка «результат — undefined» текущей цепочки ?. (если компилируется её часть). */
  let chainNil: string | undefined

  function report(code: string, params: (string | number)[], at: A.Loc): void {
    diagnostics.push({ code, params, line: at.line, column: at.column })
  }

  // ---------- Вывод ----------

  function emit(text: string, save?: string): void {
    cur.lines.push({ text, ts: tsLine, save })
  }

  function newLabel(): string {
    return `L${++labelCounter}`
  }

  function owner(): LuaFn {
    return cur.root ?? cur
  }

  function temp(): string {
    const root = owner()
    root.tempTop++
    if (root.tempTop > root.maxTemp) root.maxTemp = root.tempTop
    return `t${root.tempTop}`
  }

  function tempMark(): number {
    return owner().tempTop
  }

  function tempRelease(markValue: number): void {
    owner().tempTop = markValue
  }

  function tempV(code: string, from?: V): V {
    return { code, stable: true, bool: from?.bool, num: from?.num, str: from?.str }
  }

  function materialize(v: V): V {
    if (v.stable) return v
    const t = temp()
    emit(`${t} = ${v.code}`)
    return tempV(t, v)
  }

  /**
   * Вычислить части по порядку. Если часть вывела строки (вызов с паузой, ветвление), значения
   * предыдущих частей фиксируются во временных до этих строк — порядок вычисления как в JS.
   */
  function ordered(parts: (() => V)[]): V[] {
    const results: V[] = []
    for (let j = 0; j < parts.length; j++) {
      const at = cur.lines.length
      const r = parts[j]()
      if (cur.lines.length > at && j > 0) {
        const inserts: Line[] = []
        for (let i = 0; i < j; i++) {
          const prev = results[i]
          if (prev.stable) continue
          const t = temp()
          inserts.push({ text: `${t} = ${prev.code}`, ts: tsLine })
          results[i] = tempV(t, prev)
        }
        cur.lines.splice(at, 0, ...inserts)
      }
      results.push(r)
    }
    return results
  }

  function withoutChain<T>(fn: () => T): T {
    const saved = chainNil
    chainNil = undefined
    try {
      return fn()
    } finally {
      chainNil = saved
    }
  }

  // ---------- Точки остановки ----------

  function registerPause(): { pc: number; label: string } {
    cur.pauses.push(`R${++labelCounter}`)
    return { pc: cur.pauses.length, label: cur.pauses[cur.pauses.length - 1] }
  }

  /** Строка «если cond — пауза в точке pc с кадром ребёнка child». */
  function emitPause(pc: number, child: string, cond: string): void {
    if (cur.root !== undefined) emit(`if ${cond} then return Y, {${pc}, ${child}} end`)
    else emit(`if ${cond} then Q.d = Q.d - 1 return Y, {${pc}, ${child}`, `} end`)
  }

  /** Квант инструкций: виток цикла. */
  function budget(): void {
    if (!owner().resumable) return
    const pause = registerPause()
    emit(`Q.n = Q.n - 1`)
    emitPause(pause.pc, "nil", "Q.n <= 0")
    emit(`::${pause.label}::`)
  }

  /**
   * Вызов. pause — вызов может приостановить программу: аргументы уже зафиксированы, перед вызовом
   * ставится метка, кадр ребёнка передаётся через kc.
   */
  function emitCall(pause: boolean, build: (k: string) => string): V {
    if (!pause) return { code: build("nil"), call: true }
    const point = registerPause()
    emit(`::${point.label}::`)
    const r = temp()
    const f = temp()
    emit(`${r}, ${f} = ${build("kc")}`)
    emit(`kc = nil`)
    emitPause(point.pc, f, `${r} == Y`)
    return tempV(r)
  }

  /** Возврат из текущей функции (у тела try — код 1). */
  function returnCode(value: string): string {
    if (cur.root !== undefined) {
      cur.hasReturn = true
      return `return 1, ${value}`
    }
    return owner().resumable ? `Q.d = Q.d - 1 return ${value}` : `return ${value}`
  }

  // ---------- Имена ----------

  function res(node: object): Resolution {
    return analysis.resolutions.get(node)!
  }

  function varV(v: VarInfo): V {
    return { code: v.cell ? `${v.lua}[1]` : v.lua, stable: !v.assigned }
  }

  function storeVar(v: VarInfo, value: V): void {
    emit(v.cell ? `${v.lua}[1] = ${value.code}` : `${v.lua} = ${value.code}`)
  }

  function patternVars(pattern: A.Pattern, into: VarInfo[] = []): VarInfo[] {
    if (pattern.kind === "IdentifierPattern") {
      const r = analysis.resolutions.get(pattern)
      if (r !== undefined && "var" in r) into.push(r.var)
    } else if (pattern.kind === "ObjectPattern") {
      for (const prop of pattern.properties) patternVars(prop.value, into)
      const r = analysis.resolutions.get(pattern)
      if (pattern.rest !== undefined && r !== undefined && "var" in r) into.push(r.var)
    } else {
      for (const element of pattern.elements) if (element.value !== undefined) patternVars(element.value, into)
      if (pattern.rest !== undefined) patternVars(pattern.rest, into)
    }
    return into
  }

  function builtinValue(b: Builtin, at: A.Loc): V {
    switch (b.kind) {
      case "value":
        if (b.name === "undefined") return { code: "nil", stable: true }
        return { code: b.name === "NaN" ? "(0/0)" : "(1/0)", stable: true, num: true }
      case "host-object":
        return { code: `HO.${b.name}`, stable: true }
      case "host-function":
        return { code: `R.hostFunction(${luaString(b.name)})`, call: true }
      case "library-class":
        return { code: `R.classes.${b.name}`, stable: true }
      case "library-function":
        return { code: `R.libFunction(${luaString(b.name)})`, call: true }
      default:
        if (CALLABLE_LIBRARY_OBJECTS.has(b.name)) return { code: `R.libFunction(${luaString(b.name)})`, call: true }
        report("unsupported", ["library-value", b.name], at)
        return { code: "nil", stable: true }
    }
  }

  /** this внутри методов и конструкторов класса — таблица экземпляра: поля читаются напрямую. */
  function rawThis(node: A.Expr): boolean {
    const r = analysis.resolutions.get(node)
    if (r === undefined || !("var" in r)) return false
    const fn = r.var.owner
    if (fn.cls === undefined) return false
    if (fn.kind === "constructor") return true
    if (fn.kind !== "method" && fn.kind !== "getter") return false
    for (const m of fn.cls.staticMethods.values()) if (m === fn) return false
    return true
  }

  /** Lua-имя this текущей функции (для super). */
  function ownThis(at: A.Loc): string {
    if (info.thisVar === undefined || info.cls === undefined) {
      report("unsupported", ["super-outside-method"], at)
      return "nil"
    }
    return info.thisVar.lua
  }

  // ---------- Истинность и переходы ----------

  function truth(v: V): string {
    if (v.bool) return v.code
    if (isSimpleName(v.code)) return `(${v.code} and ${v.code} ~= 0 and ${v.code} ~= "" and ${v.code} == ${v.code})`
    return `T(${v.code})`
  }

  function jumpIfFalse(e: A.Expr, target: string): void {
    if (e.kind === "Logical" && e.operator === "&&") {
      jumpIfFalse(e.left, target)
      jumpIfFalse(e.right, target)
    } else if (e.kind === "Logical" && e.operator === "||") {
      const ok = newLabel()
      jumpIfTrue(e.left, ok)
      jumpIfFalse(e.right, target)
      emit(`::${ok}::`)
    } else if (e.kind === "Unary" && e.operator === "!") {
      jumpIfTrue(e.argument, target)
    } else {
      emit(`if not ${truth(expr(e))} then goto ${target} end`)
    }
  }

  function jumpIfTrue(e: A.Expr, target: string): void {
    if (e.kind === "Logical" && e.operator === "&&") {
      const skip = newLabel()
      jumpIfFalse(e.left, skip)
      jumpIfTrue(e.right, target)
      emit(`::${skip}::`)
    } else if (e.kind === "Logical" && e.operator === "||") {
      jumpIfTrue(e.left, target)
      jumpIfTrue(e.right, target)
    } else if (e.kind === "Unary" && e.operator === "!") {
      jumpIfFalse(e.argument, target)
    } else {
      emit(`if ${truth(expr(e))} then goto ${target} end`)
    }
  }

  // ---------- Выражения ----------

  function expr(e: A.Expr): V {
    switch (e.kind) {
      case "Number":
        return { code: luaNumber(e.value), stable: true, num: true }
      case "String":
        return { code: luaString(e.value), stable: true, str: true }
      case "Boolean":
        return { code: e.value ? "true" : "false", stable: true, bool: true }
      case "Null":
        return { code: "nil", stable: true }
      case "Template":
        return template(e)
      case "Identifier": {
        const r = res(e)
        return "var" in r ? varV(r.var) : builtinValue(r.builtin, e)
      }
      case "This": {
        const r = res(e)
        return "var" in r ? varV(r.var) : { code: "nil", stable: true }
      }
      case "Super":
        report("unsupported", ["super-value"], e)
        return { code: "nil", stable: true }
      case "Array":
        return arrayLiteral(e.elements)
      case "Object":
        return objectLiteral(e.members)
      case "Function":
        return closure(analysis.fnOf.get(e.fn)!)
      case "Class":
        return classCreate(analysis.classOf.get(e.cls)!)
      case "Unary":
        return unary(e.operator, e.argument)
      case "Update":
        return update(e.operator, e.prefix, e.target, true)!
      case "Binary": {
        const [l, r] = ordered([() => expr(e.left), () => expr(e.right)])
        return binaryOp(e.operator, l, r)
      }
      case "Logical":
        return logical(e.operator, e.left, e.right)
      case "Assign":
        return assign(e.operator, e.target, e.value, true)!
      case "Conditional":
        return conditional(e.test, e.consequent, e.alternate)
      case "Call":
        return chainStart(e, () => call(e))
      case "New":
        return newExpr(e.callee, e.args, e)
      case "Member":
        return chainStart(e, () => member(e.object, e.property, e.optional, e))
      case "Index":
        return chainStart(e, () => index(e.object, e.index, e.optional, e))
      case "Sequence": {
        for (let i = 0; i < e.expressions.length - 1; i++) exprStatement(e.expressions[i])
        return expr(e.expressions[e.expressions.length - 1])
      }
    }
  }

  function template(e: Extract<A.Expr, { kind: "Template" }>): V {
    if (e.expressions.length === 0) return { code: luaString(e.quasis[0]), stable: true, str: true }
    const parts = ordered(e.expressions.map((x) => () => withoutChain(() => expr(x))))
    const pieces: string[] = []
    for (let i = 0; i < e.quasis.length; i++) {
      if (e.quasis[i] !== "") pieces.push(luaString(e.quasis[i]))
      if (i < parts.length) pieces.push(parts[i].str ? parts[i].code : `S(${parts[i].code})`)
    }
    return { code: `CHK(${pieces.join(" .. ")})`, str: true, call: true }
  }

  function arrayLiteral(elements: (A.Expr | A.Spread)[]): V {
    const parts = ordered(elements.map((el) => () => withoutChain(() => expr(el.kind === "Spread" ? el.argument : el))))
    if (!elements.some((el) => el.kind === "Spread")) {
      const items = parts.map((p) => p.code)
      return { code: `ALLOC({__n = ${items.length}${items.length > 0 ? ", " + items.join(", ") : ""}})`, call: true }
    }
    const t = temp()
    emit(`${t} = ALLOC({__n = 0})`)
    for (let i = 0; i < elements.length; i++) {
      if (elements[i].kind === "Spread") emit(`R.spreadInto(${t}, ${parts[i].code})`)
      else emit(`R.push1(${t}, ${parts[i].code})`)
    }
    return tempV(t)
  }

  function propertyValue(m: Extract<A.ObjectMember, { kind: "Property" }>): V {
    return withoutChain(() => expr(m.value))
  }

  function objectLiteral(members: A.ObjectMember[]): V {
    const simple = members.every((m) => m.kind === "Property" && m.computed === undefined)
    if (simple) {
      const props = members as Extract<A.ObjectMember, { kind: "Property" }>[]
      const parts = ordered(props.map((m) => () => propertyValue(m)))
      const fields = props.map((m, i) => `${tableKey(m.key)} = ${parts[i].code}`)
      return { code: `ALLOC({${fields.join(", ")}})`, call: true }
    }
    const t = temp()
    emit(`${t} = ALLOC({})`)
    for (const m of members) {
      if (m.kind === "Spread") {
        const v = withoutChain(() => expr(m.argument))
        emit(`R.objectSpread(${t}, ${v.code})`)
      } else if (m.computed !== undefined) {
        const computed = m.computed
        const [k, v] = ordered([() => withoutChain(() => expr(computed)), () => propertyValue(m)])
        emit(`R.setKey(${t}, ${k.code}, ${v.code})`)
      } else {
        const v = propertyValue(m)
        emit(`${t}${field(m.key)} = ${v.code}`)
      }
    }
    return tempV(t)
  }

  /** Значение-функция: {__f = номер, __e = окружение}. Переменные окружения — локальные текущей функции. */
  function closure(fn: FnInfo): V {
    if (fn.captures.length === 0) return { code: `ALLOC({__f = ${fn.index}})`, call: true }
    return { code: `ALLOC({__f = ${fn.index}, __e = {${fn.captures.map((c) => c.lua).join(", ")}}})`, call: true }
  }

  function unary(operator: string, argument: A.Expr): V {
    const v = expr(argument)
    switch (operator) {
      case "-":
        return { code: `(-${v.code})`, num: true }
      case "+":
        return { code: `R.toNumber(${v.code})`, num: true, call: true }
      case "!":
        return { code: `(not ${truth(v)})`, bool: true }
      case "~":
        return { code: `R.bnot(${v.code})`, num: true, call: true }
      case "typeof":
        return { code: `R.typeof(${v.code})`, str: true, call: true }
      case "void":
        if (!v.stable) emit(`${temp()} = ${v.code}`)
        return { code: "nil", stable: true }
    }
    report("unsupported", [operator], argument)
    return v
  }

  function binaryOp(operator: string, l: V, r: V): V {
    switch (operator) {
      case "+":
        if (l.num && r.num) return { code: `(${l.code} + ${r.code})`, num: true }
        if (l.str || r.str) {
          return { code: `CHK(${l.str ? l.code : `S(${l.code})`} .. ${r.str ? r.code : `S(${r.code})`})`, str: true, call: true }
        }
        return { code: `ADD(${l.code}, ${r.code})`, call: true }
      case "-":
      case "*":
      case "/":
        return { code: `(${l.code} ${operator} ${r.code})`, num: true }
      case "%":
        return { code: `FMOD(${l.code}, ${r.code})`, num: true, call: true }
      case "**":
        return { code: `(${l.code} ^ ${r.code})`, num: true }
      case "===":
        return { code: `(${l.code} == ${r.code})`, bool: true }
      case "!==":
        return { code: `(${l.code} ~= ${r.code})`, bool: true }
      case "<":
      case ">":
      case "<=":
      case ">=":
        return { code: `(${l.code} ${operator} ${r.code})`, bool: true }
      case "&":
        return { code: `R.band(${l.code}, ${r.code})`, num: true, call: true }
      case "|":
        return { code: `R.bor(${l.code}, ${r.code})`, num: true, call: true }
      case "^":
        return { code: `R.bxor(${l.code}, ${r.code})`, num: true, call: true }
      case "<<":
        return { code: `R.shl(${l.code}, ${r.code})`, num: true, call: true }
      case ">>":
        return { code: `R.shr(${l.code}, ${r.code})`, num: true, call: true }
      case ">>>":
        return { code: `R.ushr(${l.code}, ${r.code})`, num: true, call: true }
      case "instanceof":
        return { code: `R.instanceOf(${l.code}, ${r.code})`, bool: true, call: true }
      case "in":
        return { code: `R.has(${r.code}, ${l.code})`, bool: true, call: true }
    }
    report("unsupported", [operator], { line: tsLine, column: 0 })
    return l
  }

  function logical(operator: string, left: A.Expr, right: A.Expr): V {
    const l = expr(left)
    const t = temp()
    emit(`${t} = ${l.code}`)
    const at = cur.lines.length
    const r = expr(right)
    const rightLines = cur.lines.splice(at, cur.lines.length - at)
    const test =
      operator === "&&" ? truth(tempV(t, l)) : operator === "||" ? `not ${truth(tempV(t, l))}` : `${t} == nil`
    if (rightLines.length === 0) {
      emit(`if ${test} then ${t} = ${r.code} end`)
    } else {
      const skip = newLabel()
      emit(`if not (${test}) then goto ${skip} end`)
      for (const line of rightLines) cur.lines.push(line)
      emit(`${t} = ${r.code}`)
      emit(`::${skip}::`)
    }
    return { code: t, stable: true, bool: l.bool && r.bool, num: l.num && r.num, str: l.str && r.str }
  }

  function conditional(test: A.Expr, consequent: A.Expr, alternate: A.Expr): V {
    const t = temp()
    const elseLabel = newLabel()
    const endLabel = newLabel()
    jumpIfFalse(test, elseLabel)
    const a = expr(consequent)
    emit(`${t} = ${a.code}`)
    emit(`goto ${endLabel}`)
    emit(`::${elseLabel}::`)
    const b = expr(alternate)
    emit(`${t} = ${b.code}`)
    emit(`::${endLabel}::`)
    return { code: t, stable: true, bool: a.bool && b.bool, num: a.num && b.num, str: a.str && b.str }
  }

  // ---------- Цепочки ?. ----------

  function hasOptional(e: A.Expr): boolean {
    if (e.kind === "Member" || e.kind === "Index") return e.optional || hasOptional(e.object)
    if (e.kind === "Call") return e.optional || hasOptional(e.callee)
    return false
  }

  function chainStart(e: A.Expr, build: () => V): V {
    if (chainNil !== undefined || !hasOptional(e)) return build()
    const result = temp()
    emit(`${result} = nil`)
    const nilLabel = newLabel()
    chainNil = nilLabel
    let v: V
    try {
      v = build()
    } finally {
      chainNil = undefined
    }
    emit(`${result} = ${v.code}`)
    emit(`::${nilLabel}::`)
    return tempV(result)
  }

  /** Объект звена цепочки; у звена ?. — проверка на undefined. */
  function chainObject(object: A.Expr, optional: boolean): V {
    let o = expr(object)
    if (optional) {
      o = materialize(o)
      emit(`if ${o.code} == nil then goto ${chainNil!} end`)
    }
    return o
  }

  function member(object: A.Expr, property: string, optional: boolean, at: A.Loc): V {
    tsLine = at.line
    if (object.kind === "Super") {
      return { code: `R.superGet(e.c, ${ownThis(at)}, ${luaString(property)})`, call: true }
    }
    if (object.kind === "Identifier") {
      const r = res(object)
      if ("builtin" in r && r.builtin.kind === "library-object") {
        const constant = LIBRARY_CONSTANTS[r.builtin.name]?.[property]
        if (constant !== undefined) return { code: luaNumber(constant), stable: true, num: true }
        report("unsupported", ["library-value", `${r.builtin.name}.${property}`], at)
        return { code: "nil", stable: true }
      }
    }
    const o = chainObject(object, optional)
    if (property === "length") return { code: `LEN(${o.code})`, num: true, call: true }
    if (object.kind === "This" && rawThis(object) && !analysis.memberFunctionNames.has(property)) {
      return { code: `${o.code}${field(property)}` }
    }
    return { code: `GET(${o.code}, ${luaString(property)})`, call: true }
  }

  function index(object: A.Expr, indexExpr: A.Expr, optional: boolean, at: A.Loc): V {
    tsLine = at.line
    const [o, i] = ordered([() => chainObject(object, optional), () => withoutChain(() => expr(indexExpr))])
    return { code: `IDX(${o.code}, ${i.code})`, call: true }
  }

  // ---------- Вызовы ----------

  /** Аргументы после частей prefix (вызываемое, объект). pause — всё фиксируется во временных. */
  function callParts(prefix: (() => V)[], args: (A.Expr | A.Spread)[], pause: boolean): { prefix: V[]; args: string } {
    const hasSpread = args.some((a) => a.kind === "Spread")
    const argParts = hasSpread
      ? [() => withoutChain(() => materialize(arrayLiteral(args)))]
      : args.map((a) => () => withoutChain(() => expr(a as A.Expr)))
    let parts = ordered([...prefix, ...argParts])
    if (pause) parts = parts.map((p) => materialize(p))
    const prefixValues = parts.slice(0, prefix.length)
    const argValues = parts.slice(prefix.length)
    const argCodes = hasSpread ? [`UNPACK(${argValues[0].code})`] : argValues.map((v) => v.code)
    return { prefix: prefixValues, args: argCodes.length > 0 ? ", " + argCodes.join(", ") : "" }
  }

  function callbackMayPause(arg: A.Expr | A.Spread): boolean {
    if (arg.kind === "Function") return analysis.fnOf.get(arg.fn)!.resumable
    if (arg.kind === "Identifier") {
      const r = res(arg)
      if ("var" in r && r.var.fn !== undefined && !r.var.assigned) return r.var.fn.resumable
    }
    return true
  }

  function methodMayPause(name: string, args: (A.Expr | A.Spread)[]): boolean {
    if (analysis.resumableMethodNames.has(name)) return true
    return HIGHER_ORDER_METHODS.has(name) && args.length > 0 && callbackMayPause(args[0])
  }

  function call(e: Extract<A.Expr, { kind: "Call" }>): V {
    tsLine = e.line
    const callee = e.callee
    const resumable = owner().resumable
    if (callee.kind === "Super") return superConstructorCall(e)
    if (callee.kind === "Identifier" && !e.optional) {
      const r = res(callee)
      if ("builtin" in r) return builtinCall(r.builtin, e)
      const fn = r.var.fn
      if (fn !== undefined && !r.var.assigned) {
        const pause = resumable && fn.resumable
        const env = fn.captures.length > 0 ? `${varV(r.var).code}.__e` : "nil"
        const parts = callParts([], e.args, pause)
        return emitCall(pause, (k) => `P[${fn.index}](${env}, nil, ${k}${parts.args})`)
      }
    }
    if (callee.kind === "Member" && !e.optional) {
      const name = callee.property
      if (callee.object.kind === "Super") {
        const pause = resumable && superMethodMayPause(name)
        const self = ownThis(callee)
        const parts = callParts([], e.args, pause)
        return emitCall(pause, (k) => `SUPERCALL(e.c, ${luaString(name)}, ${self}, ${k}${parts.args})`)
      }
      if (callee.object.kind === "Identifier") {
        const r = res(callee.object)
        if ("builtin" in r && r.builtin.kind === "library-object") return libraryCall(r.builtin.name, name, e)
        if ("builtin" in r && r.builtin.kind === "host-object") {
          const pause = resumable && BLOCKING_HOST_METHODS[r.builtin.name]?.[name] === true
          const object = `HO.${r.builtin.name}`
          const parts = callParts([], e.args, pause)
          return emitCall(pause, (k) =>
            pause ? `CALLM(${object}, ${luaString(name)}, ${k}${parts.args})` : `CALLMS(${object}, ${luaString(name)}${parts.args})`,
          )
        }
      }
      const pause = resumable && methodMayPause(name, e.args)
      const parts = callParts([() => chainObject(callee.object, callee.optional)], e.args, pause)
      const o = parts.prefix[0].code
      return emitCall(pause, (k) =>
        pause ? `CALLM(${o}, ${luaString(name)}, ${k}${parts.args})` : `CALLMS(${o}, ${luaString(name)}${parts.args})`,
      )
    }
    if (callee.kind === "Member" && e.optional) {
      // a.m?.(): метод может отсутствовать.
      const name = callee.property
      const o = materialize(chainObject(callee.object, callee.optional))
      const f = materialize({ code: `GET(${o.code}, ${luaString(name)})`, call: true })
      emit(`if ${f.code} == nil then goto ${chainNil!} end`)
      const parts = callParts([], e.args, resumable)
      return emitCall(resumable, (k) =>
        resumable ? `CALL(${f.code}, ${k}, ${o.code}${parts.args})` : `CALLS(${f.code}, ${o.code}${parts.args})`,
      )
    }
    // Значение-функция.
    const parts = callParts(
      [
        () => {
          const c = expr(callee)
          if (!e.optional) return c
          const m = materialize(c)
          emit(`if ${m.code} == nil then goto ${chainNil!} end`)
          return m
        },
      ],
      e.args,
      resumable,
    )
    const c = parts.prefix[0].code
    return emitCall(resumable, (k) => (resumable ? `CALL(${c}, ${k}, nil${parts.args})` : `CALLS(${c}, nil${parts.args})`))
  }

  function builtinCall(b: Builtin, e: Extract<A.Expr, { kind: "Call" }>): V {
    switch (b.kind) {
      case "host-function": {
        const blocking = b.blocking === true
        const pause = blocking && owner().resumable
        const parts = callParts([], e.args, pause)
        return emitCall(pause, (k) => (blocking ? `H.${b.name}(${k}${parts.args})` : `H.${b.name}(${parts.args.substring(2)})`))
      }
      case "library-function": {
        const parts = callParts([], e.args, false)
        return { code: `LIB.${b.name}(${parts.args.substring(2)})`, call: true }
      }
      case "library-class": {
        const parts = callParts([], e.args, false)
        return { code: `R.callClass(${luaString(b.name)}${parts.args})`, call: true }
      }
      case "library-object":
        if (CALLABLE_LIBRARY_OBJECTS.has(b.name)) {
          const parts = callParts([], e.args, false)
          return { code: `LIB.${b.name}Of(${parts.args.substring(2)})`, call: true, str: b.name === "String", num: b.name === "Number" }
        }
        break
    }
    report("not-a-function", [b.name], e)
    return { code: "nil", stable: true }
  }

  function libraryCall(object: string, name: string, e: Extract<A.Expr, { kind: "Call" }>): V {
    if (!(LIBRARY_METHODS[object] ?? []).includes(name)) {
      report("unknown-library-method", [`${object}.${name}`], e)
      return { code: "nil", stable: true }
    }
    const parts = callParts([], e.args, false)
    return { code: `LIB.${object}.${name}(${parts.args.substring(2)})`, call: true, num: object === "Math" }
  }

  function findMethod(cls: ClassInfo | undefined, name: string): FnInfo | undefined {
    while (cls !== undefined) {
      const m = cls.methods.get(name)
      if (m !== undefined) return m
      cls = cls.superInfo
    }
    return undefined
  }

  function superMethodMayPause(name: string): boolean {
    const sup = info.cls?.superInfo
    if (sup === undefined) return false
    const m = findMethod(sup, name)
    return m === undefined || m.resumable
  }

  /** Нужна ли классу функция-конструктор. */
  function needsConstructor(cls: ClassInfo): boolean {
    if (cls.node.superClass !== undefined) return true
    return cls.node.members.some((m) => m.kind === "Constructor" || (m.kind === "Field" && !m.isStatic && m.value !== undefined))
  }

  function superConstructorCall(e: Extract<A.Expr, { kind: "Call" }>): V {
    const cls = info.cls
    if (info.kind !== "constructor" || cls === undefined || cls.node.superClass === undefined) {
      report("unsupported", ["super-call"], e)
      return { code: "nil", stable: true }
    }
    const sup = cls.superInfo
    const pause = owner().resumable && sup !== undefined && needsConstructor(sup) && sup.ctor.resumable
    const self = ownThis(e)
    const parts = callParts([], e.args, pause)
    const v = emitCall(pause, (k) => `SUPERCTOR(e.c, ${self}, ${k}${parts.args})`)
    if (!pause) emit(v.code)
    initFields(cls)
    return { code: "nil", stable: true }
  }

  function newExpr(callee: A.Expr, args: (A.Expr | A.Spread)[], at: A.Loc): V {
    tsLine = at.line
    const resumable = owner().resumable
    let known: ClassInfo | undefined
    if (callee.kind === "Identifier") {
      const r = res(callee)
      if ("builtin" in r) {
        const parts = callParts([], args, false)
        return { code: `R.construct(${luaString(r.builtin.name)}${parts.args})`, call: true }
      }
      if (r.var.cls !== undefined && !r.var.assigned) known = r.var.cls
    }
    const mayPause = known === undefined || (needsConstructor(known) && known.ctor.resumable)
    const pause = resumable && mayPause
    const parts = callParts([() => withoutChain(() => expr(callee))], args, pause)
    const c = parts.prefix[0].code
    if (pause) return emitCall(true, (k) => `NEW(${c}, ${k}${parts.args})`)
    return { code: mayPause ? `NEWS(${c}${parts.args})` : `NEW(${c}, nil${parts.args})`, call: true }
  }

  // ---------- Присваивания ----------

  interface Ref {
    read(): V
    write(value: V): void
  }

  /** Ссылка на место присваивания: объект и индекс вычислены один раз. */
  function reference(target: A.Pattern | A.Expr): Ref | undefined {
    if (target.kind === "Identifier" || target.kind === "IdentifierPattern") {
      const r = res(target)
      if (!("var" in r)) return undefined
      const v = r.var
      return { read: () => varV(v), write: (value) => storeVar(v, value) }
    }
    if (target.kind === "Member") {
      const name = target.property
      const raw = target.object.kind === "This" && rawThis(target.object)
      const o = materialize(expr(target.object))
      if (raw) {
        return {
          read: () => ({ code: `${o.code}${field(name)}` }),
          write: (value) => emit(`${o.code}${field(name)} = ${value.code}`),
        }
      }
      return {
        read: () => (name === "length" ? { code: `LEN(${o.code})`, num: true, call: true } : { code: `GET(${o.code}, ${luaString(name)})`, call: true }),
        write: (value) => emit(`SET(${o.code}, ${luaString(name)}, ${value.code})`),
      }
    }
    if (target.kind === "Index") {
      const idx = target.index
      const [o, i] = ordered([() => materialize(expr(target.object)), () => materialize(expr(idx))])
      return {
        read: () => ({ code: `IDX(${o.code}, ${i.code})`, call: true }),
        write: (value) => emit(`SETIDX(${o.code}, ${i.code}, ${value.code})`),
      }
    }
    return undefined
  }

  function assign(operator: string, target: A.Pattern | A.Expr, valueExpr: A.Expr, want: boolean): V | undefined {
    if (operator === "=") {
      if (target.kind === "ObjectPattern" || target.kind === "ArrayPattern") {
        const v = materialize(expr(valueExpr))
        destructure(target, v)
        return v
      }
      if (target.kind === "Identifier" || target.kind === "IdentifierPattern") {
        const r = res(target)
        const v0 = expr(valueExpr)
        const v = want ? materialize(v0) : v0
        if ("var" in r) storeVar(r.var, v)
        return v
      }
      if (target.kind === "Member") {
        const name = target.property
        const raw = target.object.kind === "This" && rawThis(target.object)
        const [o, v0] = ordered([() => expr(target.object), () => expr(valueExpr)])
        const v = want ? materialize(v0) : v0
        emit(raw ? `${o.code}${field(name)} = ${v.code}` : `SET(${o.code}, ${luaString(name)}, ${v.code})`)
        return v
      }
      if (target.kind === "Index") {
        const idx = target.index
        const [o, i, v0] = ordered([() => expr(target.object), () => expr(idx), () => expr(valueExpr)])
        const v = want ? materialize(v0) : v0
        emit(`SETIDX(${o.code}, ${i.code}, ${v.code})`)
        return v
      }
      report("invalid-assignment-target", [], target)
      return undefined
    }
    const op = operator.substring(0, operator.length - 1)
    const ref = reference(target)
    if (ref === undefined) {
      report("invalid-assignment-target", [], target)
      return undefined
    }
    if (op === "??" || op === "||" || op === "&&") {
      const t = temp()
      emit(`${t} = ${ref.read().code}`)
      const test = op === "??" ? `${t} == nil` : op === "||" ? `not ${truth(tempV(t))}` : truth(tempV(t))
      const skip = newLabel()
      emit(`if not (${test}) then goto ${skip} end`)
      const v = expr(valueExpr)
      emit(`${t} = ${v.code}`)
      ref.write(tempV(t))
      emit(`::${skip}::`)
      return tempV(t)
    }
    const [old, rhs] = ordered([() => ref.read(), () => expr(valueExpr)])
    let result = binaryOp(op, old, rhs)
    if (want) result = materialize(result)
    ref.write(result)
    return result
  }

  function update(operator: "++" | "--", prefix: boolean, target: A.Expr, want: boolean): V | undefined {
    const ref = reference(target)
    if (ref === undefined) {
      report("invalid-assignment-target", [], target)
      return undefined
    }
    const sign = operator === "++" ? "+" : "-"
    if (!want) {
      ref.write({ code: `(${ref.read().code} ${sign} 1)`, num: true })
      return undefined
    }
    const t = temp()
    emit(`${t} = ${ref.read().code}`)
    if (prefix) {
      emit(`${t} = ${t} ${sign} 1`)
      ref.write(tempV(t))
      return { code: t, stable: true, num: true }
    }
    ref.write({ code: `(${t} ${sign} 1)`, num: true })
    return { code: t, stable: true, num: true }
  }

  function withDefault(value: V, def: A.Expr | undefined): V {
    if (def === undefined) return value
    const t = materialize(value)
    const skip = newLabel()
    emit(`if ${t.code} ~= nil then goto ${skip} end`)
    const d = withoutChain(() => expr(def))
    emit(`${t.code} = ${d.code}`)
    emit(`::${skip}::`)
    return t
  }

  /** Деструктуризация значения (зафиксированного) по шаблону. */
  function destructure(pattern: A.Pattern, value: V): void {
    if (pattern.kind === "IdentifierPattern") {
      const r = res(pattern)
      if ("var" in r) storeVar(r.var, value)
      return
    }
    if (pattern.kind === "ObjectPattern") {
      for (const prop of pattern.properties) {
        let v: V = { code: `GET(${value.code}, ${luaString(prop.key)})`, call: true }
        v = withDefault(v, prop.default)
        destructure(prop.value, prop.value.kind === "IdentifierPattern" ? v : materialize(v))
      }
      if (pattern.rest !== undefined) {
        const r = res(pattern)
        const keys = pattern.properties.map((p) => luaString(p.key)).join(", ")
        if ("var" in r) storeVar(r.var, { code: `R.objectRest(${value.code}, {${keys}})`, call: true })
      }
      return
    }
    for (let i = 0; i < pattern.elements.length; i++) {
      const element = pattern.elements[i]
      if (element.value === undefined) continue
      let v: V = { code: `IDX(${value.code}, ${i})`, call: true }
      v = withDefault(v, element.default)
      destructure(element.value, element.value.kind === "IdentifierPattern" ? v : materialize(v))
    }
    if (pattern.rest !== undefined) {
      destructure(pattern.rest, materialize({ code: `R.arrayRest(${value.code}, ${pattern.elements.length})`, call: true }))
    }
  }

  // ---------- Классы ----------

  function classCreate(cls: ClassInfo): V {
    tsLine = cls.node.line
    const superValue = cls.node.superClass !== undefined ? expr(cls.node.superClass) : { code: "nil", stable: true }
    const t = temp()
    emit(`${t} = R.newClass(${cls.index}, ${luaString(cls.name)}, ${superValue.code})`)
    if (cls.variable !== undefined) storeVar(cls.variable, tempV(t))
    const env = temp()
    const captures = cls.pseudo.captures.map((c) => c.lua)
    emit(`${env} = {${[...captures, `c = ${t}`].join(", ")}}`)
    const fnValue = (fn: FnInfo) => `{__f = ${fn.index}, __e = ${env}}`
    if (needsConstructor(cls)) emit(`${t}.__ctor = ${fnValue(cls.ctor)}`)
    for (const member of cls.node.members) {
      if (member.kind !== "Method") continue
      if (member.isStatic) {
        if (member.accessor === "get") report("unsupported", ["static-getter"], member)
        emit(`${t}${field(member.name)} = ${fnValue(cls.staticMethods.get(member.name)!)}`)
      } else if (member.accessor === "get") {
        emit(`${t}.__g${field(member.name)} = ${fnValue(cls.getters.get(member.name)!)}`)
      } else {
        emit(`${t}.__m${field(member.name)} = ${fnValue(cls.methods.get(member.name)!)}`)
      }
    }
    for (const member of cls.node.members) {
      if (member.kind !== "Field" || !member.isStatic) continue
      const v = member.value !== undefined ? withoutChain(() => expr(member.value!)) : { code: "nil", stable: true }
      emit(`${t}${field(member.name)} = ${v.code}`)
    }
    return tempV(t)
  }

  /** Параметры-свойства и инициализаторы полей экземпляра (в конструкторе). */
  function initFields(cls: ClassInfo): void {
    const self = cls.ctor.thisVar!.lua
    const ctorNode = cls.ctor.node
    if (ctorNode !== undefined) {
      for (const param of ctorNode.params) {
        if (!param.property || param.target.kind !== "IdentifierPattern") continue
        const r = res(param.target)
        if ("var" in r) emit(`${self}${field(param.target.name)} = ${varV(r.var).code}`)
      }
    }
    for (const member of cls.node.members) {
      if (member.kind !== "Field" || member.isStatic || member.value === undefined) continue
      tsLine = member.line
      const v = expr(member.value)
      emit(`${self}${field(member.name)} = ${v.code}`)
    }
  }

  // ---------- Инструкции ----------

  function exprStatement(e: A.Expr): void {
    if (e.kind === "Assign") {
      assign(e.operator, e.target, e.value, false)
      return
    }
    if (e.kind === "Update") {
      update(e.operator, e.prefix, e.target, false)
      return
    }
    if (e.kind === "Sequence") {
      for (const x of e.expressions) exprStatement(x)
      return
    }
    const v = expr(e)
    if (v.call) emit(v.code)
    else if (!v.stable && !isSimpleName(v.code)) emit(`${temp()} = ${v.code}`)
  }

  /** Вход в блок: ячейки объявленных в нём переменных и замыкания поднятых функций. */
  function enterBlock(body: A.Stmt[]): void {
    const functions: VarInfo[] = []
    for (const s of body) {
      if (s.kind === "VarDecl") {
        for (const d of s.declarations) for (const v of patternVars(d.target)) if (v.cell) emit(`${v.lua} = {}`)
      } else if (s.kind === "ClassDecl") {
        const v = analysis.declOf.get(s)!
        if (v.cell) emit(`${v.lua} = {}`)
      } else if (s.kind === "FunctionDecl") {
        functions.push(analysis.declOf.get(s)!)
      }
    }
    for (const v of functions) {
      const value = `ALLOC({__f = ${v.fn!.index}})`
      emit(v.cell ? `${v.lua} = {${value}}` : `${v.lua} = ${value}`)
    }
    for (const v of functions) {
      const captures = v.fn!.captures
      if (captures.length > 0) emit(`${varV(v).code}.__e = {${captures.map((c) => c.lua).join(", ")}}`)
    }
  }

  function block(body: A.Stmt[]): void {
    enterBlock(body)
    for (const s of body) statement(s)
  }

  /** Тело if / цикла: отдельная область. */
  function nested(s: A.Stmt): void {
    block(s.kind === "Block" ? s.body : [s])
  }

  function newTarget(kind: "loop" | "switch", label?: string): Target {
    const t: Target = { id: ++targetCounter, kind, label, brk: newLabel(), cont: kind === "loop" ? newLabel() : undefined, fn: cur }
    targetById.set(t.id, t)
    return t
  }

  function withTarget(t: Target, fn: () => void): void {
    targets.push(t)
    try {
      fn()
    } finally {
      targets.pop()
    }
  }

  function jump(kind: "Break" | "Continue", label: string | undefined, at: A.Loc): void {
    let target: Target | undefined
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i]
      if (label !== undefined ? t.label === label : kind === "Break" || t.kind === "loop") {
        target = t
        break
      }
    }
    if (target === undefined || (kind === "Continue" && target.kind !== "loop")) {
      report("invalid-jump", [label ?? ""], at)
      return
    }
    const destination = kind === "Break" ? target.brk : target.cont!
    if (target.fn === cur) {
      emit(`goto ${destination}`)
      return
    }
    const code = target.id * 2 + (kind === "Break" ? 0 : 1)
    cur.exits.add(code)
    emit(`do return 2, ${code} end`)
  }

  function loopStatement(s: A.Stmt, label: string | undefined): void {
    const t = newTarget("loop", label)
    if (s.kind === "While") {
      emit(`::${t.cont}::`)
      budget()
      jumpIfFalse(s.test, t.brk)
      withTarget(t, () => nested(s.body))
      emit(`goto ${t.cont}`)
      emit(`::${t.brk}::`)
    } else if (s.kind === "DoWhile") {
      const top = newLabel()
      emit(`::${top}::`)
      budget()
      withTarget(t, () => nested(s.body))
      emit(`::${t.cont}::`)
      jumpIfTrue(s.test, top)
      emit(`::${t.brk}::`)
    } else if (s.kind === "For") {
      const testLabel = newLabel()
      const loopVars: VarInfo[] = []
      if (s.init !== undefined && s.init.kind === "VarDecl") {
        for (const d of (s.init as A.VarDecl).declarations) patternVars(d.target, loopVars)
      }
      for (const v of loopVars) if (v.cell) emit(`${v.lua} = {}`)
      if (s.init !== undefined) {
        if (s.init.kind === "VarDecl") statement(s.init as A.VarDecl)
        else exprStatement(s.init as A.Expr)
      }
      emit(`goto ${testLabel}`)
      emit(`::${t.cont}::`)
      // Каждая итерация — своя переменная цикла (замыкания прошлых итераций видят свои значения).
      for (const v of loopVars) if (v.cell) emit(`${v.lua} = {${v.lua}[1]}`)
      if (s.update !== undefined) exprStatement(s.update)
      emit(`::${testLabel}::`)
      budget()
      if (s.test !== undefined) jumpIfFalse(s.test, t.brk)
      withTarget(t, () => nested(s.body))
      emit(`goto ${t.cont}`)
      emit(`::${t.brk}::`)
    } else if (s.kind === "ForOf") {
      const items = temp()
      const i = temp()
      const iterable = expr(s.iterable)
      emit(`${items} = R.iter(${iterable.code})`)
      emit(`${i} = 0`)
      emit(`::${t.cont}::`)
      budget()
      emit(`${i} = ${i} + 1`)
      emit(`if ${i} > ${items}.__n then goto ${t.brk} end`)
      if (s.declKind !== undefined) for (const v of patternVars(s.target)) if (v.cell) emit(`${v.lua} = {}`)
      const item: V = { code: `${items}[${i}]` }
      destructure(s.target, s.target.kind === "IdentifierPattern" ? item : materialize(item))
      withTarget(t, () => nested(s.body))
      emit(`goto ${t.cont}`)
      emit(`::${t.brk}::`)
    }
  }

  function switchStatement(s: Extract<A.Stmt, { kind: "Switch" }>, label: string | undefined): void {
    const t = newTarget("switch", label)
    const d = materialize(expr(s.discriminant))
    const all: A.Stmt[] = []
    for (const c of s.cases) for (const x of c.body) all.push(x)
    enterBlock(all)
    const caseLabels = s.cases.map(() => newLabel())
    let defaultLabel: string | undefined
    for (let i = 0; i < s.cases.length; i++) {
      const test = s.cases[i].test
      if (test === undefined) {
        defaultLabel = caseLabels[i]
        continue
      }
      tsLine = s.cases[i].line
      const v = expr(test)
      emit(`if ${d.code} == ${v.code} then goto ${caseLabels[i]} end`)
    }
    emit(`goto ${defaultLabel ?? t.brk}`)
    withTarget(t, () => {
      for (let i = 0; i < s.cases.length; i++) {
        emit(`::${caseLabels[i]}::`)
        for (const x of s.cases[i].body) statement(x)
      }
    })
    emit(`::${t.brk}::`)
  }

  /** Тело try — отдельная функция Lua с общими переменными. */
  function compileBody(build: () => void): LuaFn {
    const parent = cur
    const body = new LuaFn(owner(), info, owner().resumable)
    cur = body
    try {
      build()
    } finally {
      cur = parent
    }
    return body
  }

  function dispatchLines(labels: string[], firstPc: number, indent: string): string[] {
    if (labels.length === 0) return []
    if (labels.length <= 8) {
      const branches = labels.map((l, i) => `pc == ${firstPc + i} then goto ${l}`)
      return [`${indent}if ${branches.join(" elseif ")} end`]
    }
    const half = math.floor(labels.length / 2)
    return [
      `${indent}if pc < ${firstPc + half} then`,
      ...dispatchLines(labels.slice(0, half), firstPc, indent + "  "),
      `${indent}else`,
      ...dispatchLines(labels.slice(half), firstPc + half, indent + "  "),
      `${indent}end`,
    ]
  }

  /** pcall тела try: метка (если тело может приостановиться), сохранение глубины, обработка паузы. */
  function protectedCall(body: LuaFn): { ok: string; kind: string; value: string } {
    const ok = temp()
    const kind = temp()
    const value = temp()
    const depth = temp()
    const sync = temp()
    const point = body.pauses.length > 0 ? registerPause() : undefined
    if (point !== undefined) emit(`::${point.label}::`)
    emit(`${depth} = Q.d ${sync} = Q.s`)
    emit(`${ok}, ${kind}, ${value} = PCALL(function(k)`)
    if (point !== undefined) {
      emit(`  local kc`)
      emit(`  if k then`)
      emit(`    kc = k[2]`)
      emit(`    local pc = k[1]`)
      for (const l of dispatchLines(body.pauses, 1, "    ")) emit(l)
      emit(`  end`)
    }
    for (const line of body.lines) cur.lines.push({ text: "  " + line.text, ts: line.ts, save: line.save })
    emit(`end, ${point !== undefined ? "kc" : "nil"})`)
    if (point !== undefined) {
      emit(`kc = nil`)
      emitPause(point.pc, value, `${ok} and ${kind} == Y`)
    }
    emit(`if not ${ok} then Q.d = ${depth} Q.s = ${sync} end`)
    return { ok, kind, value }
  }

  /** return / break / continue, вышедшие из тела try (condition — дополнительное условие). */
  function completions(body: LuaFn, kind: string, value: string, condition: string): void {
    if (body.hasReturn) emit(`if ${condition}${kind} == 1 then ${returnCode(value)} end`)
    for (const code of body.exits) {
      const target = targetById.get(math.floor(code / 2))!
      if (target.fn === cur) {
        const destination = code % 2 === 0 ? target.brk : target.cont!
        emit(`if ${condition}${kind} == 2 and ${value} == ${code} then goto ${destination} end`)
      } else {
        cur.exits.add(code)
        emit(`if ${condition}${kind} == 2 and ${value} == ${code} then return 2, ${value} end`)
      }
    }
  }

  function tryCatch(s: Extract<A.Stmt, { kind: "Try" }>): void {
    const body = compileBody(() => block(s.block))
    const r = protectedCall(body)
    const end = newLabel()
    completions(body, r.kind, r.value, `${r.ok} and `)
    emit(`if ${r.ok} then goto ${end} end`)
    if (s.param !== undefined) {
      for (const v of patternVars(s.param)) if (v.cell) emit(`${v.lua} = {}`)
      const caught = materialize({ code: `CAUGHT(${r.kind})`, call: true })
      destructure(s.param, caught)
    }
    block(s.handler ?? [])
    emit(`::${end}::`)
  }

  function tryStatement(s: Extract<A.Stmt, { kind: "Try" }>): void {
    if (s.finalizer === undefined) {
      tryCatch(s)
      return
    }
    const body = compileBody(() => {
      if (s.handler !== undefined) tryCatch(s)
      else block(s.block)
    })
    const r = protectedCall(body)
    // Вид завершения: nil — обычное, 1 — return, 2 — break/continue, 3 — исключение.
    emit(`if not ${r.ok} then ${r.kind}, ${r.value} = 3, ${r.kind} end`)
    block(s.finalizer)
    emit(`if ${r.kind} == 3 then ERROR(${r.value}, 0) end`)
    completions(body, r.kind, r.value, "")
  }

  function statement(s: A.Stmt): void {
    tsLine = s.line
    const markValue = tempMark()
    statementInner(s, undefined)
    tempRelease(markValue)
  }

  function statementInner(s: A.Stmt, label: string | undefined): void {
    switch (s.kind) {
      case "VarDecl":
        for (const d of s.declarations) {
          tsLine = d.line
          if (d.init === undefined) {
            for (const v of patternVars(d.target)) if (!v.cell) emit(`${v.lua} = nil`)
          } else if (d.target.kind === "IdentifierPattern") {
            destructure(d.target, expr(d.init))
          } else {
            destructure(d.target, materialize(expr(d.init)))
          }
        }
        return
      case "FunctionDecl":
      case "TypeDecl":
      case "Empty":
        return
      case "ClassDecl":
        classCreate(analysis.classOf.get(s.cls)!)
        return
      case "ExprStmt":
        exprStatement(s.expression)
        return
      case "If": {
        const elseLabel = newLabel()
        jumpIfFalse(s.test, elseLabel)
        nested(s.consequent)
        if (s.alternate !== undefined) {
          const endLabel = newLabel()
          emit(`goto ${endLabel}`)
          emit(`::${elseLabel}::`)
          nested(s.alternate)
          emit(`::${endLabel}::`)
        } else {
          emit(`::${elseLabel}::`)
        }
        return
      }
      case "While":
      case "DoWhile":
      case "For":
      case "ForOf":
        loopStatement(s, label)
        return
      case "Switch":
        switchStatement(s, label)
        return
      case "Labeled":
        statementInner(s.body, s.label)
        return
      case "Break":
      case "Continue":
        jump(s.kind, s.label, s)
        return
      case "Return": {
        const v = s.value !== undefined ? expr(s.value) : { code: "nil" }
        emit(`do ${returnCode(v.code)} end`)
        return
      }
      case "Throw": {
        const v = expr(s.value)
        emit(`R.throw(${v.code}, ${s.line})`)
        return
      }
      case "Try":
        tryStatement(s)
        return
      case "Block":
        block(s.body)
        return
    }
  }

  // ---------- Функции ----------

  interface Signature {
    params: string[]
    vararg: boolean
  }

  /** Параметры: имена Lua, значения по умолчанию, деструктуризация, ячейки. */
  function parameters(node: A.FunctionNode | undefined): Signature {
    const params: string[] = []
    let vararg = false
    if (node === undefined) return { params, vararg }
    for (let i = 0; i < node.params.length; i++) {
      const p = node.params[i]
      tsLine = p.line
      if (p.rest) {
        vararg = true
        destructure(p.target, materialize({ code: "R.args(...)", call: true }))
        continue
      }
      let name: string
      let target: VarInfo | undefined
      if (p.target.kind === "IdentifierPattern") {
        const r = res(p.target)
        target = "var" in r ? r.var : undefined
        name = target !== undefined ? target.lua : `a${i + 1}`
      } else {
        name = `a${i + 1}`
      }
      params.push(name)
      if (p.default !== undefined) withDefault(tempV(name), p.default)
      if (target !== undefined) {
        if (target.cell) emit(`${name} = {${name}}`)
      } else {
        destructure(p.target, tempV(name))
      }
    }
    return { params, vararg }
  }

  function compileFunction(fn: FnInfo): void {
    info = fn
    const lf = new LuaFn(undefined, fn, fn.resumable)
    cur = lf
    tsLine = fn.node?.line ?? fn.cls?.node.line ?? 1
    for (const c of fn.captures) emit(`${c.lua} = e[${fn.envOwner.captures.indexOf(c) + 1}]`)
    let signature: Signature
    if (fn.kind === "constructor") {
      const cls = fn.cls!
      signature = parameters(fn.node)
      if (fn.node === undefined && cls.node.superClass !== undefined) {
        signature.vararg = true
        const args = materialize({ code: "R.args(...)", call: true })
        const sup = cls.superInfo
        const pause = lf.resumable && sup !== undefined && needsConstructor(sup) && sup.ctor.resumable
        const v = emitCall(pause, (k) => `SUPERCTOR(e.c, ${fn.thisVar!.lua}, ${k}, UNPACK(${args.code}))`)
        if (!pause) emit(v.code)
        initFields(cls)
      } else if (cls.node.superClass === undefined) {
        initFields(cls)
      }
      if (fn.node !== undefined) block(fn.node.body as A.Stmt[])
    } else if (fn.kind === "main") {
      signature = { params: [], vararg: false }
      block(program.body)
    } else {
      const node = fn.node!
      signature = parameters(node)
      if (Array.isArray(node.body)) {
        block(node.body as A.Stmt[])
      } else {
        tsLine = (node.body as A.Expr).line
        const v = expr(node.body as A.Expr)
        emit(`do ${returnCode(v.code)} end`)
      }
    }
    if (lf.resumable) emit(`Q.d = Q.d - 1`)
    assemble(lf, signature)
  }

  function assemble(lf: LuaFn, signature: Signature): void {
    const fn = lf.info
    const line = fn.node?.line ?? fn.cls?.node.line ?? 1
    const thisName = fn.thisVar?.lua ?? "_"
    const luaParams = ["e", thisName, "k", ...signature.params, ...(signature.vararg ? ["..."] : [])]
    const paramSet = new Set(signature.params)
    const locals: string[] = []
    for (const v of fn.vars) if (v.kind !== "this" && !paramSet.has(v.lua)) locals.push(v.lua)
    for (const c of fn.captures) locals.push(c.lua)
    for (let i = 1; i <= lf.maxTemp; i++) locals.push(`t${i}`)
    if (luaParams.length + locals.length + 2 > MAX_LOCALS) {
      report("function-too-large", [fn.name], { line, column: 0 })
    }
    const saved = ["e", ...(fn.thisVar !== undefined ? [thisName] : []), ...signature.params, ...locals]
    const savedList = saved.join(", ")
    out.push({ text: `P[${fn.index}] = function(${luaParams.join(", ")})`, ts: line })
    for (const group of chunks(lf.resumable ? [...locals, "kc"] : locals, 40)) out.push({ text: `  local ${group.join(", ")}`, ts: line })
    if (lf.resumable) {
      const entry = `E${fn.index}`
      out.push({ text: `  Q.d = Q.d + 1`, ts: line })
      out.push({ text: `  if k then`, ts: line })
      let slot = 3
      for (const group of chunks(saved, 16)) {
        out.push({ text: `    ${group.join(", ")} = ${group.map(() => `k[${slot++}]`).join(", ")}`, ts: line })
      }
      out.push({ text: `    kc = k[2]`, ts: line })
      out.push({ text: `    local pc = k[1]`, ts: line })
      for (const l of dispatchLines([entry, ...lf.pauses], 0, "    ")) out.push({ text: l, ts: line })
      out.push({ text: `  end`, ts: line })
      out.push({ text: `  if Q.d > MAXD then DEPTH() end`, ts: line })
      out.push({ text: `  Q.n = Q.n - 1 if Q.n <= 0 then Q.d = Q.d - 1 return Y, {0, nil, ${savedList}} end`, ts: line })
      out.push({ text: `  ::${entry}::`, ts: line })
    }
    for (const l of lf.lines) {
      out.push({ text: "  " + l.text + (l.save !== undefined ? `, ${savedList}${l.save}` : ""), ts: l.ts })
    }
    out.push({ text: "end", ts: line })
  }

  // ---------- Программа ----------

  for (const text of PROLOGUE.split("\n")) out.push({ text, ts: 0 })
  for (const fn of analysis.functions) {
    if (fn.kind === "class") continue
    if (fn.kind === "constructor" && !needsConstructor(fn.cls!)) continue
    compileFunction(fn)
  }
  for (const text of EPILOGUE.split("\n")) out.push({ text, ts: 0 })

  if (diagnostics.length > 0) return { ok: false, lua: "", lines: [], diagnostics }
  return { ok: true, lua: out.map((l) => l.text).join("\n"), lines: out.map((l) => l.ts), diagnostics }
}
