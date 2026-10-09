// Старт игры (6.4). Freeplay: вместо бура и печи в стартовом наборе — два автоматона Mk1 и метки
// (сценарий даёт набор через remote-интерфейс «freeplay»; в других сценариях набор не трогаем).
// Библиотека команды в начале пустая: программы игроки пишут сами (примеры — examples/*.ts,
// src/program/examples.ts).
import { MARKER, WORKER_MK1 } from "../names"

/** Что убрать из стартового набора freeplay и что дать взамен. */
const REMOVED_START_ITEMS = ["burner-mining-drill", "stone-furnace"]
export const START_ITEMS: Record<string, number> = { [WORKER_MK1]: 2, [MARKER]: 4 }

export function configureFreeplay(): void {
  const freeplay = remote.interfaces["freeplay"]
  if (freeplay === undefined || !freeplay["get_created_items"] || !freeplay["set_created_items"]) return
  const items = remote.call("freeplay", "get_created_items") as Record<string, number | undefined>
  for (const name of REMOVED_START_ITEMS) items[name] = undefined
  for (const [name, count] of pairs(START_ITEMS)) items[name] = count
  remote.call("freeplay", "set_created_items", items)
}

/** on_init и on_configuration_changed (мод добавили в старое сохранение). */
export function initStart(): void {
  configureFreeplay()
}
