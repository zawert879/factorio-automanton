// Модель типов для проверки (src/lang/check.ts). Проверка постепенная: всё, в чём нет уверенности, —
// any, и ошибок по нему нет. Совместимость структурная, как в TypeScript, но мягче: null и undefined
// совместимы с любым типом (без полного анализа потока управления «возможно null» давало бы ложные
// ошибки), глубокая вложенность и неизвестное — «совместимо».

export type Type =
  | { k: "any" }
  | { k: "unknown" }
  | { k: "never" }
  | { k: "void" }
  | { k: "number" }
  | { k: "string" }
  | { k: "boolean" }
  | { k: "null" }
  | { k: "lit"; v: string | number | boolean }
  | { k: "array"; el: Type }
  | { k: "tuple"; els: Type[] }
  | { k: "obj"; o: ObjType }
  | { k: "union"; ts: Type[] }
  /** Именованный тип (интерфейс, псевдоним, класс) — раскрывается по требованию: так проще с рекурсией. */
  | { k: "ref"; name: string; args: Type[] }
  /** Параметр обобщения внутри его объявления. */
  | { k: "param"; name: string }

export interface Prop {
  t: Type
  opt: boolean
}

export interface TParam {
  name: string
  def?: Type
}

export interface SigParam {
  name: string
  t: Type
  opt: boolean
  rest: boolean
}

export interface Sig {
  tparams: TParam[]
  params: SigParam[]
  ret: Type
}

export interface ObjType {
  /** Имя для сообщений (интерфейс, класс, Map<string, number>). */
  name?: string
  props: Map<string, Prop>
  /** Индекс: obj[ключ] — этот тип (Record, [key: string]: T). */
  index?: Type
  /** Индекс по числу ([i: number]: T) — только для obj[число], не для имён свойств. */
  numberIndex?: Type
  calls: Sig[]
  ctors: Sig[]
  /** Неизвестные свойства — any, без ошибок (объект из any, object). */
  open?: boolean
}

export const ANY: Type = { k: "any" }
export const UNKNOWN: Type = { k: "unknown" }
export const NEVER: Type = { k: "never" }
export const VOID: Type = { k: "void" }
export const NUMBER: Type = { k: "number" }
export const STRING: Type = { k: "string" }
export const BOOLEAN: Type = { k: "boolean" }
export const NULL: Type = { k: "null" }

export function obj(o: Partial<ObjType>): Type {
  return { k: "obj", o: { props: o.props ?? new Map(), calls: o.calls ?? [], ctors: o.ctors ?? [], name: o.name, index: o.index, open: o.open } }
}

export function fnType(sig: Sig): Type {
  return obj({ calls: [sig] })
}

/** Объединение без повторов; any поглощает всё, never исчезает, вложенные — раскрываются. */
export function union(types: Type[]): Type {
  const out: Type[] = []
  const seen = new Set<string>()
  const add = (t: Type) => {
    if (t.k === "union") {
      for (const inner of t.ts) add(inner)
      return
    }
    if (t.k === "never") return
    const key = typeKey(t)
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }
  for (const t of types) {
    if (t.k === "any") return ANY
    add(t)
  }
  if (out.length === 0) return NEVER
  if (out.length === 1) return out[0]
  return { k: "union", ts: out }
}

/** Ключ для сравнения одинаковых типов (не глубокий для объектов — по имени или по ссылке). */
let objectKeys = new Map<ObjType, number>()
let nextObjectKey = 1
export function resetTypeKeys(): void {
  objectKeys = new Map()
  nextObjectKey = 1
}

export function typeKey(t: Type): string {
  switch (t.k) {
    case "lit":
      return `lit:${typeof t.v}:${tostring(t.v)}`
    case "array":
      return `[${typeKey(t.el)}]`
    case "tuple":
      return `(${t.els.map((x) => typeKey(x)).join(",")})`
    case "ref":
      return `${t.name}<${t.args.map((x) => typeKey(x)).join(",")}>`
    case "param":
      return `param:${t.name}`
    case "union":
      return t.ts.map((x) => typeKey(x)).join("|")
    case "obj": {
      let key = objectKeys.get(t.o)
      if (key === undefined) {
        key = nextObjectKey++
        objectKeys.set(t.o, key)
      }
      return `obj:${key}`
    }
    default:
      return t.k
  }
}

/** Литерал → его примитив (let x = 1 — number). */
export function widen(t: Type): Type {
  if (t.k === "lit") return typeof t.v === "number" ? NUMBER : typeof t.v === "string" ? STRING : BOOLEAN
  if (t.k === "union") return union(t.ts.map((x) => widen(x)))
  return t
}

