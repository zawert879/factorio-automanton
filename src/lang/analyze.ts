// Анализ программы: разрешение имён по областям видимости, захват переменных вложенными функциями,
// классификация функций на короткие и возобновляемые.
//
// Захват. Переменная, которую использует вложенная функция, попадает в её окружение (env) при создании
// замыкания. Если переменная после объявления не меняется и к моменту создания замыкания уже
// инициализирована — в окружение кладётся само значение. Иначе переменная живёт в ячейке {значение},
// и окружение получает ячейку (cell). Методы класса разделяют окружение псевдофункции класса.
//
// Возобновляемость. Функция возобновляемая, если в ней есть цикл, вызов действия (блокирующей функции
// API), вызов функции-значения, прямой вызов возобновляемой функции, вызов метода с именем
// возобновляемого метода (класса или свойства-функции объекта), метод высшего порядка с возобновляемой
// или неизвестной функцией, рекурсия. Признак распространяется до неподвижной точки.
import * as A from "./ast"
import { BLOCKING_HOST_METHODS, Builtin, BUILTINS, HIGHER_ORDER_METHODS } from "./builtins"
import { Diagnostic } from "./lexer"

export type VarKind = "let" | "const" | "param" | "function" | "class" | "catch" | "this"

export interface VarInfo {
  id: number
  name: string
  kind: VarKind
  /** Функция, в кадре которой живёт переменная. */
  owner: FnInfo
  /** Используется вложенной функцией. */
  captured: boolean
  /** Меняется после объявления. */
  assigned: boolean
  /** Захвачена замыканием, созданным до инициализации переменной. */
  unsafeCapture: boolean
  /** Живёт в ячейке: captured && (assigned || unsafeCapture). */
  cell: boolean
  /** Объявлена в заголовке for (let …): при захвате каждая итерация получает свою ячейку. */
  loopVar: boolean
  /** Момент инициализации в порядке обхода (см. gen). */
  initGen?: number
  /** Объявление функции — для прямых вызовов. */
  fn?: FnInfo
  /** Объявление класса. */
  cls?: ClassInfo
  /** Имя в Lua. */
  lua: string
}

export type Resolution = { var: VarInfo } | { builtin: Builtin }

export type FnKind = "main" | "function" | "arrow" | "method" | "getter" | "constructor" | "class"

export interface FnInfo {
  /** Номер прототипа в сгенерированном коде (P[index]). */
  index: number
  name: string
  kind: FnKind
  node?: A.FunctionNode
  parent?: FnInfo
  vars: VarInfo[]
  /** Захваченные переменные внешних функций — порядок в окружении. */
  captures: VarInfo[]
  /** Собственный this (не у стрелочных функций). */
  thisVar?: VarInfo
  /** Чьё окружение получает функция при вызове (у методов — псевдофункция класса). */
  envOwner: FnInfo
  cls?: ClassInfo
  /** Момент создания замыкания (для объявлений функций — начало блока: они поднимаются). */
  createdAtGen: number
  resumable: boolean
  hasLoop: boolean
  callsBlocking: boolean
  callsUnknown: boolean
  directCallees: FnInfo[]
  methodNames: string[]
  higherOrderArgs: FnInfo[]
}

export interface ClassInfo {
  index: number
  name: string
  node: A.ClassNode
  /** Переменная с классом (у объявлений). */
  variable?: VarInfo
  /** Псевдофункция: окружение методов. */
  pseudo: FnInfo
  ctor: FnInfo
  methods: Map<string, FnInfo>
  getters: Map<string, FnInfo>
  staticMethods: Map<string, FnInfo>
  /** Разрешение имени родительского класса (extends Имя). */
  superClass?: Resolution
  superInfo?: ClassInfo
}

