// Установка автоматона: предмет ставит заглушку, а здесь она заменяется на юнит.
// Срабатывает при любой постройке: руками, строительными роботами, скриптом другого мода.
// Если машину строят из подобранного предмета, она получает прежние id и имя (тег предмета).
// Если по чертежу — программу и параметры из тега записи чертежа (18.7, src/automaton/blueprints.ts).
import { LuaEntity, Tags } from "factorio:runtime"
import { onEvent } from "../events"
import { modelOf, ROBOT_TAG } from "../names"
import { applyBlueprintTag } from "./blueprints"
import { registerRobot, RobotTag, tagFromInventory, tagFromStack } from "./registry"

export function replacePlacer(placer: LuaEntity, tag?: RobotTag, blueprintTags?: Tags): void {
  const model = placer.valid ? modelOf(placer.name) : undefined
  if (model === undefined || placer.name !== model.placer) return
  const { surface, position, force } = placer
  placer.destroy()
  // create_entity место не проверяет (поставит юнит хоть в воду), поэтому проверяем сами.
  // Заглушку, поставленную скриптом, могли поставить куда угодно: тогда возвращаем предмет на землю.
  const worker = surface.can_place_entity({ name: model.entity, position, force })
    ? surface.create_entity({ name: model.entity, position, force })
    : undefined
  if (worker === undefined) {
    const spilled = surface.spill_item_stack({ position, stack: { name: model.entity, count: 1 }, force })
    if (tag !== undefined) {
      for (const item of spilled) {
        if (item.stack?.name !== model.entity) continue
        item.stack.set_tag(ROBOT_TAG, tag)
        item.stack.label = tag.name
      }
    }
    return
  }
  // Без команды юнит может отвлечься на что-нибудь; пусть просто стоит.
  if (worker.type === "unit") worker.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
  const robot = registerRobot(worker, tag)
  applyBlueprintTag(robot, blueprintTags)
}

export function registerPlacement(): void {
  const isPlacer = (entity: LuaEntity) => entity.valid && modelOf(entity.name)?.placer === entity.name
  onEvent(defines.events.on_built_entity, (e) => {
    if (isPlacer(e.entity)) replacePlacer(e.entity, tagFromInventory(e.consumed_items, modelOf(e.entity.name)!.entity), e.tags)
  })
  onEvent(defines.events.on_robot_built_entity, (e) => {
    if (isPlacer(e.entity)) replacePlacer(e.entity, tagFromStack(e.stack), e.tags)
  })
  onEvent(defines.events.script_raised_built, (e) => {
    if (isPlacer(e.entity)) replacePlacer(e.entity)
  })
  onEvent(defines.events.script_raised_revive, (e) => {
    if (isPlacer(e.entity)) replacePlacer(e.entity, undefined, e.tags)
  })
}
