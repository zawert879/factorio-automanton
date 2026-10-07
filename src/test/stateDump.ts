// Проверка сохранения/загрузки посреди работы (npm run test:desync).
// Сценарий на карте: машины ставятся, одна гибнет, одну подбирает персонаж, остальные уезжают далеко —
// сохранение на тике 300 застаёт их в пути; после него подобранную ставят обратно из предмета и ставят новую. На тике DUMP_TICK — снимок storage в
// script-output/automaton-state.txt. Состояние сценария нигде не хранится: всё ищется на карте.
// Подключается из control.ts, только когда включён служебный мод automaton-desync-test.
import { LuaEntity, LuaRenderObject } from "factorio:runtime"
import { moveRobot } from "../automaton/movement"
import { replacePlacer } from "../automaton/placement"
import { findRobot, tagFromInventory, tagMinedRobot } from "../automaton/registry"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"

const DUMP_TICK = 600 // как в tools/test/desync.mjs

function nauvis() {
  return game.get_surface("nauvis")!
}

function placeAt(near: { x: number; y: number }): void {
  const position = nauvis().find_non_colliding_position(WORKER_MK1, near, 20, 0.5)!
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
}

function workers(): LuaEntity[] {
  return nauvis()
    .find_entities_filtered({ name: WORKER_MK1 })
    .sort((a, b) => a.unit_number! - b.unit_number!)
}

const steps: Record<number, () => void> = {
  60: () => {
    for (let i = 0; i < 4; i++) placeAt({ x: 40 + i * 3, y: 40 })
  },
  120: () => workers()[0].die(),
  200: () => {
    const target = workers()[0]
    const position = nauvis().find_non_colliding_position("character", target.position, 10, 0.5)!
    // Как подбор игроком: предмет в инвентаре персонажа получает тег машины, машина исчезает.
    const inventory = nauvis().create_entity({ name: "character", position, force: "player" })!.get_main_inventory()!
    inventory.insert({ name: WORKER_MK1, count: 1 })
    tagMinedRobot(target, inventory)
    target.destroy()
  },
  // Поездки, которые сохранение на тике 300 застанет в пути.
  250: () => {
    for (const worker of workers()) moveRobot(findRobot(worker)!, { position: { x: 45, y: 90 } })
  },
  400: () => {
    const character = nauvis().find_entities_filtered({ name: "character" })[0]
    const position = nauvis().find_non_colliding_position(WORKER_MK1, { x: 40, y: 50 }, 20, 0.5)!
    const placer = nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player" })!
    replacePlacer(placer, tagFromInventory(character.get_main_inventory()))
    character.get_main_inventory()!.remove({ name: WORKER_MK1, count: 1 })
  },
  450: () => placeAt({ x: 50, y: 50 }),
}

/** Объекты игры serpent печатает с адресами памяти — заменяем их стабильным описанием. */
function stable(value: unknown): unknown {
  if (type(value) === "userdata") {
    const object = value as { valid: boolean; object_name: string }
    if (!object.valid) return `<${object.object_name}: недействителен>`
    if (object.object_name === "LuaEntity") {
      const e = value as LuaEntity
      return `<LuaEntity ${e.name} #${e.unit_number} (${e.position.x}, ${e.position.y})>`
    }
    if (object.object_name === "LuaRenderObject") return `<LuaRenderObject #${(value as LuaRenderObject).id}>`
    return `<${object.object_name}>`
  }
  if (type(value) !== "table") return value
  const copy: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) copy[key] = stable(item)
  return copy
}

script.on_nth_tick(1, (event) => {
  steps[event.tick]?.()
  if (event.tick !== DUMP_TICK) return
  const snapshot = serpent.block(stable(storage), { sortkeys: true, comment: false })
  helpers.write_file("automaton-state.txt", `tick ${event.tick}\n${snapshot}\n`, false)
})