export interface Analysis {
  main: FnInfo
  functions: FnInfo[]
  classes: ClassInfo[]
  /** Узел (Identifier, This, Super, IdentifierPattern, ObjectPattern с rest) → разрешение. */
  resolutions: Map<object, Resolution>
  fnOf: Map<A.FunctionNode, FnInfo>
  classOf: Map<A.ClassNode, ClassInfo>
  /** Имена, вызов метода с которыми может приостановить программу. */
  resumableMethodNames: Set<string>
  /** Имена методов и геттеров всех классов: this.имя читается через рантайм, а не напрямую. */
  memberFunctionNames: Set<string>
  /** Инструкция FunctionDecl / ClassDecl → объявленная переменная. */
  declOf: Map<A.Stmt, VarInfo>
  /** Имена свойств, которым где-то присваивают (obj.имя = …): метод с таким именем может быть подменён. */
  assignedProperties: Set<string>
  diagnostics: Diagnostic[]
}

class Scope {
  readonly vars = new Map<string, VarInfo>()
  constructor(
    readonly fn: FnInfo,
    readonly parent?: Scope,
  ) {}

  lookup(name: string): VarInfo | undefined {
    let scope: Scope | undefined = this
    while (scope !== undefined) {
      const found = scope.vars.get(name)
      if (found !== undefined) return found
      scope = scope.parent
    }
    return undefined
  }
}

/** Имя для Lua: латиница и цифры из исходного имени плюс номер (русские имена → v_<номер>). */
function luaName(name: string, id: number): string {
  let ascii = ""
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    if (ok) ascii += name[i]
  }
  return `${ascii.length > 0 && ascii.length <= 20 ? ascii : "v"}_${id}`
}

