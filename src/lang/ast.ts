// Синтаксическое дерево языка программ. Каждый узел помнит строку и столбец — для ошибок компиляции
// и таблицы соответствия строк Lua → TypeScript.

export interface Loc {
  line: number
  column: number
}

// ---------- Типы (проверка — src/lang/check.ts) ----------

export type TypeNode = Loc &
  (
    | { kind: "TypeRef"; name: string; args: TypeNode[] }
    | { kind: "KeywordType"; name: string }
    | { kind: "LiteralType"; value: string | number | boolean }
    | { kind: "ArrayType"; element: TypeNode }
    | { kind: "TupleType"; elements: TypeNode[] }
    | { kind: "UnionType"; types: TypeNode[] }
    | { kind: "IntersectionType"; types: TypeNode[] }
    | { kind: "FunctionType"; params: TypeParam[]; result: TypeNode; typeParams?: TypeParamDecl[] }
    | { kind: "ObjectType"; members: TypeMember[] }
    | { kind: "TypeofType"; name: string }
    | { kind: "KeyofType"; type: TypeNode }
    | { kind: "IndexedType"; object: TypeNode; index: TypeNode }
  )

/** Параметр типа в объявлении: <T extends Constraint = Default>. */
export interface TypeParamDecl {
  name: string
  constraint?: TypeNode
  default?: TypeNode
}

export interface TypeParam {
  name: string
  optional: boolean
  rest: boolean
  type?: TypeNode
}

export interface TypeMember {
  name: string
  optional: boolean
  readonly: boolean
  /** Метод в описании типа: m(a: T): R. */
  method: boolean
  type?: TypeNode
}

// ---------- Выражения ----------

export interface Spread extends Loc {
  kind: "Spread"
  argument: Expr
}

export type ObjectMember =
  | (Loc & { kind: "Property"; key: string; computed?: Expr; value: Expr; shorthand: boolean })
  | Spread

export type Expr = Loc & {
  /** x as T — тип приведения (для проверки типов; на код не влияет). */
  asType?: TypeNode
} & (
    | { kind: "Number"; value: number }
    | { kind: "String"; value: string }
    | { kind: "Template"; quasis: string[]; expressions: Expr[] }
    | { kind: "Boolean"; value: boolean }
    | { kind: "Null" }
    | { kind: "Identifier"; name: string }
    | { kind: "This" }
    | { kind: "Super" }
    | { kind: "Array"; elements: (Expr | Spread)[] }
    | { kind: "Object"; members: ObjectMember[] }
    | { kind: "Function"; fn: FunctionNode }
    | { kind: "Class"; cls: ClassNode }
    | { kind: "Unary"; operator: string; argument: Expr }
    | { kind: "Update"; operator: "++" | "--"; prefix: boolean; target: Expr }
    | { kind: "Binary"; operator: string; left: Expr; right: Expr }
    | { kind: "Logical"; operator: "&&" | "||" | "??"; left: Expr; right: Expr }
    | { kind: "Assign"; operator: string; target: Pattern | Expr; value: Expr }
    | { kind: "Conditional"; test: Expr; consequent: Expr; alternate: Expr }
    | { kind: "Call"; callee: Expr; args: (Expr | Spread)[]; optional: boolean; typeArgs: TypeNode[] }
    | { kind: "New"; callee: Expr; args: (Expr | Spread)[]; typeArgs: TypeNode[] }
    | { kind: "Member"; object: Expr; property: string; optional: boolean }
    | { kind: "Index"; object: Expr; index: Expr; optional: boolean }
    | { kind: "Sequence"; expressions: Expr[] }
  )

// ---------- Шаблоны деструктуризации ----------

export type Pattern = Loc &
  (
    | { kind: "IdentifierPattern"; name: string }
    | { kind: "ObjectPattern"; properties: { key: string; value: Pattern; default?: Expr }[]; rest?: string }
    /** Пропуск ([a, , b]) — элемент без value: в массивах Lua нельзя хранить nil. */
    | { kind: "ArrayPattern"; elements: { value?: Pattern; default?: Expr }[]; rest?: Pattern }
  )

// ---------- Функции и классы ----------

export interface Param extends Loc {
  target: Pattern
  default?: Expr
  rest: boolean
  type?: TypeNode
  optional: boolean
  /** Параметр-свойство конструктора: constructor(readonly ore: Item). */
  property: boolean
}

