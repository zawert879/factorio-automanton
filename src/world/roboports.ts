// Дронстанций нет (21.1): дроны остаются только строительные, у игрока с персональной дронстанцией. Прототип скрыт,
// но не удалён (src/prototypes/removal.ts), поэтому дронстанции, уже стоящие в сохранении, при обновлении мода
// сносятся: дроны (стоявшие в ней и летающие в её сети) и содержимое — в сундук на её месте. Дронстанция,
// поставленная из предмета, оставшегося в инвентаре, сразу разбирается обратно.
import { LuaEntity, LuaInventory, LuaSurface, PlayerIndex } from "factorio:runtime"
import { moveAll } from "../automaton/registry"
import { onEvent } from "../events"

/** Сундук на месте дронстанции: 48 слотов — дронстанция держит 14 стопок (дроны и ремкомплекты). */
const CHEST = "steel-chest"

/** Дроны в полёте: сам дрон и его груз — в сундук. */
function collectRobots(robots: LuaEntity[], to: LuaInventory, surface: LuaSurface, position: LuaEntity["position"]): void {
  for (const robot of robots) {
    if (!robot.valid) continue
    for (const id of [defines.inventory.robot_cargo, defines.inventory.robot_repair]) {
      const inventory = robot.get_inventory(id)
      if (inventory !== undefined) moveAll(inventory, to, surface, position)
    }
    const item = robot.prototype.items_to_place_this?.[0]
    if (item !== undefined) {
      const stack = { name: item.name, count: 1, quality: robot.quality.name }
      if (to.insert(stack) === 0) surface.spill_item_stack({ position, stack, enable_looted: true })
    }
    robot.destroy()
  }
}

/** Снести дронстанцию: сундук на её месте, в нём — её дроны, ремкомплекты и дроны её сети, летающие сейчас. */
function removeRoboport(port: LuaEntity, collected: LuaSet<number>): void {
  const { surface, position, force } = port
  const network = port.logistic_network
  const flying = network !== undefined && !collected.has(network.network_id) ? network.robots : []
  if (network !== undefined) collected.add(network.network_id)
  const contents = game.create_inventory(64)
  for (const id of [defines.inventory.roboport_robot, defines.inventory.roboport_material]) {
    const inventory = port.get_inventory(id)
    if (inventory !== undefined) moveAll(inventory, contents, surface, position)
  }
  collectRobots(flying, contents, surface, position)
  port.destroy()
  if (!contents.is_empty()) {
    const chest = surface.create_entity({ name: CHEST, position, force })
    moveAll(contents, chest?.get_inventory(defines.inventory.chest), surface, position)
  }
  contents.destroy()
}

/** Снести все дронстанции в мире; сообщение каждой команде, у которой они были. Возвращает, сколько снесено. */
export function removeRoboports(): number {
  const byForce = new LuaMap<string, number>()
  let total = 0
  for (const [, surface] of game.surfaces) {
    const collected = new LuaSet<number>()
    for (const port of surface.find_entities_filtered({ type: "roboport" })) {
      const force = port.force.name
      removeRoboport(port, collected)
      byForce.set(force, (byForce.get(force) ?? 0) + 1)
      total++
    }
  }
  for (const [force, count] of byForce) game.forces[force]?.print(["automaton.roboports-removed", count])
  return total
}

/** Дронстанция из оставшегося предмета: игрок получает её обратно, а построенную дроном дроны разберут. */
export function onRoboportBuilt(entity: LuaEntity, playerIndex: PlayerIndex | undefined): void {
  if (!entity.valid || entity.type !== "roboport") return
  const player = playerIndex === undefined ? undefined : game.get_player(playerIndex)
  if (player !== undefined) {
    player.create_local_flying_text({ text: ["automaton.roboport-removed"], position: entity.position })
    if (player.mine_entity(entity, true)) return
  }
  if (entity.valid) entity.order_deconstruction(entity.force)
}

export function registerRoboports(): void {
  onEvent(defines.events.on_built_entity, (e) => onRoboportBuilt(e.entity, e.player_index))
  onEvent(defines.events.on_robot_built_entity, (e) => onRoboportBuilt(e.entity, undefined))
}