export function analyze(program: A.Program): Analysis {
  const diagnostics: Diagnostic[] = []
  const functions: FnInfo[] = []
  const classes: ClassInfo[] = []
  const resolutions = new Map<object, Resolution>()
  const fnOf = new Map<A.FunctionNode, FnInfo>()
  const classOf = new Map<A.ClassNode, ClassInfo>()
  const declOf = new Map<A.Stmt, VarInfo>()
  const assignedProperties = new Set<string>()
  /** Функции-значения свойств объектов и присваиваний obj.имя = функция. */
  const propertyFns: { name: string; fn: FnInfo }[] = []
  let nextVarId = 1
  /** Счётчик моментов обхода: инициализации переменных и создания замыканий в порядке исполнения. */
  let gen = 0

  function report(code: string, params: (string | number)[], at: A.Loc): void {
    diagnostics.push({ code, params, line: at.line, column: at.column })
  }

  function newFn(kind: FnKind, name: string, parent: FnInfo | undefined, node?: A.FunctionNode): FnInfo {
    const fn: FnInfo = {
      index: functions.length + 1,
      name,
      kind,
      node,
      parent,
      vars: [],
      captures: [],
      createdAtGen: ++gen,
      resumable: false,
      hasLoop: false,
      callsBlocking: false,
      callsUnknown: false,
      directCallees: [],
      methodNames: [],
      higherOrderArgs: [],
      envOwner: undefined as unknown as FnInfo,
    }
    fn.envOwner = fn
    functions.push(fn)
    if (node !== undefined) fnOf.set(node, fn)
    return fn
  }

  function declare(scope: Scope, name: string, kind: VarKind, at: A.Loc, loopVar = false): VarInfo {
    if (scope.vars.has(name) && kind !== "this") report("duplicate-declaration", [name], at)
    const id = nextVarId++
    const info: VarInfo = {
      id,
      name,
      kind,
      owner: scope.fn,
      captured: false,
      assigned: false,
      unsafeCapture: false,
      cell: false,
      loopVar,
      lua: luaName(name, id),
    }
    scope.vars.set(name, info)
    scope.fn.vars.push(info)
    return info
  }

  function declarePattern(scope: Scope, pattern: A.Pattern, kind: VarKind, loopVar = false): void {
    if (pattern.kind === "IdentifierPattern") {
      resolutions.set(pattern, { var: declare(scope, pattern.name, kind, pattern, loopVar) })
    } else if (pattern.kind === "ObjectPattern") {
      for (const prop of pattern.properties) declarePattern(scope, prop.value, kind, loopVar)
      if (pattern.rest !== undefined) resolutions.set(pattern, { var: declare(scope, pattern.rest, kind, pattern, loopVar) })
    } else {
      for (const element of pattern.elements) if (element.value !== undefined) declarePattern(scope, element.value, kind, loopVar)
      if (pattern.rest !== undefined) declarePattern(scope, pattern.rest, kind, loopVar)
    }
  }

  /** Переменные шаблона инициализированы (после вычисления значения). */
  function initPattern(pattern: A.Pattern): void {
    if (pattern.kind === "IdentifierPattern") {
      const resolution = resolutions.get(pattern)
      if (resolution !== undefined && "var" in resolution) resolution.var.initGen = ++gen
    } else if (pattern.kind === "ObjectPattern") {
      for (const prop of pattern.properties) initPattern(prop.value)
      const rest = resolutions.get(pattern)
      if (rest !== undefined && "var" in rest) rest.var.initGen = ++gen
    } else {
      for (const element of pattern.elements) if (element.value !== undefined) initPattern(element.value)
      if (pattern.rest !== undefined) initPattern(pattern.rest)
    }
  }

  function walkPatternDefaults(pattern: A.Pattern, scope: Scope): void {
    if (pattern.kind === "ObjectPattern") {
      for (const prop of pattern.properties) {
        if (prop.default !== undefined) walkExpr(prop.default, scope)
        walkPatternDefaults(prop.value, scope)
      }
    } else if (pattern.kind === "ArrayPattern") {
      for (const element of pattern.elements) {
        if (element.value === undefined) continue
        if (element.default !== undefined) walkExpr(element.default, scope)
        walkPatternDefaults(element.value, scope)
      }
      if (pattern.rest !== undefined) walkPatternDefaults(pattern.rest, scope)
    }
  }

  /**
   * Переменная используется в функции from. Если from вложена во владельца переменной — захват:
   * отметить на всём пути и проверить, что замыкание создаётся после инициализации.
   */
  function use(info: VarInfo, from: FnInfo): void {
    if (info.owner === from) return
    info.captured = true
    let fn: FnInfo = from
    while (fn.parent !== undefined && fn.parent !== info.owner) {
      if (!fn.captures.includes(info)) fn.captures.push(info)
      fn = fn.parent
    }
    if (!fn.captures.includes(info)) fn.captures.push(info)
    // fn — внешняя функция пути: её замыкание создаётся в теле владельца переменной.
    if (info.initGen === undefined || info.initGen >= fn.createdAtGen) info.unsafeCapture = true
  }

  /** Объявления блока, видимые до их строки: функции, классы, let/const (поднятие). */
  function declareBlock(body: A.Stmt[], scope: Scope): void {
    const hoisted: FnInfo[] = []
    for (const stmt of body) {
      if (stmt.kind === "VarDecl") {
        for (const decl of stmt.declarations) declarePattern(scope, decl.target, stmt.declKind)
      } else if (stmt.kind === "FunctionDecl") {
        const fnInfo = newFn("function", stmt.fn.name ?? "function", scope.fn, stmt.fn)
        const info = declare(scope, stmt.fn.name!, "function", stmt)
        info.fn = fnInfo
        declOf.set(stmt, info)
        hoisted.push(fnInfo)
      } else if (stmt.kind === "ClassDecl") {
        const info = declare(scope, stmt.cls.name!, "class", stmt)
        info.cls = createClass(stmt.cls, scope)
        info.cls.variable = info
        declOf.set(stmt, info)
      }
    }
    // Замыкания объявлений функций создаются в начале блока все вместе (сначала значения, потом
    // окружения) — поэтому видят друг друга.
    for (const stmt of body) {
      if (stmt.kind === "FunctionDecl") declOf.get(stmt)!.initGen = ++gen
    }
    const startGen = ++gen
    for (const fn of hoisted) fn.createdAtGen = startGen
  }

  function walkBlock(body: A.Stmt[], scope: Scope): void {
    declareBlock(body, scope)
    for (const stmt of body) walkStmt(stmt, scope)
  }

  function walkStmt(stmt: A.Stmt, scope: Scope): void {
    switch (stmt.kind) {
      case "VarDecl":
        for (const decl of stmt.declarations) {
          walkPatternDefaults(decl.target, scope)
          if (decl.init !== undefined) walkExpr(decl.init, scope)
          initPattern(decl.target)
        }
        return
      case "FunctionDecl":
        walkFunction(stmt.fn, scope, fnOf.get(stmt.fn)!)
        return
      case "ClassDecl": {
        const info = classOf.get(stmt.cls)!
        // Класс присваивается переменной до заполнения окружения методов: методы видят свой класс.
        if (info.variable !== undefined) info.variable.initGen = ++gen
        info.pseudo.createdAtGen = ++gen
        walkClass(info, scope)
        return
      }
      case "TypeDecl":
      case "Empty":
      case "Break":
      case "Continue":
        return
      case "ExprStmt":
        walkExpr(stmt.expression, scope)
        return
      case "If":
        walkExpr(stmt.test, scope)
        walkNested(stmt.consequent, scope)
        if (stmt.alternate !== undefined) walkNested(stmt.alternate, scope)
        return
      case "While":
      case "DoWhile":
        scope.fn.hasLoop = true
        walkExpr(stmt.test, scope)
        walkNested(stmt.body, scope)
        return
      case "For": {
        scope.fn.hasLoop = true
        const loopScope = new Scope(scope.fn, scope)
        if (stmt.init !== undefined) {
          if (stmt.init.kind === "VarDecl") {
            const init = stmt.init as A.VarDecl
            for (const decl of init.declarations) declarePattern(loopScope, decl.target, init.declKind, true)
            walkStmt(init, loopScope)
          } else walkExpr(stmt.init as A.Expr, loopScope)
        }
        if (stmt.test !== undefined) walkExpr(stmt.test, loopScope)
        if (stmt.update !== undefined) walkExpr(stmt.update, loopScope)
        walkNested(stmt.body, loopScope)
        return
      }
      case "ForOf": {
        scope.fn.hasLoop = true
        walkExpr(stmt.iterable, scope)
        const loopScope = new Scope(scope.fn, scope)
        if (stmt.declKind !== undefined) {
          declarePattern(loopScope, stmt.target, stmt.declKind)
          walkPatternDefaults(stmt.target, loopScope)
          initPattern(stmt.target)
        } else {
          walkAssignTarget(stmt.target, scope)
        }
        walkNested(stmt.body, loopScope)
        return
      }
      case "Return":
        if (stmt.value !== undefined) walkExpr(stmt.value, scope)
        return
      case "Throw":
        walkExpr(stmt.value, scope)
        return
      case "Try": {
        walkBlock(stmt.block, new Scope(scope.fn, scope))
        if (stmt.handler !== undefined) {
          const catchScope = new Scope(scope.fn, scope)
          if (stmt.param !== undefined) {
            declarePattern(catchScope, stmt.param, "catch")
            initPattern(stmt.param)
          }
          walkBlock(stmt.handler, catchScope)
        }
        if (stmt.finalizer !== undefined) walkBlock(stmt.finalizer, new Scope(scope.fn, scope))
        return
      }
      case "Switch": {
        walkExpr(stmt.discriminant, scope)
        const switchScope = new Scope(scope.fn, scope)
        const all: A.Stmt[] = []
        for (const c of stmt.cases) for (const s of c.body) all.push(s)
        declareBlock(all, switchScope)
        for (const c of stmt.cases) {
          if (c.test !== undefined) walkExpr(c.test, switchScope)
          for (const s of c.body) walkStmt(s, switchScope)
        }
        return
      }
      case "Block":
        walkBlock(stmt.body, new Scope(scope.fn, scope))
        return
      case "Labeled":
        walkStmt(stmt.body, scope)
        return
    }
  }

  /** Тело if/цикла: отдельная область (let внутри не виден снаружи). */
  function walkNested(stmt: A.Stmt, scope: Scope): void {
    walkBlock(stmt.kind === "Block" ? stmt.body : [stmt], new Scope(scope.fn, scope))
  }

  function resolveName(node: object, name: string, scope: Scope, at: A.Loc): Resolution | undefined {
    const info = scope.lookup(name)
    if (info !== undefined) {
      use(info, scope.fn)
      const resolution = { var: info }
      resolutions.set(node, resolution)
      return resolution
    }
    const builtin = BUILTINS.get(name)
    if (builtin !== undefined) {
      const resolution = { builtin }
      resolutions.set(node, resolution)
      return resolution
    }
    report("unknown-name", [name], at)
    return undefined
  }

  function markAssigned(info: VarInfo, at: A.Loc): void {
    if (info.kind === "const" || info.kind === "function" || info.kind === "class") report("assign-to-const", [info.name], at)
    info.assigned = true
  }

  function walkAssignTarget(target: A.Pattern | A.Expr, scope: Scope): void {
    if (target.kind === "IdentifierPattern" || target.kind === "Identifier") {
      const resolution = resolveName(target, target.name, scope, target)
      if (resolution !== undefined && "var" in resolution) markAssigned(resolution.var, target)
      else if (resolution !== undefined) report("assign-to-builtin", [target.name], target)
    } else if (target.kind === "ObjectPattern") {
      for (const prop of target.properties) {
        if (prop.default !== undefined) walkExpr(prop.default, scope)
        walkAssignTarget(prop.value, scope)
      }
      if (target.rest !== undefined) {
        const resolution = resolveName(target, target.rest, scope, target)
        if (resolution !== undefined && "var" in resolution) markAssigned(resolution.var, target)
      }
    } else if (target.kind === "ArrayPattern") {
      for (const element of target.elements) {
        if (element.value === undefined) continue
        if (element.default !== undefined) walkExpr(element.default, scope)
        walkAssignTarget(element.value, scope)
      }
      if (target.rest !== undefined) walkAssignTarget(target.rest, scope)
    } else {
      if (target.kind === "Member") assignedProperties.add(target.property)
      if (target.kind === "Index" && target.index.kind === "String") assignedProperties.add(target.index.value)
      walkExpr(target as A.Expr, scope)
    }
  }

  /** this (и super) — this ближайшей нестрелочной функции. */
  function thisOf(scope: Scope, node: object, at: A.Loc): void {
    let s: Scope | undefined = scope
    while (s !== undefined) {
      const own = s.fn.thisVar
      if (own !== undefined) {
        use(own, scope.fn)
        resolutions.set(node, { var: own })
        return
      }
      s = s.parent
    }
    report("this-outside-class", [], at)
  }

  /** Аргумент метода высшего порядка: известная функция или «неизвестно что». */
  function higherOrderArg(arg: A.Expr | A.Spread, scope: Scope): void {
    const fn = scope.fn
    if (arg.kind === "Function") {
      fn.higherOrderArgs.push(fnOf.get(arg.fn)!)
    } else if (arg.kind === "Identifier") {
      const resolution = resolutions.get(arg)
      if (resolution !== undefined && "var" in resolution && resolution.var.fn !== undefined && !resolution.var.assigned) {
        fn.higherOrderArgs.push(resolution.var.fn)
      } else {
        fn.callsUnknown = true
      }
    } else {
      fn.callsUnknown = true
    }
  }

  function walkCall(callee: A.Expr, args: (A.Expr | A.Spread)[], scope: Scope): void {
    const fn = scope.fn
    for (const a of args) walkExpr(a.kind === "Spread" ? a.argument : a, scope)
    if (callee.kind === "Identifier") {
      const resolution = resolveName(callee, callee.name, scope, callee)
      if (resolution === undefined) return
      if ("builtin" in resolution) {
        if (resolution.builtin.blocking) fn.callsBlocking = true
      } else if (resolution.var.fn !== undefined && !resolution.var.assigned) {
        fn.directCallees.push(resolution.var.fn)
      } else {
        fn.callsUnknown = true
      }
      return
    }
    if (callee.kind === "Super") {
      // super(…) — конструктор родителя; прямой вызов добавляется после разбора классов.
      thisOf(scope, callee, callee)
      return
    }
    if (callee.kind === "Member") {
      const object = callee.object
      if (object.kind === "Identifier") {
        const resolution = resolveName(object, object.name, scope, object)
        if (resolution !== undefined && "builtin" in resolution) {
          if (BLOCKING_HOST_METHODS[resolution.builtin.name]?.[callee.property]) fn.callsBlocking = true
          return
        }
      } else if (object.kind === "Super") {
        thisOf(scope, object, object)
      } else {
        walkExpr(object, scope)
      }
      fn.methodNames.push(callee.property)
      if (HIGHER_ORDER_METHODS.has(callee.property) && args.length > 0) higherOrderArg(args[0], scope)
      return
    }
    walkExpr(callee, scope)
    fn.callsUnknown = true
  }

  function walkExpr(expr: A.Expr, scope: Scope): void {
    switch (expr.kind) {
      case "Number":
      case "String":
      case "Boolean":
      case "Null":
        return
      case "Identifier":
        resolveName(expr, expr.name, scope, expr)
        return
      case "This":
      case "Super":
        thisOf(scope, expr, expr)
        return
      case "Template":
        for (const e of expr.expressions) walkExpr(e, scope)
        return
      case "Array":
        for (const e of expr.elements) walkExpr(e.kind === "Spread" ? e.argument : e, scope)
        return
      case "Object":
        for (const m of expr.members) {
          if (m.kind === "Spread") {
            walkExpr(m.argument, scope)
            continue
          }
          if (m.computed !== undefined) walkExpr(m.computed, scope)
          if (m.value.kind === "Function") {
            const fn = walkFunction(m.value.fn, scope, undefined, m.value.fn.arrow ? "arrow" : "method")
            if (m.computed === undefined) propertyFns.push({ name: m.key, fn })
          } else if (m.value.kind === "Assign" && m.shorthand) {
            report("unsupported", ["shorthand-default-outside-destructuring"], m)
          } else {
            walkExpr(m.value, scope)
          }
        }
        return
      case "Function":
        walkFunction(expr.fn, scope)
        return
      case "Class": {
        const info = createClass(expr.cls, scope)
        info.pseudo.createdAtGen = ++gen
        walkClass(info, scope)
        return
      }
      case "Unary":
        walkExpr(expr.argument, scope)
        return
      case "Update":
        walkAssignTarget(expr.target, scope)
        return
      case "Binary":
      case "Logical":
        walkExpr(expr.left, scope)
        walkExpr(expr.right, scope)
        return
      case "Assign":
        walkExpr(expr.value, scope)
        walkAssignTarget(expr.target, scope)
        if (expr.target.kind === "Member" && expr.value.kind === "Function") {
          propertyFns.push({ name: expr.target.property, fn: fnOf.get(expr.value.fn)! })
        }
        return
      case "Conditional":
        walkExpr(expr.test, scope)
        walkExpr(expr.consequent, scope)
        walkExpr(expr.alternate, scope)
        return
      case "Call":
        walkCall(expr.callee, expr.args, scope)
        return
      case "New": {
        for (const a of expr.args) walkExpr(a.kind === "Spread" ? a.argument : a, scope)
        if (expr.callee.kind === "Identifier") {
          const resolution = resolveName(expr.callee, expr.callee.name, scope, expr.callee)
          if (resolution !== undefined && "var" in resolution) {
            if (resolution.var.cls !== undefined && !resolution.var.assigned) scope.fn.directCallees.push(resolution.var.cls.ctor)
            else scope.fn.callsUnknown = true
          } else if (resolution !== undefined && resolution.builtin.kind !== "library-class") {
            report("not-a-class", [expr.callee.name], expr.callee)
          }
        } else {
          walkExpr(expr.callee, scope)
          scope.fn.callsUnknown = true
        }
        return
      }
      case "Member":
        walkExpr(expr.object, scope)
        return
      case "Index":
        walkExpr(expr.object, scope)
        walkExpr(expr.index, scope)
        return
      case "Sequence":
        for (const e of expr.expressions) walkExpr(e, scope)
        return
    }
  }

  function walkFunction(node: A.FunctionNode, scope: Scope, existing?: FnInfo, kind?: FnKind): FnInfo {
    const fn = existing ?? fnOf.get(node) ?? newFn(kind ?? (node.arrow ? "arrow" : "function"), node.name ?? "lambda", scope.fn, node)
    const fnScope = new Scope(fn, scope)
    if (!node.arrow) {
      fn.thisVar = declare(fnScope, "this", "this", node)
      fn.thisVar.initGen = ++gen
    }
    walkParams(node, fnScope)
    walkBody(node, fnScope)
    return fn
  }

  function walkParams(node: A.FunctionNode, fnScope: Scope): void {
    for (const param of node.params) {
      declarePattern(fnScope, param.target, "param")
      if (param.default !== undefined) walkExpr(param.default, fnScope)
      walkPatternDefaults(param.target, fnScope)
      initPattern(param.target)
    }
  }

  function walkBody(node: A.FunctionNode, fnScope: Scope): void {
    if (Array.isArray(node.body)) walkBlock(node.body as A.Stmt[], new Scope(fnScope.fn, fnScope))
    else walkExpr(node.body as A.Expr, fnScope)
  }

  function createClass(node: A.ClassNode, scope: Scope): ClassInfo {
    const existing = classOf.get(node)
    if (existing !== undefined) return existing
    const name = node.name ?? "class"
    const pseudo = newFn("class", name, scope.fn)
    const ctorMember = node.members.find((m) => m.kind === "Constructor") as Extract<A.ClassMember, { kind: "Constructor" }> | undefined
    const ctor = newFn("constructor", `${name}.constructor`, pseudo, ctorMember?.fn)
    ctor.envOwner = pseudo
    const info: ClassInfo = {
      index: classes.length + 1,
      name,
      node,
      pseudo,
      ctor,
      methods: new Map(),
      getters: new Map(),
      staticMethods: new Map(),
    }
    ctor.cls = info
    pseudo.cls = info
    classes.push(info)
    classOf.set(node, info)
    for (const member of node.members) {
      if (member.kind !== "Method") continue
      const kind: FnKind = member.accessor === "get" ? "getter" : "method"
      const fn = newFn(kind, `${name}.${member.name}`, pseudo, member.fn)
      fn.envOwner = pseudo
      fn.cls = info
      const table = member.isStatic ? info.staticMethods : member.accessor === "get" ? info.getters : info.methods
      if (table.has(member.name)) report("duplicate-declaration", [member.name], member)
      table.set(member.name, fn)
    }
    return info
  }

  function walkClass(info: ClassInfo, scope: Scope): void {
    const node = info.node
    if (node.superClass !== undefined) {
      if (node.superClass.kind === "Identifier") {
        const resolution = resolveName(node.superClass, node.superClass.name, scope, node.superClass)
        info.superClass = resolution
        if (resolution !== undefined && "var" in resolution) {
          info.superInfo = resolution.var.cls
          if (info.superInfo === undefined || resolution.var.assigned) report("unsupported", ["dynamic-extends"], node.superClass)
        } else if (resolution !== undefined && resolution.builtin.name !== "Error") {
          report("unsupported", ["extends-builtin"], node.superClass)
        }
      } else {
        report("unsupported", ["dynamic-extends"], node.superClass)
      }
    }
    const classScope = new Scope(info.pseudo, scope)
    // Конструктор: параметры, затем инициализаторы полей (видят this и параметры-свойства), затем тело.
    const ctor = info.ctor
    const ctorScope = new Scope(ctor, classScope)
    ctor.thisVar = declare(ctorScope, "this", "this", node)
    ctor.thisVar.initGen = ++gen
    if (ctor.node !== undefined) walkParams(ctor.node, ctorScope)
    for (const member of node.members) {
      if (member.kind === "Field" && !member.isStatic && member.value !== undefined) walkExpr(member.value, ctorScope)
    }
    if (ctor.node !== undefined) walkBody(ctor.node, ctorScope)
    for (const member of node.members) {
      if (member.kind === "Method") {
        const table = member.isStatic ? info.staticMethods : member.accessor === "get" ? info.getters : info.methods
        walkFunction(member.fn, classScope, table.get(member.name)!)
      } else if (member.kind === "Field" && member.isStatic && member.value !== undefined) {
        walkExpr(member.value, scope)
      }
    }
  }

  // ---------- Обход программы ----------

  const main = newFn("main", "main", undefined)
  walkBlock(program.body, new Scope(main))

  for (const info of classes) {
    if (info.superInfo !== undefined) info.ctor.directCallees.push(info.superInfo.ctor)
  }

  const memberFunctionNames = new Set<string>()
  for (const info of classes) {
    for (const name of info.methods.keys()) memberFunctionNames.add(name)
    for (const name of info.getters.keys()) memberFunctionNames.add(name)
    for (const name of info.staticMethods.keys()) memberFunctionNames.add(name)
  }

  const resumableMethodNames = classify(functions, classes, propertyFns)
  for (const fn of functions) for (const v of fn.vars) v.cell = v.captured && (v.assigned || v.unsafeCapture)
  main.resumable = true
  return { main, functions, classes, resolutions, fnOf, classOf, resumableMethodNames, memberFunctionNames, declOf, assignedProperties, diagnostics }
}

