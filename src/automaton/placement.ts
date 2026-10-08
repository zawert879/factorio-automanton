// Установка автоматона: предмет ставит заглушку, а здесь она заменяется на юнит.
// Срабатывает при любой постройке: руками, строительными роботами, скриптом другого мода.
// Если машину строят из подобранного предмета, она получает прежние id и имя (тег предмета).
import { LuaEntity } from "factorio:runtime"
import { onEvent } from "../events"
import { ROBOT_TAG, WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { registerRobot, RobotTag, tagFromInventory, tagFromStack } from "./registry"

export function replacePlacer(placer: LuaEntity, tag?: RobotTag): void {
  if (!placer.valid || placer.name !== WORKER_MK1_PLACER) return
  const { surface, position, force } = placer
  placer.destroy()
  // create_entity место не проверяет (поставит юнит хоть в воду), поэтому проверяем сами.
  // Заглушку, поставленную скриптом, могли поставить куда угодно: тогда возвращаем предмет на землю.
  const worker = surface.can_place_entity({ name: WORKER_MK1, position, force })
    ? surface.create_entity({ name: WORKER_MK1, position, force })
    : undefined
  if (worker === undefined) {
    const spilled = surface.spill_item_stack({ position, stack: { name: WORKER_MK1, count: 1 }, force })
    if (tag !== undefined) {
      for (const item of spilled) {
        if (item.stack?.name !== WORKER_MK1) continue
        item.stack.set_tag(ROBOT_TAG, tag)
        item.stack.label = tag.name
      }
    }
    return
  }
  // Без команды юнит может отвлечься на что-нибудь; пусть просто стоит.
  worker.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
  registerRobot(worker, tag)
}

export function registerPlacement(): void {
  const isPlacer = (entity: LuaEntity) => entity.valid && entity.name === WORKER_MK1_PLACER
  onEvent(defines.events.on_built_entity, (e) => {
    if (isPlacer(e.entity)) replacePlacer(e.entity, tagFromInventory(e.consumed_items))
  })
  onEvent(defines.events.on_robot_built_entity, (e) => {
    if (isPlacer(e.entity)) replacePlacer(e.entity, tagFromStack(e.stack))
  })
  onEvent(defines.events.script_raised_built, (e) => {
    if (isPlacer(e.entity)) replacePlacer(e.entity)
  })
  onEvent(defines.events.script_raised_revive, (e) => {
    if (isPlacer(e.entity)) replacePlacer(e.entity)
  })
}
