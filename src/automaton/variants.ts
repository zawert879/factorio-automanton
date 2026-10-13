// Варианты машин (22.1): смена оружия или брони подменяет сущность машины вариантом той же модели (оружие и
// сопротивления юнита заданы прототипом — src/prototypes/automaton.ts). Новая сущность встаёт на место старой
// с тем же здоровьем; запись машины (id, имя, программа, груз, энергия, бак) остаётся, подпись, тело и значки
// перецепляются, поездка отправляется заново. Бой продолжают опросы attack / guard / patrol: юниту без команды
// они выдают её снова (src/automaton/combat.ts, src/program/api/combat.ts).
import { LuaEntity, LuaRenderObject } from "factorio:runtime"
import { modelOf, variantName, variantOf } from "../names"
import { redispatchMove } from "./movement"
import { drawGun, RobotRecord } from "./registry"

/** Оружие и броня, которые сейчас стоят у машины (по её сущности). */
export function gearOf(record: RobotRecord): { weapon?: string; armor?: string } {
  const variant = variantOf(record.entity.name)
  return { weapon: variant?.weapon, armor: variant?.armor }
}

function retarget(object: LuaRenderObject | undefined, entity: LuaEntity, offset?: [number, number]): void {
  if (object?.valid) object.target = offset === undefined ? { entity } : { entity, offset }
}

/**
 * Подменить сущность машины вариантом её модели с этим оружием и бронёй (undefined — без них). false — сущность
 * не встала (машины уже нет). Та же сущность — ничего не делать.
 */
export function swapGear(record: RobotRecord, weapon: string | undefined, armor: string | undefined): boolean {
  const old = record.entity
  if (!old.valid) return false
  const name = variantName(record.model, weapon, armor)
  if (old.name === name) return true
  if (modelOf(name)?.entity !== record.model || variantOf(name) === undefined) error(`automaton: нет варианта ${name}`)
  const { surface, position, force } = old
  const health = old.health
  const next = surface.create_entity({ name, position, force, create_build_effect_smoke: false })
  if (next === undefined) return false
  if (health !== undefined) next.health = health
  const registry = storage.robots
  registry.idByUnit[old.unit_number!] = undefined
  registry.idByUnit[next.unit_number!] = record.id
  record.entity = next
  // Смещения — как при создании: подпись (registry.ts), значок проблемы и облачко (status.ts).
  retarget(record.label, next, [0, -1.5])
  retarget(record.body, next)
  retarget(record.problem, next, [0, -2.1])
  retarget(record.bubble, next, [0, -2.6])
  script.register_on_object_destroyed(next)
  old.destroy()
  drawGun(record)
  redispatchMove(record)
  return true
}