/** Возобновляемость: исходные признаки, затем распространение по вызовам до неподвижной точки. */
function classify(functions: FnInfo[], classes: ClassInfo[], propertyFns: { name: string; fn: FnInfo }[]): Set<string> {
  for (const fn of functions) {
    fn.resumable = fn.kind !== "class" && (fn.hasLoop || fn.callsBlocking || fn.callsUnknown)
  }
  markRecursive(functions)

  const resumableMethods = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const info of classes) {
      for (const [name, fn] of info.methods) if (fn.resumable) resumableMethods.add(name)
      for (const [name, fn] of info.staticMethods) if (fn.resumable) resumableMethods.add(name)
    }
    for (const { name, fn } of propertyFns) if (fn.resumable) resumableMethods.add(name)
    for (const fn of functions) {
      if (fn.resumable || fn.kind === "class") continue
      if (
        fn.directCallees.some((c) => c.resumable) ||
        fn.methodNames.some((name) => resumableMethods.has(name)) ||
        fn.higherOrderArgs.some((a) => a.resumable)
      ) {
        fn.resumable = true
        changed = true
      }
    }
  }
  return resumableMethods
}

/** Функции в цикле прямых вызовов (рекурсия) — возобновляемые: у них точка остановки на входе. */
function markRecursive(functions: FnInfo[]): void {
  const state = new Map<FnInfo, number>() // 1 — в стеке обхода, 2 — обработана
  const stack: FnInfo[] = []
  function visit(fn: FnInfo): void {
    state.set(fn, 1)
    stack.push(fn)
    for (const callee of fn.directCallees) {
      const s = state.get(callee)
      if (s === 1) {
        for (let i = stack.length - 1; i >= 0; i--) {
          stack[i].resumable = true
          if (stack[i] === callee) break
        }
      } else if (s === undefined) visit(callee)
    }
    stack.pop()
    state.set(fn, 2)
  }
  for (const fn of functions) if (!state.has(fn)) visit(fn)
}
