// Встроенные имена языка программ: API машины (docs/API.md) и стандартная библиотека.
// Компилятору нужно знать имя, вид и блокирует ли вызов (ждёт действия → функция возобновляемая).

export type BuiltinKind =
  /** Функция API: move, print… */
  | "host-function"
  /** Объект API: me, scan, map, board, tasks… */
  | "host-object"
  /** Объект стандартной библиотеки: Math, Object, Array, JSON… */
  | "library-object"
  /** Класс стандартной библиотеки или API: Map, Set, Error, ActionError. */
  | "library-class"
  /** Функция стандартной библиотеки: parseInt, isNaN… */
  | "library-function"
  /** Значение: undefined, NaN, Infinity. */
  | "value"

export interface Builtin {
  name: string
  kind: BuiltinKind
  /** Вызов ждёт действия игры (или сообщения) — пауза программы. */
  blocking?: boolean
}

const HOST_FUNCTIONS: Record<string, boolean> = {
  // Вывод
  print: false,
  say: false,
  chat: false,
  alert: false,
  // Движение и действия
  move: true,
  canReach: true,
  follow: true,
  goHome: true,
  mine: true,
  take: true,
  put: true,
  pickup: true,
  drop: true,
  give: true,
  repair: true,
  setRecipe: true,
  build: true,
  deconstruct: true,
  rotate: true,
  pump: true,
  fill: true,
  drain: true,
  refuel: true,
  charge: true,
  attack: true,
  guard: true,
  patrol: true,
  reload: true,
  // Карта
  marker: false,
  zone: false,
  find: false,
  // Связь
  send: false,
  broadcast: false,
  subscribe: false,
  unsubscribe: false,
  receive: true,
  tryReceive: false,
  request: true,
  robot: false,
  display: false,
  // Время
  wait: true,
  waitUntil: true,
  exit: false,
  restart: false,
}

/** Методы объектов API, которые ждут: tasks.next(…). */
export const BLOCKING_HOST_METHODS: Record<string, Record<string, boolean>> = {
  tasks: { next: true },
}

const HOST_OBJECTS = ["me", "console", "scan", "map", "board", "tasks", "signals", "time", "world", "inbox"]
const LIBRARY_OBJECTS = ["Math", "Object", "Array", "JSON", "Number", "String"]
const LIBRARY_CLASSES = ["Map", "Set", "Error", "TypeError", "RangeError", "SyntaxError", "ActionError"]
const LIBRARY_FUNCTIONS = ["parseInt", "parseFloat", "isNaN", "isFinite", "Boolean"]
const VALUES = ["undefined", "NaN", "Infinity"]

export const BUILTINS = new Map<string, Builtin>()
for (const [name, blocking] of Object.entries(HOST_FUNCTIONS)) BUILTINS.set(name, { name, kind: "host-function", blocking })
for (const name of HOST_OBJECTS) BUILTINS.set(name, { name, kind: "host-object" })
for (const name of LIBRARY_OBJECTS) BUILTINS.set(name, { name, kind: "library-object" })
for (const name of LIBRARY_CLASSES) BUILTINS.set(name, { name, kind: "library-class" })
for (const name of LIBRARY_FUNCTIONS) BUILTINS.set(name, { name, kind: "library-function" })
for (const name of VALUES) BUILTINS.set(name, { name, kind: "value" })

/**
 * Методы массивов и коллекций, принимающие функцию: если переданная функция возобновляемая,
 * вызов метода — точка остановки (рантайм использует возобновляемую версию метода).
 */
export const HIGHER_ORDER_METHODS = new Set(["forEach", "map", "filter", "find", "findIndex", "some", "every", "reduce", "flatMap"])

/** Методы массивов рантайма (src/lang/runtime/arrays.ts): у известных массивов вызываются напрямую. */
export const ARRAY_METHODS = new Set([
  "push", "pop", "shift", "unshift", "slice", "splice", "concat", "join", "toString", "reverse", "indexOf", "lastIndexOf",
  "includes", "fill", "at", "flat", "sort", "forEach", "map", "filter", "find", "findIndex", "findLast", "findLastIndex",
  "some", "every", "reduce", "reduceRight", "flatMap",
])

/** Методы объектов стандартной библиотеки (проверяются при компиляции). */
export const LIBRARY_METHODS: Record<string, string[]> = {
  Math: [
    "abs", "floor", "ceil", "round", "trunc", "sign", "min", "max", "sqrt", "cbrt", "pow", "exp", "log", "log2", "log10",
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "hypot", "random",
  ],
  Object: ["keys", "values", "entries", "assign", "fromEntries", "freeze"],
  Array: ["isArray", "from", "of"],
  JSON: ["stringify", "parse"],
  Number: ["isInteger", "isFinite", "isNaN", "parseInt", "parseFloat"],
  String: ["fromCharCode"],
}

/** Объекты библиотеки, которые ещё и функции: String(x), Number(x). */
export const CALLABLE_LIBRARY_OBJECTS = new Set(["String", "Number"])

/** Константы стандартной библиотеки: подставляются при компиляции. */
export const LIBRARY_CONSTANTS: Record<string, Record<string, number>> = {
  Math: { PI: math.pi, E: math.exp(1), SQRT2: math.sqrt(2), LN2: math.log(2), LN10: math.log(10) },
  Number: {
    MAX_SAFE_INTEGER: 9007199254740991,
    MIN_SAFE_INTEGER: -9007199254740991,
    EPSILON: 2 ** -52,
    MAX_VALUE: 1.7976931348623157e308,
    POSITIVE_INFINITY: math.huge,
    NEGATIVE_INFINITY: -math.huge,
  },
}
