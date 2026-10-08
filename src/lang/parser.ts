// Парсер языка программ: токены → синтаксическое дерево (src/lang/ast.ts).
// Рекурсивный спуск; бинарные операции — по таблице приоритетов. Неоднозначности TypeScript
// (стрелочная функция или скобки, f<T>(…) или сравнение, тип функции или тип в скобках) решаются
// пробным разбором с откатом. После ошибки парсер пропускает текст до конца инструкции и разбирает
// дальше — игрок видит все ошибки сразу. Неподдерживаемое (var, async, import…) — ошибка с кодом.
import * as A from "./ast"
import { Diagnostic, Token, tokenize } from "./lexer"

export interface ParseResult {
  program: A.Program
  diagnostics: Diagnostic[]
}

const MAX_DIAGNOSTICS = 30
/** Предел вложенности выражений, инструкций и типов: глубже — ошибка, а не переполнение стека. */
const MAX_DEPTH = 150

/** Брошенный при ошибке маркер: разбор инструкции прерывается и продолжается со следующей. */
const FAILURE = { failure: true }

const BINARY_PRECEDENCE: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "|": 4,
  "^": 5,
  "&": 6,
  "===": 7,
  "!==": 7,
  "==": 7,
  "!=": 7,
  "<": 8,
  ">": 8,
  "<=": 8,
  ">=": 8,
  instanceof: 8,
  in: 8,
  "<<": 9,
  ">>": 9,
  ">>>": 9,
  "+": 10,
  "-": 10,
  "*": 11,
  "/": 11,
  "%": 11,
  "**": 12,
}
/** Приоритет «as» — как у сравнений. */
const AS_PRECEDENCE = 8

const ASSIGN_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "??=", "||=", "&&=", "&=", "|=", "^=", "<<=", ">>=", ">>>="])

const CLASS_MODIFIERS = new Set(["public", "private", "protected", "readonly", "static", "abstract", "override", "declare"])

const KEYWORD_TYPES = new Set([
  "number", "string", "boolean", "void", "null", "undefined", "unknown", "never", "object", "any", "symbol", "bigint", "this",
])

/** Возможности TypeScript, которых нет в языке, — по ключевому слову в начале инструкции. */
const UNSUPPORTED_STATEMENTS: Record<string, string> = {
  var: "var",
  import: "import",
  export: "export",
  enum: "enum",
  namespace: "namespace",
  module: "namespace",
  declare: "declare",
  debugger: "debugger",
  with: "with",
}

export interface ParseOptions {
  /** Режим объявлений (.d.ts): declare function / const / class без тел. */
  declarations?: boolean
  /** Сдвиг номеров строк (модули программы, src/lang/modules.ts). */
  lineBase?: number
}