/** Без null и undefined (после ?., ??, проверки). */
export function nonNull(t: Type): Type {
  if (t.k === "null") return NEVER
  if (t.k === "union") return union(t.ts.filter((m) => m.k !== "null"))
  return t
}

export function hasNull(t: Type): boolean {
  return t.k === "null" || (t.k === "union" && t.ts.some((m) => m.k === "null"))
}

/** Подставить параметры обобщения. */
export function subst(t: Type, map: Map<string, Type>, depth = 0): Type {
  if (map.size === 0 || depth > 20) return t
  switch (t.k) {
    case "param":
      return map.get(t.name) ?? t
    case "array":
      return { k: "array", el: subst(t.el, map, depth + 1) }
    case "tuple":
      return { k: "tuple", els: t.els.map((e) => subst(e, map, depth + 1)) }
    case "union":
      return union(t.ts.map((m) => subst(m, map, depth + 1)))
    case "ref":
      return { k: "ref", name: t.name, args: t.args.map((a) => subst(a, map, depth + 1)) }
    case "obj": {
      const props = new Map<string, Prop>()
      for (const [name, prop] of t.o.props) props.set(name, { t: subst(prop.t, map, depth + 1), opt: prop.opt })
      const sig = (s: Sig): Sig => {
        // Собственные параметры сигнатуры перекрывают внешние.
        const inner = new Map(map)
        for (const p of s.tparams) inner.delete(p.name)
        return { tparams: s.tparams, params: s.params.map((p) => ({ ...p, t: subst(p.t, inner, depth + 1) })), ret: subst(s.ret, inner, depth + 1) }
      }
      return {
        k: "obj",
        o: {
          name: t.o.name,
          props,
          index: t.o.index === undefined ? undefined : subst(t.o.index, map, depth + 1),
          numberIndex: t.o.numberIndex === undefined ? undefined : subst(t.o.numberIndex, map, depth + 1),
          calls: t.o.calls.map((s) => sig(s)),
          ctors: t.o.ctors.map((s) => sig(s)),
          open: t.o.open,
        },
      }
    }
    default:
      return t
  }
}

/** Есть ли в типе параметры обобщения из набора. */
export function mentions(t: Type, names: Set<string>, depth = 0): boolean {
  if (depth > 10) return false
  switch (t.k) {
    case "param":
      return names.has(t.name)
    case "array":
      return mentions(t.el, names, depth + 1)
    case "tuple":
      return t.els.some((e) => mentions(e, names, depth + 1))
    case "union":
      return t.ts.some((m) => mentions(m, names, depth + 1))
    case "ref":
      return t.args.some((a) => mentions(a, names, depth + 1))
    case "obj": {
      for (const [, p] of t.o.props) if (mentions(p.t, names, depth + 1)) return true
      return t.o.calls.some((s) => s.params.some((p) => mentions(p.t, names, depth + 1)) || mentions(s.ret, names, depth + 1))
    }
    default:
      return false
  }
}

// ---------- Печать для сообщений ----------

export function printType(t: Type, depth = 0): string {
  if (depth > 3) return "…"
  switch (t.k) {
    case "lit":
      return typeof t.v === "string" ? `"${t.v}"` : tostring(t.v)
    case "array": {
      const inner = printType(t.el, depth + 1)
      return t.el.k === "union" || (t.el.k === "obj" && t.el.o.calls.length > 0) ? `(${inner})[]` : `${inner}[]`
    }
    case "tuple":
      return `[${t.els.map((e) => printType(e, depth + 1)).join(", ")}]`
    case "union":
      return t.ts.map((m) => printType(m, depth + 1)).join(" | ")
    case "ref":
      return t.args.length === 0 ? t.name : `${t.name}<${t.args.map((a) => printType(a, depth + 1)).join(", ")}>`
    case "param":
      return t.name
    case "null":
      return "null"
    case "obj": {
      if (t.o.name !== undefined) return t.o.name
      if (t.o.calls.length > 0 && t.o.props.size === 0) {
        const s = t.o.calls[0]
        return `(${s.params.map((p) => `${p.rest ? "..." : ""}${p.name}${p.opt ? "?" : ""}: ${printType(p.t, depth + 1)}`).join(", ")}) => ${printType(s.ret, depth + 1)}`
      }
      const parts: string[] = []
      for (const [name, prop] of t.o.props) {
        if (parts.length >= 4) {
          parts.push("…")
          break
        }
        parts.push(`${name}${prop.opt ? "?" : ""}: ${printType(prop.t, depth + 1)}`)
      }
      return `{ ${parts.join("; ")} }`
    }
    default:
      return t.k
  }
}
