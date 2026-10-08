// Значения программ на стороне игры: позиции, массивы, копирование «простых данных» (Value из API.md)
// для параметров, памяти и сообщений.
import { MapPosition } from "factorio:runtime"
import { charge, Val } from "../lang/runtime/core"
import { actionError } from "./context"

/** Виды обёрток, которые можно хранить и передавать (ссылки на объекты игры). */
const SHAREABLE_HANDLES: Record<string, boolean> = { entity: true, robot: true, marker: true, zone: true }

export function programArray(items: Val[]): Val {
  const result: Val = { __n: items.length }
  for (let i = 0; i < items.length; i++) result[i + 1] = items[i]
  charge(1 + items.length / 8)
  return result
}

export function programPosition(position: MapPosition): Val {
  charge(1)
  return { x: position.x, y: position.y }
}

/** Позиция из значения программы {x, y} (без проверки других полей). */
export function readPosition(value: Val): MapPosition | undefined {
  if (type(value) !== "table" || value.__n !== undefined || value.__t !== undefined) return undefined
  const x = value.x
  const y = value.y
  if (type(x) !== "number" || type(y) !== "number" || x !== x || y !== y) return undefined
  return { x, y }
}

/**
 * Копия «простых данных»: числа, строки, логические, null, массивы, объекты, ссылки на здания и машины.
 * Функции, экземпляры классов, Map/Set — ActionError("not-serializable"). Ссылки на объекты игры не копируются.
 */
export function copyValue(value: Val, depth = 0): Val {
  const t = type(value)
  if (t !== "table") return value
  if (depth > 50) actionError("limit-exceeded", "data is nested too deeply")
  if (value.__t === "host") {
    if (SHAREABLE_HANDLES[value.__h]) return value
    actionError("not-serializable")
  }
  if (value.__f !== undefined || value.__hf !== undefined || value.__lf !== undefined || value.__k !== undefined) actionError("not-serializable")
  if (value.__t !== undefined || value.__cls !== undefined) actionError("not-serializable")
  charge(1)
  if (value.__n !== undefined) {
    const copy: Val = { __n: value.__n }
    for (let i = 1; i <= value.__n; i++) copy[i] = copyValue(value[i], depth + 1)
    return copy
  }
  const copy: Val = {}
  for (const [k, v] of pairs(value as LuaTable<string, Val>)) copy[k] = copyValue(v, depth + 1)
  return copy
}
