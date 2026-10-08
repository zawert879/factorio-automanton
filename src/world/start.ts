// Старт игры (6.4). Freeplay: вместо бура и печи в стартовом наборе — два автоматона Mk1 и метки
// (сценарий даёт набор через remote-интерфейс «freeplay»; в других сценариях набор не трогаем).
// Каждой команде один раз публикуются стартовые программы (examples/*.ts): удалённая игроками программа
// не возвращается, изменённая — не перезаписывается.
import { LuaForce } from "factorio:runtime"
import { onEvent } from "../events"
import { STARTER_PROGRAMS } from "../program/examples.generated"
import { findProgram, publish } from "../program/store"
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

export function publishStarters(force: LuaForce): void {
  storage.startersPublished ??= {}
  if (storage.startersPublished[force.name]) return
  storage.startersPublished[force.name] = true
  for (const starter of STARTER_PROGRAMS) {
    if (findProgram(starter.name, force.name) !== undefined) continue
    const result = publish({ name: starter.name, source: starter.source, force: force.name, author: "Automaton" })
    if (!result.ok) log(`automaton: стартовая программа ${starter.name} не скомпилировалась: ${serpent.line(result.diagnostics)}`)
  }
}

/** on_init и on_configuration_changed (мод добавили в старое сохранение). */
export function initStart(): void {
  configureFreeplay()
  for (const [, force] of pairs(game.forces)) if (force.name !== "enemy" && force.name !== "neutral") publishStarters(force)
}

export function registerStart(): void {
  onEvent(defines.events.on_force_created, (e) => publishStarters(e.force))
}
