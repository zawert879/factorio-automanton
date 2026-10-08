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
const LIBRARY_CLASSES = ["Map", "Set", "Error", "ActionError"]
const LIBRARY_FUNCTIONS = ["parseInt", "parseFloat", "isNaN", "isFinite"]
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
