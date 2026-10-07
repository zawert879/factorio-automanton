// Установка автоматона: предмет ставит заглушку, а здесь она заменяется на юнит.
// Срабатывает при любой постройке: руками, строительными роботами, скриптом другого мода.
import { LuaEntity } from "factorio:runtime"
import { WORKER_MK1, WORKER_MK1_PLACER } from "../names"

function replacePlacer(placer: LuaEntity): void {
  if (!placer.valid || placer.name !== WORKER_MK1_PLACER) return
  const { surface, position, force } = placer
  placer.destroy()
  // create_entity место не проверяет (поставит юнит хоть в воду), поэтому проверяем сами.
  // Заглушку, поставленную скриптом, могли поставить куда угодно: тогда возвращаем предмет на землю.
  const worker = surface.can_place_entity({ name: WORKER_MK1, position, force })
    ? surface.create_entity({ name: WORKER_MK1, position, force })
    : undefined
  if (worker === undefined) {
    surface.spill_item_stack({ position, stack: { name: WORKER_MK1, count: 1 }, force })
    return
  }
  // Без команды юнит может отвлечься на что-нибудь; пусть просто стоит.
  worker.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
}

export function registerPlacement(): void {
  const filter = [{ filter: "name" as const, name: WORKER_MK1_PLACER }]
  script.on_event(defines.events.on_built_entity, (e) => replacePlacer(e.entity), filter)
  script.on_event(defines.events.on_robot_built_entity, (e) => replacePlacer(e.entity), filter)
  script.on_event(defines.events.script_raised_built, (e) => replacePlacer(e.entity), filter)
  script.on_event(defines.events.script_raised_revive, (e) => replacePlacer(e.entity), filter)
}
