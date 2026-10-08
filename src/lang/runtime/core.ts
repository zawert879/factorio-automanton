// Ядро рантайма программ: состояние исполнения, лимиты, ошибки, встроенные классы, реестры API.
//
// Значения программ (LANGUAGE.md, «Представление в Lua»): числа, строки, логические, nil,
// массивы {__n = длина, [1..n]}, объекты (таблицы со строковыми ключами), экземпляры {__cls = класс},
// классы {__k, __name, __s, __m, __g, __ctor}, функции {__f, __e}, Map/Set {__t = "Map"/"Set"},
// объекты API {__t = "host", __h = имя}. Служебные ключи начинаются с __ — программе они недоступны.

export type Val = any
export type Fn = (this: void, ...args: any[]) => any

/** Маркер паузы — первое возвращаемое значение. Программа получить его не может. */
export const Y: Val = { pause: true }
/** Коды завершения тела try: return и break/continue. */
export const RET = 1
export const BRK = 2

/** Состояние исполнения текущей машины (машины исполняются по одной). */
export const Q = {
  /** Выделено единиц памяти за отрезок (сбрасывается в начале отрезка). */
  a: 0,
  /** Предел выделений на отрезок. */
  am: math.huge,
  /** Сколько можно уйти в минус по кванту в синхронном вызове, прежде чем остановить его. */
  hard: -10000,
  /** Кадр ожидания блокирующего вызова API, начатого в этом отрезке (его завершит игра). */
  w: undefined as Val,
}

export const LIMITS = {
  /** Длина строки, байт. */
  string: 100000,
  /** Глубина вызовов. */
  depth: 200,
  /** Длина массива. */
  array: 100000,
  /** Единиц памяти за отрезок исполнения. */
  allocations: 200000,
  /** Живых единиц памяти у программы (таблица — 1, элемент — 1/8, 256 байт строк — 1). */
  memory: 20000,
  /** Вложенность структур в JSON и строковом представлении. */
  nesting: 100,
}

/** Экспорт скомпилированной программы (src/lang/prologue.ts, EPILOGUE). */
/** Вызов по протоколу пауз: значение или Y, кадр. */
export type ResumableFn = (this: void, ...args: any[]) => LuaMultiReturn<[Val, Val?]>

export interface ProgramExports {
  P: Val
  /** Счётчики кванта, глубины и синхронных вызовов — upvalue пролога (быстрее полей таблицы). */
  setBudget: (this: void, quantum: number) => void
  budget: (this: void) => number
  charge: (this: void, n: number) => number
  sync: (this: void) => number
  /** CALL(значение-функция, k, this, ...аргументы). */
  call: ResumableFn
  /** CALLS(значение-функция, this, ...аргументы): синхронно, до конца. */
  calls: Fn
  callm: ResumableFn
  callms: Fn
  new: ResumableFn
}

let current: ProgramExports | undefined

export function enter(this: void, program: ProgramExports): void {
  current = program
}

export function program(this: void): ProgramExports {
  return current!
}

/** Израсходовать n инструкций кванта текущей программы; результат — остаток. */
export function spend(this: void, n: number): number {
  return current!.charge(n)
}

// ---------- Память ----------

export function memory(this: void): never {
  err("memory")
}

/** Учёт выделения: units — единицы памяти (таблица — 1, элемент массива — 1/8). */
export function charge(this: void, units: number): void {
  Q.a = Q.a + units
  if (Q.a > Q.am) memory()
}

export function newArray(this: void): Val {
  charge(1)
  return { __n: 0 }
}

// ---------- Встроенные классы и ошибки ----------

export const classes: Record<string, Val> = {}

function builtinClass(name: string, parent?: Val): Val {
  // __t: встроенные классы общие для всех программ — записывать в них нельзя (SET → ошибка).
  const cls = { __k: name, __builtin: name, __name: name, __s: parent, __m: {}, __g: {}, __t: "builtin" }
  classes[name] = cls
  return cls
}

builtinClass("Error")
builtinClass("TypeError", classes.Error)
builtinClass("RangeError", classes.Error)
builtinClass("SyntaxError", classes.Error)
builtinClass("ActionError", classes.Error)
builtinClass("Map")
builtinClass("Set")

export function makeError(this: void, className: string, message: string, code?: string): Val {
  charge(1)
  return { __cls: classes[className], name: className, message, code }
}