export interface FunctionNode extends Loc {
  name?: string
  params: Param[]
  /** Тело: инструкции; у стрелочной функции с выражением — одно выражение. */
  body: Stmt[] | Expr
  arrow: boolean
  returnType?: TypeNode
  typeParams: string[]
}

export type ClassMember = Loc &
  (
    | { kind: "Field"; name: string; isStatic: boolean; value?: Expr; type?: TypeNode; optional: boolean }
    | { kind: "Method"; name: string; isStatic: boolean; fn: FunctionNode; accessor: "method" | "get" | "set" }
    | { kind: "Constructor"; fn: FunctionNode }
    | { kind: "AbstractMethod"; name: string }
  )

export interface ClassNode extends Loc {
  name?: string
  superClass?: Expr
  isAbstract: boolean
  members: ClassMember[]
  typeParams: string[]
}

// ---------- Инструкции ----------

export interface VarDeclarator extends Loc {
  target: Pattern
  type?: TypeNode
  init?: Expr
}

export interface VarDecl extends Loc {
  kind: "VarDecl"
  declKind: "let" | "const"
  declarations: VarDeclarator[]
}

export interface SwitchCase extends Loc {
  test?: Expr
  body: Stmt[]
}

export type Stmt = Loc &
  (
    | VarDecl
    | { kind: "FunctionDecl"; fn: FunctionNode }
    | { kind: "ClassDecl"; cls: ClassNode }
    /** interface и type: кода не дают, нужны проверке типов. */
    | {
        kind: "TypeDecl"
        name: string
        typeParams: TypeParamDecl[]
        /** interface: члены и предки; type: псевдоним. */
        members?: TypeMember[]
        extends?: TypeNode[]
        alias?: TypeNode
      }
    /** Объявления (только в режиме declarations — automaton.d.ts и описание библиотеки). */
    | { kind: "DeclareFunction"; name: string; type: TypeNode }
    | { kind: "DeclareVar"; name: string; type: TypeNode }
    | { kind: "DeclareClass"; name: string; typeParams: TypeParamDecl[]; superClass?: string; members: TypeMember[] }
    | { kind: "ExprStmt"; expression: Expr }
    | { kind: "If"; test: Expr; consequent: Stmt; alternate?: Stmt }
    | { kind: "While"; test: Expr; body: Stmt }
    | { kind: "DoWhile"; body: Stmt; test: Expr }
    | { kind: "For"; init?: VarDecl | Expr; test?: Expr; update?: Expr; body: Stmt }
    | { kind: "ForOf"; declKind?: "let" | "const"; target: Pattern; iterable: Expr; body: Stmt }
    | { kind: "Break"; label?: string }
    | { kind: "Continue"; label?: string }
    | { kind: "Return"; value?: Expr }
    | { kind: "Throw"; value: Expr }
    | { kind: "Try"; block: Stmt[]; param?: Pattern; handler?: Stmt[]; finalizer?: Stmt[] }
    | { kind: "Switch"; discriminant: Expr; cases: SwitchCase[] }
    | { kind: "Block"; body: Stmt[] }
    | { kind: "Labeled"; label: string; body: Stmt }
    | { kind: "Empty" }
  )

// ---------- Модули ----------

/** import { imported as local }; import local from — imported "default". */
export interface ImportSpec extends Loc {
  imported: string
  local: string
  typeOnly: boolean
}

export interface ImportDecl extends Loc {
  /** Путь как написан: "./Помощники". */
  source: string
  specs: ImportSpec[]
  /** import * as namespace. */
  namespace?: string
  /** import type { … }: только типы. */
  typeOnly: boolean
}

/** export { local as exported }; у реэкспорта (from) local — имя в исходном модуле. */
export interface ExportSpec extends Loc {
  local: string
  exported: string
  typeOnly: boolean
}

export interface ExportDecl extends Loc {
  /** Реэкспорт из другого модуля: export { a } from "./x", export * from "./x". */
  source?: string
  /** export * from — всё, кроме default. */
  all?: boolean
  specs: ExportSpec[]
}

export interface Program {
  body: Stmt[]
  /** import (исполняются до тела, как в ES-модулях; в body их нет). */
  imports?: ImportDecl[]
  /** export: объявления остаются в body, сюда — что и под каким именем экспортируется. */
  exports?: ExportDecl[]
}