export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const lexed = tokenize(source, options.lineBase ?? 0)
  const tokens = lexed.tokens
  const diagnostics: Diagnostic[] = [...lexed.diagnostics]
  let pos = 0
  let depth = 0

  /** Рекурсивный шаг разбора с проверкой глубины. */
  function nested<T>(parseFn: () => T): T {
    if (depth >= MAX_DEPTH) fail("too-deeply-nested", [MAX_DEPTH])
    depth++
    try {
      return parseFn()
    } finally {
      depth--
    }
  }

  // ---------- Токены ----------

  const peek = (offset = 0): Token => tokens[math.min(pos + offset, tokens.length - 1)]
  const next = (): Token => {
    const token = tokens[pos]
    if (pos < tokens.length - 1) pos++
    return token
  }
  const loc = (token: Token = peek()): A.Loc => ({ line: token.start.line, column: token.start.column })

  /** Токен — этот знак, ключевое слово или контекстное слово (имя). */
  function is(value: string, offset = 0): boolean {
    const token = peek(offset)
    return token.value === value && (token.kind === "punctuator" || token.kind === "keyword" || token.kind === "identifier")
  }
  function isPunct(value: string, offset = 0): boolean {
    const token = peek(offset)
    return token.kind === "punctuator" && token.value === value
  }
  function eat(value: string): boolean {
    if (!is(value)) return false
    next()
    return true
  }

  function report(code: string, params: (string | number)[], token: Token = peek()): void {
    if (diagnostics.length < MAX_DIAGNOSTICS) {
      diagnostics.push({ code, params, line: token.start.line, column: token.start.column })
    }
  }

  function fail(code: string, params: (string | number)[], token: Token = peek()): never {
    report(code, params, token)
    throw FAILURE
  }

  function describe(token: Token): string {
    return token.kind === "eof" ? "конец программы" : token.kind === "string" ? `"${token.value}"` : token.value
  }

  function expect(value: string): Token {
    if (!is(value)) fail("expected-token", [value, describe(peek())])
    return next()
  }

  /** «>» в конце списка типов: «>>» и «>=» делятся (Map<string, Array<number>>). */
  function expectCloseAngle(): void {
    const token = peek()
    if (token.kind === "punctuator" && token.value.startsWith(">") && token.value.length > 1) {
      tokens[pos] = { ...token, value: token.value.substring(1), start: { line: token.start.line, column: token.start.column + 1 } }
      return
    }
    expect(">")
  }

  function identifierName(): string {
    const token = peek()
    if (token.kind !== "identifier") fail("expected-identifier", [describe(token)])
    next()
    if (token.value.startsWith("__")) report("reserved-name", [token.value], token)
    return token.value
  }

  /** Имя свойства после точки или в объекте: любое слово, в том числе ключевое (obj.default). */
  function propertyName(): string {
    const token = peek()
    if (token.kind !== "identifier" && token.kind !== "keyword") fail("expected-identifier", [describe(token)])
    next()
    if (token.value.startsWith("__")) report("reserved-name", [token.value], token)
    return token.value
  }

  /** Конец инструкции: «;», или «}», или конец программы, или перевод строки. */
  function consumeSemicolon(): void {
    if (eat(";")) return
    const token = peek()
    if (isPunct("}") || token.kind === "eof" || token.newlineBefore) return
    fail("expected-semicolon", [describe(token)])
  }

  /** Пробный разбор: при неудаче позиция и ошибки откатываются, результат — undefined. */
  function attempt<T>(parseFn: () => T): T | undefined {
    const savedPos = pos
    const savedDepth = depth
    const savedDiagnostics = diagnostics.length
    const savedTokens = new Map<number, Token>()
    // «>>» мог быть разделён — запомнить токены, чтобы вернуть.
    for (let k = pos; k < math.min(pos + 200, tokens.length); k++) savedTokens.set(k, tokens[k])
    try {
      return parseFn()
    } catch (error) {
      if (error !== FAILURE) throw error
      pos = savedPos
      depth = savedDepth
      while (diagnostics.length > savedDiagnostics) diagnostics.pop()
      for (const [k, token] of savedTokens) tokens[k] = token
      return undefined
    }
  }

  // ---------- Типы ----------

  function parseTypeArguments(): A.TypeNode[] {
    expect("<")
    const args: A.TypeNode[] = []
    if (!isPunct(">")) {
      do args.push(parseType())
      while (eat(","))
    }
    expectCloseAngle()
    return args
  }

  /** Параметры типа в объявлении: <T, U extends X = Y>. */
  function parseTypeParamDecls(): A.TypeParamDecl[] {
    const decls: A.TypeParamDecl[] = []
    if (!isPunct("<")) return decls
    next()
    do {
      const name = identifierName()
      const constraint = eat("extends") ? parseType() : undefined
      const fallback = eat("=") ? parseType() : undefined
      decls.push({ name, constraint, default: fallback })
    } while (eat(","))
    expectCloseAngle()
    return decls
  }

  /** Только имена параметров типа (функции и классы программы). */
  function parseTypeParameters(): string[] {
    return parseTypeParamDecls().map((d) => d.name)
  }

  function parseType(): A.TypeNode {
    return nested(parseTypeInner)
  }

  function parseTypeInner(): A.TypeNode {
    const start = loc()
    eat("|")
    const first = parseIntersectionType()
    if (!isPunct("|")) return first
    const types = [first]
    while (eat("|")) types.push(parseIntersectionType())
    return { ...start, kind: "UnionType", types }
  }

  function parseIntersectionType(): A.TypeNode {
    const start = loc()
    eat("&")
    const first = parseTypeOperator()
    if (!isPunct("&")) return first
    const types = [first]
    while (eat("&")) types.push(parseTypeOperator())
    return { ...start, kind: "IntersectionType", types }
  }

  function parseTypeOperator(): A.TypeNode {
    const start = loc()
    if (is("keyof")) {
      next()
      return { ...start, kind: "KeyofType", type: parseTypeOperator() }
    }
    if (is("readonly") && !isPunct(",", 1) && !isPunct(")", 1)) {
      next()
      return parseTypeOperator()
    }
    let type = parsePrimaryType()
    while (isPunct("[") && !peek().newlineBefore) {
      next()
      if (eat("]")) type = { ...start, kind: "ArrayType", element: type }
      else {
        const index = parseType()
        expect("]")
        type = { ...start, kind: "IndexedType", object: type, index }
      }
    }
    return type
  }

  function parseFunctionTypeParams(): A.TypeParam[] {
    expect("(")
    const params: A.TypeParam[] = []
    while (!isPunct(")")) {
      const rest = eat("...")
      const nameToken = peek()
      if (nameToken.kind !== "identifier" && !is("this")) fail("expected-identifier", [describe(nameToken)])
      next()
      const optional = eat("?")
      const type = eat(":") ? parseType() : undefined
      params.push({ name: nameToken.value, optional, rest, type })
      if (!eat(",")) break
    }
    expect(")")
    return params
  }

  function parseObjectType(): A.TypeMember[] {
    expect("{")
    const members: A.TypeMember[] = []
    while (!isPunct("}")) {
      const readonly = is("readonly") && peek(1).kind !== "punctuator" ? (next(), true) : false
      if (isPunct("(") || isPunct("<")) {
        // Сигнатура вызова: (a: T): R — объект, который можно вызвать.
        const typeParams = parseTypeParamDecls()
        const params = parseFunctionTypeParams()
        const result = eat(":") ? parseType() : { ...loc(), kind: "KeywordType" as const, name: "void" }
        members.push({ name: "[call]", optional: false, readonly, method: true, type: { ...loc(), kind: "FunctionType", params, result, typeParams } })
      } else if (isPunct("[")) {
        // Индексная сигнатура: [key: string]: T; по числу ([i: number]) — только для obj[число].
        next()
        identifierName()
        expect(":")
        const keyType = parseType()
        expect("]")
        expect(":")
        const numeric = keyType.kind === "KeywordType" && keyType.name === "number"
        members.push({ name: numeric ? "[number-index]" : "[index]", optional: false, readonly, method: false, type: parseType() })
      } else {
        const name = peek().kind === "string" ? next().value : propertyName()
        const optional = eat("?")
        if (isPunct("(") || isPunct("<")) {
          const typeParams = parseTypeParamDecls()
          const params = parseFunctionTypeParams()
          const result = eat(":") ? parseType() : { ...loc(), kind: "KeywordType" as const, name: "void" }
          members.push({ name, optional, readonly, method: true, type: { ...loc(), kind: "FunctionType", params, result, typeParams } })
        } else {
          expect(":")
          members.push({ name, optional, readonly, method: false, type: parseType() })
        }
      }
      if (!eat(";") && !eat(",") && !peek().newlineBefore && !isPunct("}")) fail("expected-token", [";", describe(peek())])
    }
    expect("}")
    return members
  }

  function parsePrimaryType(): A.TypeNode {
    const start = loc()
    const token = peek()
    if (isPunct("(")) {
      // Тип функции (a: T) => R или тип в скобках.
      const fnType = attempt(() => {
        const params = parseFunctionTypeParams()
        expect("=>")
        return { ...start, kind: "FunctionType" as const, params, result: parseType() }
      })
      if (fnType !== undefined) return fnType
      next()
      const inner = parseType()
      expect(")")
      return inner
    }
    if (isPunct("<")) {
      const typeParams = parseTypeParamDecls()
      const params = parseFunctionTypeParams()
      expect("=>")
      return { ...start, kind: "FunctionType", params, result: parseType(), typeParams }
    }
    if (isPunct("{")) return { ...start, kind: "ObjectType", members: parseObjectType() }
    if (isPunct("[")) {
      next()
      const elements: A.TypeNode[] = []
      while (!isPunct("]")) {
        eat("...")
        elements.push(parseType())
        eat("?")
        if (!eat(",")) break
      }
      expect("]")
      return { ...start, kind: "TupleType", elements }
    }
    if (token.kind === "string") {
      next()
      return { ...start, kind: "LiteralType", value: token.value }
    }
    if (token.kind === "number") {
      next()
      return { ...start, kind: "LiteralType", value: token.number! }
    }
    if (isPunct("-") && peek(1).kind === "number") {
      next()
      return { ...start, kind: "LiteralType", value: -next().number! }
    }
    if (is("true") || is("false")) return { ...start, kind: "LiteralType", value: next().value === "true" }
    if (is("typeof")) {
      next()
      let name = propertyName()
      while (eat(".")) name += "." + propertyName()
      return { ...start, kind: "TypeofType", name }
    }
    if (token.kind === "template" || token.kind === "template-head") fail("unsupported", ["template-literal-type"])
    if ((token.kind === "identifier" || token.kind === "keyword") && KEYWORD_TYPES.has(token.value) && !isPunct(".", 1)) {
      next()
      return { ...start, kind: "KeywordType", name: token.value }
    }
    if (token.kind === "identifier") {
      let name = identifierName()
      while (isPunct(".")) {
        next()
        name += "." + propertyName()
      }
      const args = isPunct("<") && !peek().newlineBefore ? parseTypeArguments() : []
      return { ...start, kind: "TypeRef", name, args }
    }
    fail("expected-type", [describe(token)])
  }

  // ---------- Шаблоны деструктуризации ----------

  function parseBindingPattern(): A.Pattern {
    const start = loc()
    if (isPunct("{")) {
      next()
      const properties: { key: string; value: A.Pattern; default?: A.Expr }[] = []
      let rest: string | undefined
      while (!isPunct("}")) {
        if (eat("...")) {
          rest = identifierName()
          break
        }
        const keyToken = peek()
        const key = keyToken.kind === "string" ? next().value : propertyName()
        const value: A.Pattern = eat(":") ? parseBindingPattern() : { ...loc(keyToken), kind: "IdentifierPattern", name: key }
        const def = eat("=") ? parseAssignment() : undefined
        properties.push({ key, value, default: def })
        if (!eat(",")) break
      }
      expect("}")
      return { ...start, kind: "ObjectPattern", properties, rest }
    }
    if (isPunct("[")) {
      next()
      const elements: { value?: A.Pattern; default?: A.Expr }[] = []
      let rest: A.Pattern | undefined
      while (!isPunct("]")) {
        if (isPunct(",")) {
          next()
          elements.push({})
          continue
        }
        if (eat("...")) {
          rest = parseBindingPattern()
          break
        }
        const value = parseBindingPattern()
        const def = eat("=") ? parseAssignment() : undefined
        elements.push({ value, default: def })
        if (!eat(",")) break
      }
      expect("]")
      return { ...start, kind: "ArrayPattern", elements, rest }
    }
    return { ...start, kind: "IdentifierPattern", name: identifierName() }
  }

  /** Выражение слева от «=» → шаблон (деструктурирующее присваивание [a, b] = [b, a]). */
  function toPattern(expr: A.Expr | A.Pattern): A.Pattern | A.Expr {
    // Уже шаблон (значение по умолчанию внутри объекта разобрано как присваивание: { y: z = 2 }).
    if (expr.kind === "IdentifierPattern" || expr.kind === "ObjectPattern" || expr.kind === "ArrayPattern") return expr
    if (expr.kind === "Identifier") return { line: expr.line, column: expr.column, kind: "IdentifierPattern", name: expr.name }
    if (expr.kind === "Member" || expr.kind === "Index") return expr
    if (expr.kind === "Array") {
      const elements: { value?: A.Pattern; default?: A.Expr }[] = []
      let rest: A.Pattern | undefined
      for (const element of expr.elements) {
        if (element.kind === "Spread") rest = assignmentPattern(element.argument)
        else if (element.kind === "Assign" && element.operator === "=") {
          elements.push({ value: assignmentPattern(element.target as A.Expr), default: element.value })
        } else elements.push({ value: assignmentPattern(element) })
      }
      return { line: expr.line, column: expr.column, kind: "ArrayPattern", elements, rest }
    }
    if (expr.kind === "Object") {
      const properties: { key: string; value: A.Pattern; default?: A.Expr }[] = []
      let rest: string | undefined
      for (const member of expr.members) {
        if (member.kind === "Spread") {
          if (member.argument.kind !== "Identifier") fail("invalid-assignment-target", [], peek())
          rest = member.argument.name
        } else if (member.value.kind === "Assign" && member.value.operator === "=") {
          properties.push({ key: member.key, value: assignmentPattern(member.value.target as A.Expr), default: member.value.value })
        } else properties.push({ key: member.key, value: assignmentPattern(member.value) })
      }
      return { line: expr.line, column: expr.column, kind: "ObjectPattern", properties, rest }
    }
    report("invalid-assignment-target", [])
    return expr
  }

  function assignmentPattern(expr: A.Expr | A.Pattern): A.Pattern {
    const pattern = toPattern(expr)
    if (pattern.kind === "Member" || pattern.kind === "Index") fail("unsupported", ["member-in-destructuring"])
    return pattern as A.Pattern
  }

  // ---------- Функции ----------

  function parseParams(allowProperties: boolean): A.Param[] {
    expect("(")
    const params: A.Param[] = []
    while (!isPunct(")")) {
      const start = loc()
      let property = false
      while (allowProperties && CLASS_MODIFIERS.has(peek().value) && peek().kind === "identifier" && peek(1).kind === "identifier") {
        next()
        property = true
      }
      if (is("this") && (isPunct(":", 1) || isPunct(",", 1) || isPunct(")", 1))) {
        // Аннотация this в TypeScript — не настоящий параметр.
        next()
        if (eat(":")) parseType()
        if (!eat(",")) break
        continue
      }
      const rest = eat("...")
      const target = parseBindingPattern()
      const optional = eat("?")
      const type = eat(":") ? parseType() : undefined
      const def = eat("=") ? parseAssignment() : undefined
      params.push({ ...start, target, default: def, rest, type, optional, property })
      if (!eat(",")) break
    }
    expect(")")
    return params
  }

  function parseFunctionBody(): A.Stmt[] {
    expect("{")
    const body = parseStatementsUntil("}")
    expect("}")
    return body
  }

  /** function name<T>(params): R { … } — после ключевого слова function. */
  function parseFunctionRest(start: A.Loc, name: string | undefined): A.FunctionNode {
    if (isPunct("*")) fail("unsupported", ["generator"])
    const typeParams = parseTypeParameters()
    const params = parseParams(false)
    const returnType = eat(":") ? parseType() : undefined
    return { ...start, name, params, body: parseFunctionBody(), arrow: false, returnType, typeParams }
  }

  function parseArrowFunction(): A.Expr | undefined {
    const start = loc()
    if (peek().kind === "identifier" && isPunct("=>", 1) && !peek(1).newlineBefore) {
      const name = identifierName()
      next()
      const param: A.Param = { ...start, target: { ...start, kind: "IdentifierPattern", name }, rest: false, optional: false, property: false }
      return { ...start, kind: "Function", fn: { ...start, params: [param], body: parseArrowBody(), arrow: true, typeParams: [] } }
    }
    if (!isPunct("(") && !isPunct("<")) return undefined
    return attempt(() => {
      const typeParams = parseTypeParameters()
      const params = parseParams(false)
      const returnType = eat(":") ? parseType() : undefined
      if (!isPunct("=>") || peek().newlineBefore) fail("expected-token", ["=>", describe(peek())])
      next()
      const fn: A.FunctionNode = { ...start, params, body: parseArrowBody(), arrow: true, returnType, typeParams }
      return { ...start, kind: "Function" as const, fn }
    })
  }

  function parseArrowBody(): A.Stmt[] | A.Expr {
    return isPunct("{") ? parseFunctionBody() : parseAssignment()
  }

  // ---------- Классы ----------

  function parseClass(start: A.Loc, isAbstract: boolean, requireName: boolean): A.ClassNode {
    expect("class")
    const name = peek().kind === "identifier" && !is("extends") && !is("implements") ? identifierName() : undefined
    if (requireName && name === undefined) fail("expected-identifier", [describe(peek())])
    const typeParams = parseTypeParameters()
    let superClass: A.Expr | undefined
    if (eat("extends")) {
      superClass = parseLeftHandSide(false)
      if (isPunct("<")) parseTypeArguments()
    }
    if (eat("implements")) {
      do parseType()
      while (eat(","))
    }
    expect("{")
    const members: A.ClassMember[] = []
    while (!isPunct("}")) {
      if (eat(";")) continue
      const memberStart = loc()
      let isStatic = false
      let memberAbstract = false
      // Модификаторы — только если за словом идёт ещё одно имя (иначе это само имя члена: static() {}).
      while (CLASS_MODIFIERS.has(peek().value) && peek().kind === "identifier" && !isPunct("(", 1) && !isPunct("=", 1) && !isPunct(":", 1) && !isPunct(";", 1) && !isPunct("?", 1) && !isPunct("}", 1)) {
        const modifier = next().value
        if (modifier === "static") isStatic = true
        if (modifier === "abstract") memberAbstract = true
      }
      if (is("constructor") && isPunct("(", 1)) {
        next()
        const params = parseParams(true)
        const fn: A.FunctionNode = { ...memberStart, name: "constructor", params, body: parseFunctionBody(), arrow: false, typeParams: [] }
        members.push({ ...memberStart, kind: "Constructor", fn })
        continue
      }
      let accessor: "method" | "get" | "set" = "method"
      if ((is("get") || is("set")) && (peek(1).kind === "identifier" || peek(1).kind === "keyword") && !isPunct("(", 1)) {
        accessor = next().value as "get" | "set"
        if (accessor === "set") fail("unsupported", ["setter"])
      }
      if (isPunct("[")) fail("unsupported", ["computed-member"])
      if (isPunct("#")) fail("unsupported", ["private-name"])
      const nameToken = peek()
      const name = nameToken.kind === "string" ? next().value : propertyName()
      const optional = eat("?")
      eat("!")
      if (isPunct("(") || isPunct("<")) {
        const typeParams = parseTypeParameters()
        const params = parseParams(false)
        const returnType = eat(":") ? parseType() : undefined
        if (memberAbstract || !isPunct("{")) {
          consumeSemicolon()
          members.push({ ...memberStart, kind: "AbstractMethod", name })
          continue
        }
        const fn: A.FunctionNode = { ...memberStart, name, params, body: parseFunctionBody(), arrow: false, returnType, typeParams }
        members.push({ ...memberStart, kind: "Method", name, isStatic, fn, accessor })
        continue
      }
      const type = eat(":") ? parseType() : undefined
      const value = eat("=") ? parseAssignment() : undefined
      consumeSemicolon()
      members.push({ ...memberStart, kind: "Field", name, isStatic, value, type, optional })
    }
    expect("}")
    return { ...start, name, superClass, isAbstract, members, typeParams }
  }

  // ---------- Выражения ----------

  function parseExpression(): A.Expr {
    const start = loc()
    const first = parseAssignment()
    if (!isPunct(",")) return first
    const expressions = [first]
    while (eat(",")) expressions.push(parseAssignment())
    return { ...start, kind: "Sequence", expressions }
  }

  function parseAssignment(): A.Expr {
    return nested(parseAssignmentInner)
  }

  function parseAssignmentInner(): A.Expr {
    const arrow = parseArrowFunction()
    if (arrow !== undefined) return arrow
    if (is("async") && (is("function", 1) || isPunct("(", 1) || peek(1).kind === "identifier")) fail("unsupported", ["async"])
    if (is("yield")) fail("unsupported", ["generator"])
    const start = loc()
    const left = parseConditional()
    const operator = peek()
    if (operator.kind === "punctuator" && ASSIGN_OPERATORS.has(operator.value)) {
      next()
      const target = operator.value === "=" ? toPattern(left) : left
      if (operator.value !== "=" && !isAssignable(left)) report("invalid-assignment-target", [], operator)
      return { ...start, kind: "Assign", operator: operator.value, target, value: parseAssignment() }
    }
    return left
  }

  function isAssignable(expr: A.Expr): boolean {
    return expr.kind === "Identifier" || expr.kind === "Member" || expr.kind === "Index"
  }

  function parseConditional(): A.Expr {
    const start = loc()
    const test = parseBinary(0)
    if (!eat("?")) return test
    const consequent = parseAssignment()
    expect(":")
    const alternate = parseAssignment()
    return { ...start, kind: "Conditional", test, consequent, alternate }
  }

  function parseBinary(minPrecedence: number): A.Expr {
    const start = loc()
    let left = parseUnary()
    while (true) {
      const token = peek()
      if (is("as") && token.kind === "identifier" && !token.newlineBefore && AS_PRECEDENCE > minPrecedence) {
        next()
        if (is("const")) next()
        else left = { ...left, asType: parseType() }
        continue
      }
      if (is("satisfies") && token.kind === "identifier" && !token.newlineBefore && AS_PRECEDENCE > minPrecedence) {
        next()
        parseType()
        continue
      }
      const isOperator = token.kind === "punctuator" || (token.kind === "keyword" && (token.value === "instanceof" || token.value === "in"))
      const precedence = isOperator ? BINARY_PRECEDENCE[token.value] : undefined
      if (precedence === undefined || precedence <= minPrecedence) break
      next()
      if (token.value === "==" || token.value === "!=") report("loose-equality", [token.value], token)
      const operator = token.value === "==" ? "===" : token.value === "!=" ? "!==" : token.value
      // «**» правоассоциативен (2 ** 3 ** 2 = 2 ** 9): правая часть — с приоритетом на ступень ниже.
      const right = parseBinary(operator === "**" ? precedence - 1 : precedence)
      if (operator === "&&" || operator === "||" || operator === "??") {
        left = { ...start, kind: "Logical", operator, left, right }
      } else {
        left = { ...start, kind: "Binary", operator, left, right }
      }
    }
    return left
  }

  function parseUnary(): A.Expr {
    return nested(parseUnaryInner)
  }

  function parseUnaryInner(): A.Expr {
    const start = loc()
    const token = peek()
    if (token.kind === "punctuator" && (token.value === "!" || token.value === "-" || token.value === "+" || token.value === "~")) {
      next()
      return { ...start, kind: "Unary", operator: token.value, argument: parseUnary() }
    }
    if (is("typeof") || is("void")) {
      next()
      return { ...start, kind: "Unary", operator: token.value, argument: parseUnary() }
    }
    if (is("delete")) fail("unsupported", ["delete"])
    if (is("await")) fail("unsupported", ["async"])
    if (isPunct("++") || isPunct("--")) {
      next()
      const target = parseUnary()
      if (!isAssignable(target)) report("invalid-assignment-target", [], token)
      return { ...start, kind: "Update", operator: token.value as "++" | "--", prefix: true, target }
    }
    if (isPunct("<")) fail("unsupported", ["angle-type-assertion"])
    return parsePostfix()
  }

  function parsePostfix(): A.Expr {
    const start = loc()
    const expr = parseLeftHandSide(true)
    if ((isPunct("++") || isPunct("--")) && !peek().newlineBefore) {
      const token = next()
      if (!isAssignable(expr)) report("invalid-assignment-target", [], token)
      return { ...start, kind: "Update", operator: token.value as "++" | "--", prefix: false, target: expr }
    }
    return expr
  }

  function parseArguments(): (A.Expr | A.Spread)[] {
    expect("(")
    const args: (A.Expr | A.Spread)[] = []
    while (!isPunct(")")) {
      const start = loc()
      if (eat("...")) args.push({ ...start, kind: "Spread", argument: parseAssignment() })
      else args.push(parseAssignment())
      if (!eat(",")) break
    }
    expect(")")
    return args
  }

  /** Обращения, индексы, вызовы: a.b, a?.b, a[b], a(b), a<T>(b), a!. allowCalls=false — для extends. */
  function parseLeftHandSide(allowCalls: boolean): A.Expr {
    const start = loc()
    let expr = is("new") ? parseNew() : parsePrimary()
    while (true) {
      if (isPunct(".")) {
        next()
        if (isPunct("#")) fail("unsupported", ["private-name"])
        expr = { ...start, kind: "Member", object: expr, property: propertyName(), optional: false }
      } else if (isPunct("?.")) {
        next()
        if (isPunct("(")) {
          if (!allowCalls) break
          expr = { ...start, kind: "Call", callee: expr, args: parseArguments(), optional: true, typeArgs: [] }
        } else if (isPunct("[")) {
          next()
          const index = parseExpression()
          expect("]")
          expr = { ...start, kind: "Index", object: expr, index, optional: true }
        } else {
          expr = { ...start, kind: "Member", object: expr, property: propertyName(), optional: true }
        }
      } else if (isPunct("[") && !peek().newlineBefore) {
        next()
        const index = parseExpression()
        expect("]")
        expr = { ...start, kind: "Index", object: expr, index, optional: false }
      } else if (isPunct("(") && allowCalls) {
        expr = { ...start, kind: "Call", callee: expr, args: parseArguments(), optional: false, typeArgs: [] }
      } else if (isPunct("<") && allowCalls && !peek().newlineBefore) {
        // f<T>(x) — вызов с параметрами типа, если после «>» идёт «(»; иначе это сравнение.
        const typeArgs = attempt(() => {
          const args = parseTypeArguments()
          if (!isPunct("(")) fail("expected-token", ["(", describe(peek())])
          return args
        })
        if (typeArgs === undefined) break
        expr = { ...start, kind: "Call", callee: expr, args: parseArguments(), optional: false, typeArgs }
      } else if (isPunct("!") && !peek().newlineBefore && !isPunct("=", 1)) {
        // Утверждение «не null» — без эффекта.
        next()
      } else if ((peek().kind === "template" || peek().kind === "template-head") && expr.kind !== "Template") {
        fail("unsupported", ["tagged-template"])
      } else {
        break
      }
    }
    return expr
  }

  function parseNew(): A.Expr {
    const start = loc()
    expect("new")
    if (isPunct(".")) fail("unsupported", ["new.target"])
    const callee = is("new") ? parseNew() : parseMemberOnly()
    const typeArgs = isPunct("<") ? parseTypeArguments() : []
    const args = isPunct("(") ? parseArguments() : []
    return { ...start, kind: "New", callee, args, typeArgs }
  }

  /** Выражение после new: имя с обращениями через точку, без вызовов. */
  function parseMemberOnly(): A.Expr {
    const start = loc()
    let expr = parsePrimary()
    while (isPunct(".")) {
      next()
      expr = { ...start, kind: "Member", object: expr, property: propertyName(), optional: false }
    }
    return expr
  }

  function parseTemplate(): A.Expr {
    const start = loc()
    const first = next()
    if (first.kind === "template") return { ...start, kind: "Template", quasis: [first.value], expressions: [] }
    const quasis = [first.value]
    const expressions: A.Expr[] = []
    while (true) {
      expressions.push(parseExpression())
      const part = peek()
      if (part.kind === "template-middle") {
        next()
        quasis.push(part.value)
      } else if (part.kind === "template-tail") {
        next()
        quasis.push(part.value)
        break
      } else {
        fail("expected-token", ["}", describe(part)])
      }
    }
    return { ...start, kind: "Template", quasis, expressions }
  }

  function parseObjectLiteral(): A.Expr {
    const start = loc()
    expect("{")
    const members: A.ObjectMember[] = []
    while (!isPunct("}")) {
      const memberStart = loc()
      if (eat("...")) {
        members.push({ ...memberStart, kind: "Spread", argument: parseAssignment() })
      } else if (isPunct("[")) {
        next()
        const computed = parseAssignment()
        expect("]")
        expect(":")
        members.push({ ...memberStart, kind: "Property", key: "", computed, value: parseAssignment(), shorthand: false })
      } else {
        if ((is("get") || is("set")) && !isPunct(":", 1) && !isPunct("(", 1) && !isPunct(",", 1) && !isPunct("}", 1)) {
          fail("unsupported", ["accessor-in-object"])
        }
        if (is("async") && !isPunct(":", 1) && !isPunct("(", 1) && !isPunct(",", 1)) fail("unsupported", ["async"])
        const keyToken = peek()
        const key =
          keyToken.kind === "string"
            ? next().value
            : keyToken.kind === "number"
              ? tostring(next().number)
              : propertyName()
        if (isPunct("(") || isPunct("<")) {
          // Метод объекта: m(a) { … }
          const fn = parseFunctionRest(memberStart, key)
          members.push({ ...memberStart, kind: "Property", key, value: { ...memberStart, kind: "Function", fn }, shorthand: false })
        } else if (eat(":")) {
          members.push({ ...memberStart, kind: "Property", key, value: parseAssignment(), shorthand: false })
        } else {
          if (keyToken.kind !== "identifier") fail("expected-token", [":", describe(peek())])
          // { a } или { a = 1 } (только в деструктуризации)
          let value: A.Expr = { ...memberStart, kind: "Identifier", name: key }
          if (isPunct("=")) {
            next()
            value = { ...memberStart, kind: "Assign", operator: "=", target: { ...memberStart, kind: "IdentifierPattern", name: key }, value: parseAssignment() }
          }
          members.push({ ...memberStart, kind: "Property", key, value, shorthand: true })
        }
      }
      if (!eat(",")) break
    }
    expect("}")
    return { ...start, kind: "Object", members }
  }

  function parsePrimary(): A.Expr {
    const start = loc()
    const token = peek()
    switch (token.kind) {
      case "number":
        next()
        return { ...start, kind: "Number", value: token.number! }
      case "string":
        next()
        return { ...start, kind: "String", value: token.value }
      case "template":
      case "template-head":
        return parseTemplate()
      case "identifier":
        if (token.value === "async" && is("function", 1)) fail("unsupported", ["async"])
        return { ...start, kind: "Identifier", name: identifierName() }
      case "keyword":
        switch (token.value) {
          case "true":
          case "false":
            next()
            return { ...start, kind: "Boolean", value: token.value === "true" }
          case "null":
            next()
            return { ...start, kind: "Null" }
          case "this":
            next()
            return { ...start, kind: "This" }
          case "super":
            next()
            return { ...start, kind: "Super" }
          case "function":
            next()
            return { ...start, kind: "Function", fn: parseFunctionRest(start, peek().kind === "identifier" ? identifierName() : undefined) }
          case "class":
            return { ...start, kind: "Class", cls: parseClass(start, false, false) }
        }
        break
      case "punctuator":
        if (token.value === "(") {
          next()
          const inner = parseExpression()
          expect(")")
          return inner
        }
        if (token.value === "[") {
          next()
          const elements: (A.Expr | A.Spread)[] = []
          while (!isPunct("]")) {
            const elementStart = loc()
            if (isPunct(",")) fail("unsupported", ["array-hole"])
            if (eat("...")) elements.push({ ...elementStart, kind: "Spread", argument: parseAssignment() })
            else elements.push(parseAssignment())
            if (!eat(",")) break
          }
          expect("]")
          return { ...start, kind: "Array", elements }
        }
        if (token.value === "{") return parseObjectLiteral()
        if (token.value === "/" || token.value === "/=") fail("unsupported", ["regex"])
        break
    }
    fail("unexpected-token", [describe(token)])
  }

  // ---------- Инструкции ----------

  function parseVarDecl(requireInit: boolean): A.VarDecl {
    const start = loc()
    const declKind = next().value as "let" | "const"
    const declarations: A.VarDeclarator[] = []
    do {
      const declStart = loc()
      const target = parseBindingPattern()
      eat("!")
      const type = eat(":") ? parseType() : undefined
      const init = eat("=") ? parseAssignment() : undefined
      if (init === undefined && requireInit && (declKind === "const" || target.kind !== "IdentifierPattern")) {
        report("missing-initializer", [], peek())
      }
      declarations.push({ ...declStart, target, type, init })
    } while (eat(","))
    return { ...start, kind: "VarDecl", declKind, declarations }
  }

  function isVarDeclStart(): boolean {
    if (is("const") && !is("enum", 1)) return true
    // let — контекстное слово: объявление, если дальше имя, { или [.
    return is("let") && peek().kind === "identifier" && (peek(1).kind === "identifier" || isPunct("{", 1) || isPunct("[", 1))
  }

  function parseBlockBody(): A.Stmt[] {
    expect("{")
    const body = parseStatementsUntil("}")
    expect("}")
    return body
  }

  function parseFor(): A.Stmt {
    const start = loc()
    expect("for")
    if (is("await")) fail("unsupported", ["async"])
    expect("(")
    let init: A.VarDecl | A.Expr | undefined
    if (isVarDeclStart()) {
      const decl = parseVarDecl(false)
      if (is("of") && decl.declarations.length === 1 && decl.declarations[0].init === undefined) {
        next()
        const iterable = parseAssignment()
        expect(")")
        return { ...start, kind: "ForOf", declKind: decl.declKind, target: decl.declarations[0].target, iterable, body: parseStatement() }
      }
      if (is("in")) fail("unsupported", ["for-in"])
      init = decl
    } else if (!isPunct(";")) {
      const expr = parseExpression()
      if (is("of")) {
        next()
        const iterable = parseAssignment()
        expect(")")
        return { ...start, kind: "ForOf", target: assignmentPattern(expr), iterable, body: parseStatement() }
      }
      init = expr
    }
    if (is("in")) fail("unsupported", ["for-in"])
    expect(";")
    const test = isPunct(";") ? undefined : parseExpression()
    expect(";")
    const update = isPunct(")") ? undefined : parseExpression()
    expect(")")
    return { ...start, kind: "For", init, test, update, body: parseStatement() }
  }

  function parseSwitch(): A.Stmt {
    const start = loc()
    expect("switch")
    expect("(")
    const discriminant = parseExpression()
    expect(")")
    expect("{")
    const cases: A.SwitchCase[] = []
    while (!isPunct("}")) {
      const caseStart = loc()
      let test: A.Expr | undefined
      if (eat("case")) test = parseExpression()
      else expect("default")
      expect(":")
      const body: A.Stmt[] = []
      while (!is("case") && !is("default") && !isPunct("}") && peek().kind !== "eof") body.push(parseStatement())
      cases.push({ ...caseStart, test, body })
    }
    expect("}")
    return { ...start, kind: "Switch", discriminant, cases }
  }

  function parseTry(): A.Stmt {
    const start = loc()
    expect("try")
    const block = parseBlockBody()
    let param: A.Pattern | undefined
    let handler: A.Stmt[] | undefined
    let finalizer: A.Stmt[] | undefined
    if (eat("catch")) {
      if (eat("(")) {
        param = parseBindingPattern()
        if (eat(":")) parseType()
        expect(")")
      }
      handler = parseBlockBody()
    }
    if (eat("finally")) finalizer = parseBlockBody()
    if (handler === undefined && finalizer === undefined) fail("expected-token", ["catch", describe(peek())])
    return { ...start, kind: "Try", block, param, handler, finalizer }
  }

  /** Метка для break/continue: только на одной строке с ключевым словом. */
  function optionalLabel(): string | undefined {
    if (peek().kind === "identifier" && !peek().newlineBefore) return identifierName()
    return undefined
  }

  /** declare function / const / class — только в режиме объявлений. */
  function parseDeclaration(start: A.Loc): A.Stmt {
    next()
    if (eat("function")) {
      const name = identifierName()
      const typeParams = parseTypeParamDecls()
      const params = parseFunctionTypeParams()
      const result = eat(":") ? parseType() : { ...loc(), kind: "KeywordType" as const, name: "void" }
      consumeSemicolon()
      return { ...start, kind: "DeclareFunction", name, type: { ...start, kind: "FunctionType", params, result, typeParams } }
    }
    if (eat("const") || eat("let")) {
      const name = identifierName()
      expect(":")
      const type = parseType()
      consumeSemicolon()
      return { ...start, kind: "DeclareVar", name, type }
    }
    if (eat("class")) {
      const name = identifierName()
      const typeParams = parseTypeParamDecls()
      const superClass = eat("extends") ? identifierName() : undefined
      const members = parseObjectType()
      return { ...start, kind: "DeclareClass", name, typeParams, superClass, members }
    }
    return fail("unsupported", ["declare"])
  }

  function parseStatement(): A.Stmt {
    return nested(parseStatementInner)
  }

  function parseStatementInner(): A.Stmt {
    const start = loc()
    const token = peek()
    if (isPunct("{")) return { ...start, kind: "Block", body: parseBlockBody() }
    if (eat(";")) return { ...start, kind: "Empty" }
    if (isVarDeclStart()) {
      const decl = parseVarDecl(true)
      consumeSemicolon()
      return decl
    }
    if (token.kind === "keyword" && (token.value === "import" || token.value === "export")) {
      if (token.value === "import" && (isPunct("(", 1) || isPunct(".", 1))) fail("unsupported", ["dynamic-import"])
      // depth 1 — инструкция верхнего уровня (parseStatement уже вошёл в nested).
      if (depth !== 1 || options.declarations) {
        // Разобрать целиком (одна понятная ошибка вместо лавины), но не учитывать.
        report("unsupported", ["import-nested"], token)
        const [importCount, exportCount] = [imports.length, exports.length]
        const stmt = token.value === "import" ? parseImport(start) : parseExport(start)
        imports.splice(importCount)
        exports.splice(exportCount)
        return stmt
      }
      return token.value === "import" ? parseImport(start) : parseExport(start)
    }
    const unsupported = UNSUPPORTED_STATEMENTS[token.value]
    if (unsupported !== undefined && (token.kind === "keyword" || (token.kind === "identifier" && peek(1).kind === "identifier"))) {
      fail("unsupported", [unsupported])
    }
    if (token.kind === "identifier") {
      if (token.value === "interface" && peek(1).kind === "identifier") {
        next()
        const name = identifierName()
        const typeParams = parseTypeParamDecls()
        const parents: A.TypeNode[] = []
        if (eat("extends")) {
          do parents.push(parseType())
          while (eat(","))
        }
        const members = parseObjectType()
        return { ...start, kind: "TypeDecl", name, typeParams, members, extends: parents }
      }
      if (token.value === "type" && peek(1).kind === "identifier" && (isPunct("=", 2) || isPunct("<", 2))) {
        next()
        const name = identifierName()
        const typeParams = parseTypeParamDecls()
        expect("=")
        const alias = parseType()
        consumeSemicolon()
        return { ...start, kind: "TypeDecl", name, typeParams, alias }
      }
      if (options.declarations && token.value === "declare") return parseDeclaration(start)
      if (token.value === "abstract" && is("class", 1)) {
        next()
        return { ...start, kind: "ClassDecl", cls: parseClass(start, true, true) }
      }
      if (token.value === "async" && is("function", 1)) fail("unsupported", ["async"])
      if (isPunct(":", 1)) {
        const label = identifierName()
        next()
        const body = parseStatement()
        if (body.kind !== "For" && body.kind !== "ForOf" && body.kind !== "While" && body.kind !== "DoWhile") {
          report("unsupported", ["label-not-loop"], token)
        }
        return { ...start, kind: "Labeled", label, body }
      }
    }
    if (token.kind === "keyword") {
      switch (token.value) {
        case "function": {
          next()
          if (peek().kind !== "identifier") fail("expected-identifier", [describe(peek())])
          return { ...start, kind: "FunctionDecl", fn: parseFunctionRest(start, identifierName()) }
        }
        case "class":
          return { ...start, kind: "ClassDecl", cls: parseClass(start, false, true) }
        case "if": {
          next()
          expect("(")
          const test = parseExpression()
          expect(")")
          const consequent = parseStatement()
          const alternate = eat("else") ? parseStatement() : undefined
          return { ...start, kind: "If", test, consequent, alternate }
        }
        case "while": {
          next()
          expect("(")
          const test = parseExpression()
          expect(")")
          return { ...start, kind: "While", test, body: parseStatement() }
        }
        case "do": {
          next()
          const body = parseStatement()
          expect("while")
          expect("(")
          const test = parseExpression()
          expect(")")
          eat(";")
          return { ...start, kind: "DoWhile", body, test }
        }
        case "for":
          return parseFor()
        case "break":
        case "continue": {
          next()
          const label = optionalLabel()
          consumeSemicolon()
          return { ...start, kind: token.value === "break" ? "Break" : "Continue", label }
        }
        case "return": {
          next()
          const value = isPunct(";") || isPunct("}") || peek().kind === "eof" || peek().newlineBefore ? undefined : parseExpression()
          consumeSemicolon()
          return { ...start, kind: "Return", value }
        }
        case "throw": {
          next()
          if (peek().newlineBefore) fail("unexpected-token", ["перевод строки"])
          const value = parseExpression()
          consumeSemicolon()
          return { ...start, kind: "Throw", value }
        }
        case "try":
          return parseTry()
        case "switch":
          return parseSwitch()
      }
    }
    const expression = parseExpression()
    consumeSemicolon()
    return { ...start, kind: "ExprStmt", expression }
  }

  // ---------- Модули ----------

  const imports: A.ImportDecl[] = []
  const exports: A.ExportDecl[] = []

  /** Путь модуля: строка после from. */
  function moduleSource(): string {
    const token = peek()
    if (token.kind !== "string") fail("expected-token", ["\"./модуль\"", describe(token)])
    next()
    return token.value
  }

  /** Имя в списке { … }: любое слово (в том числе default). */
  function moduleName(): string {
    return propertyName()
  }

  /** { a, b as c, type T } — для import (imported → local) и export (local → exported). */
  function specList(): { first: string; second: string; typeOnly: boolean; at: A.Loc }[] {
    expect("{")
    const list: { first: string; second: string; typeOnly: boolean; at: A.Loc }[] = []
    while (!isPunct("}")) {
      const at = loc()
      // { type T } — но { type } и { type as x } — имя «type».
      const typeOnly = is("type") && !isPunct(",", 1) && !isPunct("}", 1) && !is("as", 1)
      if (typeOnly) next()
      const first = moduleName()
      const second = eat("as") ? moduleName() : first
      list.push({ first, second, typeOnly, at })
      if (!eat(",")) break
    }
    expect("}")
    return list
  }

  function parseImport(start: A.Loc): A.Stmt {
    expect("import")
    const decl: A.ImportDecl = { ...start, source: "", specs: [], typeOnly: false }
    if (peek().kind === "string") {
      // import "./x" — только исполнить модуль.
      decl.source = moduleSource()
      consumeSemicolon()
      imports.push(decl)
      return { ...start, kind: "Empty" }
    }
    if (is("type") && (isPunct("{", 1) || isPunct("*", 1) || (peek(1).kind === "identifier" && !is("from", 1)))) {
      next()
      decl.typeOnly = true
    }
    if (peek().kind === "identifier" && !isPunct("=", 1)) {
      const at = loc()
      const local = identifierName()
      decl.specs.push({ ...at, imported: "default", local, typeOnly: decl.typeOnly })
      if (!eat(",")) {
        expect("from")
        decl.source = moduleSource()
        consumeSemicolon()
        imports.push(decl)
        return { ...start, kind: "Empty" }
      }
    } else if (peek().kind === "identifier") {
      fail("unsupported", ["import-require"])
    }
    if (eat("*")) {
      expect("as")
      decl.namespace = identifierName()
    } else {
      for (const spec of specList()) {
        if (spec.second.startsWith("__")) report("reserved-name", [spec.second])
        decl.specs.push({ ...spec.at, imported: spec.first, local: spec.second, typeOnly: decl.typeOnly || spec.typeOnly })
      }
    }
    expect("from")
    decl.source = moduleSource()
    consumeSemicolon()
    imports.push(decl)
    return { ...start, kind: "Empty" }
  }

  /** Имена, которые объявляет шаблон (export const { a, b } = …). */
  function patternNames(pattern: A.Pattern, out: string[]): string[] {
    if (pattern.kind === "IdentifierPattern") out.push(pattern.name)
    else if (pattern.kind === "ObjectPattern") {
      for (const prop of pattern.properties) patternNames(prop.value, out)
      if (pattern.rest !== undefined) out.push(pattern.rest)
    } else {
      for (const element of pattern.elements) if (element.value !== undefined) patternNames(element.value, out)
      if (pattern.rest !== undefined) patternNames(pattern.rest, out)
    }
    return out
  }

  function exportLocal(at: A.Loc, local: string, typeOnly: boolean, exported = local): void {
    exports.push({ ...at, specs: [{ ...at, local, exported, typeOnly }] })
  }

  function parseExport(start: A.Loc): A.Stmt {
    expect("export")
    if (isPunct("=")) fail("unsupported", ["export-assignment"])
    if (eat("default")) {
      if (is("function")) {
        next()
        const name = peek().kind === "identifier" ? identifierName() : "default"
        exportLocal(start, name, false, "default")
        return { ...start, kind: "FunctionDecl", fn: parseFunctionRest(start, name) }
      }
      if (is("class") || (is("abstract") && is("class", 1))) {
        const isAbstract = eat("abstract")
        const cls = parseClass(start, isAbstract, false)
        cls.name ??= "default"
        exportLocal(start, cls.name, false, "default")
        return { ...start, kind: "ClassDecl", cls }
      }
      if (is("async")) fail("unsupported", ["async"])
      // export default выражение — константа с именем default (такое имя в программе не напишешь).
      const value = parseAssignment()
      consumeSemicolon()
      exportLocal(start, "default", false)
      return { ...start, kind: "VarDecl", declKind: "const", declarations: [{ ...start, target: { ...start, kind: "IdentifierPattern", name: "default" }, init: value }] }
    }
    if (isPunct("*")) {
      next()
      if (is("as")) fail("unsupported", ["export-star-as"])
      expect("from")
      exports.push({ ...start, source: moduleSource(), all: true, specs: [] })
      consumeSemicolon()
      return { ...start, kind: "Empty" }
    }
    const typeList = is("type") && isPunct("{", 1)
    if (typeList) next()
    if (isPunct("{")) {
      const specs = specList()
      const source = eat("from") ? moduleSource() : undefined
      consumeSemicolon()
      exports.push({
        ...start,
        source,
        specs: specs.map((spec) => ({ ...spec.at, local: spec.first, exported: spec.second, typeOnly: typeList || spec.typeOnly })),
      })
      return { ...start, kind: "Empty" }
    }
    const stmt = parseStatementInner()
    switch (stmt.kind) {
      case "VarDecl":
        for (const decl of stmt.declarations) for (const name of patternNames(decl.target, [])) exportLocal(decl, name, false)
        break
      case "FunctionDecl":
        exportLocal(stmt, stmt.fn.name!, false)
        break
      case "ClassDecl":
        exportLocal(stmt, stmt.cls.name!, false)
        break
      case "TypeDecl":
        exportLocal(stmt, stmt.name, true)
        break
      default:
        report("unexpected-token", ["export"], tokens[math.max(0, pos - 1)])
    }
    return stmt
  }

  /** Пропустить токены до границы инструкции после ошибки. */
  function synchronize(): void {
    while (peek().kind !== "eof") {
      if (eat(";")) return
      if (isPunct("}")) return
      next()
      const token = peek()
      if (token.newlineBefore && (token.kind === "keyword" || is("let") || is("interface") || is("type"))) return
    }
  }

  function parseStatementsUntil(end: string): A.Stmt[] {
    const body: A.Stmt[] = []
    while (peek().kind !== "eof" && !isPunct(end)) {
      const before = pos
      try {
        body.push(parseStatement())
      } catch (error) {
        if (error !== FAILURE) throw error
        synchronize()
        if (pos === before) next()
      }
    }
    return body
  }

  const body = parseStatementsUntil("")
  return { program: { body, imports, exports }, diagnostics }
}
