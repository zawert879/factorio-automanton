// Значение для отладочного вывода (print, console.log) — как console.log в Node: массивы и объекты
// с содержимым, экземпляры классов с именем класса, Map и Set с элементами, ошибки с кодом; строки
// внутри структур — в кавычках. Объекты игры описывает игровой слой (setHostInspector). Чистый модуль.
// String(x) и шаблонные строки остаются как в JS (values.ts, toStringValue).
import { program, Val } from "./core"
import { ownKeys } from "./library"
import { formatNumber, isErrorClass } from "./values"

/** Сколько элементов массива, ключей объекта, элементов Map / Set показывать. */
const MAX_ITEMS = 30
/** Глубже — кратко: [Array(5)], {…}. */
const MAX_DEPTH = 4
/** Длина строки внутри структуры. */
const MAX_STRING = 200

/** Описание объекта игры (здание, машина, метка…): игровой слой; inner — описать вложенное значение. */
let hostInspector: (this: void, x: Val, inner: (this: void, v: Val) => string) => string | undefined = () => undefined

export function setHostInspector(this: void, fn: (this: void, x: Val, inner: (this: void, v: Val) => string) => string | undefined): void {
  hostInspector = fn
}

/** Строка в кавычках, как в исходнике (длинная — с «…»). */
function quote(s: string): string {
  let body = s.length > MAX_STRING ? string.sub(s, 1, MAX_STRING) + "…" : s
  ;[body] = string.gsub(body, '[\\"\n\r\t]', (c: string) => (c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : `\\${c}`))
  return `"${body}"`
}

/** Имя: латиница, кириллица и прочие буквы (байты UTF-8 ≥ 0x80), цифры, _ и $ — без пробелов и знаков. */
const NAME = `^[%a_$${string.char(128)}-${string.char(255)}][%w_$${string.char(128)}-${string.char(255)}]*$`

/** Ключ объекта: имя как есть, иначе — в кавычках. */
function keyText(key: string): string {
  return string.match(key, NAME)[0] !== undefined ? key : quote(key)
}

/** Пользовательский toString у класса (с учётом предков). */
function customToString(cls: Val): Val {
  let c = cls
  while (c !== undefined) {
    const m = c.__m?.toString
    if (m !== undefined && c.__builtin === undefined) return m
    c = c.__s
  }
  return undefined
}

function list(items: string[], more: number, open: string, close: string): string {
  if (more > 0) items.push(`…+${more}`)
  if (items.length === 0) return `${open}${close}`
  return open === "[" ? `[${items.join(", ")}]` : `${open} ${items.join(", ")} ${close}`
}

function inspectValue(x: Val, depth: number, seen: LuaTable<Val, boolean>): string {
  const t = type(x)
  if (t === "string") return quote(x)
  if (t === "number") return formatNumber(x)
  if (t === "nil") return "undefined"
  if (t === "boolean") return x ? "true" : "false"
  if (t !== "table") return tostring(x)
  if (seen.get(x)) return "[Circular]"
  const inner = (v: Val): string => inspectValue(v, depth + 1, seen)
  // Функции и классы.
  if (x.__f !== undefined || x.__hf !== undefined || x.__lf !== undefined) return "[Function]"
  if (x.__k !== undefined) return `[class ${x.__name ?? ""}]`
  // Объекты игры.
  if (x.__t === "host") {
    seen.set(x, true)
    const text = hostInspector(x, inner) ?? `[${x.__h}]`
    seen.set(x, false)
    return text
  }
  if (depth >= MAX_DEPTH) {
    if (x.__n !== undefined) return `[Array(${x.__n})]`
    if (x.__t === "Map" || x.__t === "Set") return `${x.__t}(${x.__size})`
    return "{…}"
  }
  seen.set(x, true)
  let result: string
  if (x.__n !== undefined) {
    const items: string[] = []
    const shown = math.min(x.__n, MAX_ITEMS)
    for (let i = 1; i <= shown; i++) items.push(inner(x[i]))
    result = list(items, x.__n - shown, "[", "]")
  } else if (x.__t === "Map" || x.__t === "Set") {
    const items: string[] = []
    let more = 0
    for (let i = 1; i <= x.__len; i++) {
      if (!x.__live[i]) continue
      if (items.length >= MAX_ITEMS) {
        more++
        continue
      }
      items.push(x.__t === "Map" ? `${inner(x.__keys[i])} => ${inner(x.__vals[i])}` : inner(x.__keys[i]))
    }
    result = `${x.__t}(${x.__size}) ${list(items, more, "{", "}")}`
  } else {
    const cls = x.__cls
    if (cls !== undefined && isErrorClass(cls)) {
      const name = x.name !== undefined ? tostring(x.name) : "Error"
      const message = x.message !== undefined ? tostring(x.message) : ""
      result = `${name}${message !== "" ? `: ${message}` : ""}${x.code !== undefined ? ` (${tostring(x.code)})` : ""}`
    } else {
      const custom = cls !== undefined ? customToString(cls) : undefined
      if (custom !== undefined) {
        const text = program().calls(custom, x)
        result = type(text) === "string" ? text : inner(text)
      } else {
        const keys = ownKeys(x)
        const items: string[] = []
        const shown = math.min(keys.length, MAX_ITEMS)
        for (let i = 0; i < shown; i++) items.push(`${keyText(keys[i])}: ${inner(x[keys[i]])}`)
        const body = list(items, keys.length - shown, "{", "}")
        result = cls !== undefined && cls.__name !== undefined ? `${cls.__name} ${body}` : body
      }
    }
  }
  seen.set(x, false)
  return result
}

/** Значение для print / console.log: строка верхнего уровня — как есть, остальное — как в Node. */
export function inspect(this: void, x: Val): string {
  if (type(x) === "string") return x
  return inspectValue(x, 0, new LuaTable())
}