/** Ошибки рантайма: код → класс и текст (как в JavaScript, по-английски; игроку — перевод по коду). */
const ERRORS: Record<string, [string, string]> = {
  "callback-too-long": ["RangeError", "Callback ran too long without a pause"],
  "string-too-long": ["RangeError", "String is too long"],
  "array-too-long": ["RangeError", "Invalid array length"],
  "stack-overflow": ["RangeError", "Maximum call stack size exceeded"],
  memory: ["RangeError", "Too many objects created"],
  "not-a-function": ["TypeError", "{0} is not a function"],
  "not-a-constructor": ["TypeError", "{0} is not a constructor"],
  "not-a-class": ["TypeError", "Right-hand side of 'instanceof' is not a class"],
  "class-call": ["TypeError", "Class constructor {0} cannot be invoked without 'new'"],
  "read-property": ["TypeError", "Cannot read properties of {0} (reading '{1}')"],
  "set-property": ["TypeError", "Cannot set property '{1}' of {0}"],
  "no-method": ["TypeError", "{0}.{1} is not a function"],
  "reserved-key": ["TypeError", "Property names starting with __ are reserved"],
  add: ["TypeError", "Cannot add {0} and {1}"],
  "not-iterable": ["TypeError", "{0} is not iterable"],
  "in-operator": ["TypeError", "Cannot use 'in' operator to search for '{1}' in {0}"],
  "action-in-callback": ["TypeError", "Actions cannot be used in this callback"],
  arithmetic: ["TypeError", "Cannot use {0} in arithmetic"],
  compare: ["TypeError", "Cannot compare {0}"],
  "extends-not-class": ["TypeError", "Class extends value is not a class"],
  "bad-argument": ["TypeError", "Invalid argument: {0}"],
  "json-parse": ["SyntaxError", "JSON.parse: {0}"],
  "json-cycle": ["TypeError", "Converting circular structure to JSON"],
  "invalid-key": ["TypeError", "Invalid key: {0}"],
}

function fill(template: string, a: Val, b: Val): string {
  let result = template
  if (a !== undefined) result = result.replace("{0}", tostring(a))
  if (b !== undefined) result = result.replace("{1}", tostring(b))
  return result
}

export function err(this: void, code: string, a?: Val, b?: Val): never {
  const known = ERRORS[code]
  const error_ = makeError(known?.[0] ?? "Error", fill(known?.[1] ?? code, a, b), code)
  error(error_, 0)
}

/** Значение можно вызвать: функция программы, API или библиотеки. */
export function isCallable(this: void, x: Val): boolean {
  return type(x) === "table" && (x.__f !== undefined || x.__hf !== undefined || x.__lf !== undefined)
}

/** Короткое описание значения для сообщений об ошибках. */
export function describe(this: void, x: Val): string {
  const t = type(x)
  if (t === "nil") return "undefined"
  if (t === "string") return "string"
  if (t !== "table") return t
  if (x.__n !== undefined) return "array"
  if (x.__f !== undefined || x.__hf !== undefined || x.__lf !== undefined || x.__k !== undefined) return "function"
  if (x.__t === "Map" || x.__t === "Set") return x.__t
  if (x.__t === "host") return x.__h
  return "object"
}

// ---------- API игры (заполняет игровой слой, в тестах — заглушки) ----------

/** Функции API: блокирующие получают первым аргументом кадр k. */
export const host: Record<string, Fn> = {}
/** Объекты API (me, scan, …): {__t = "host", __h = имя}. */
export const hostObjects: Record<string, Val> = {}
/** Методы объектов API по имени объекта: (объект, k, ...аргументы). */
export const hostMethods: Record<string, Record<string, Fn>> = {}
/** Свойства объектов API для чтения и записи. */
export const hostGetters: Record<string, Record<string, Fn>> = {}
export const hostSetters: Record<string, Record<string, Fn>> = {}
/** Функции API, блокирующие исполнение (для значений-функций: const f = move). */
export const hostBlocking: Record<string, boolean> = {}

export function defineHostObject(this: void, name: string): Val {
  const o = { __t: "host", __h: name }
  hostObjects[name] = o
  hostMethods[name] = hostMethods[name] ?? {}
  hostGetters[name] = hostGetters[name] ?? {}
  hostSetters[name] = hostSetters[name] ?? {}
  return o
}

/** Завершить программу (exit) или начать заново (restart): маркер, который catch не перехватывает. */
export function controlFlow(this: void, kind: "exit" | "restart"): never {
  error({ __control: kind } as unknown as string, 0)
}

/** Объекты игры (не таблицы): чтение, запись, методы, описание. Заполняет игровой слой. */
export const hostValue: { get?: Fn; set?: Fn; method?: Fn } = {}

/**
 * Блокирующий вызов API. Первый вызов создаёт кадр ожидания {__host = имя} (его завершит игра:
 * result или error) и приостанавливает программу; продолжение возвращает результат.
 */
export function blockingCall(this: void, k: Val, name: string, init?: (this: void, frame: Val) => void): LuaMultiReturn<[Val, Val?]> {
  if (k !== undefined) {
    if (k.error !== undefined) error(k.error, 0)
    return $multi(k.result)
  }
  if (current!.sync() > 0) err("action-in-callback")
  const frame: Val = { __host: name }
  if (init !== undefined) init(frame)
  Q.w = frame
  return $multi(Y, frame)
}
