// Отладочные команды для разработки и проверки в игре. В мультиплеере — только для админов.
import { CustomCommandData, LuaEntity, LuaPlayer, MapPosition } from "factorio:runtime"
import { moveRobot } from "../automaton/movement"
import { RobotRecord } from "../automaton/registry"
import { WORKER_MK1 } from "../names"

function adminPlayer(command: CustomCommandData): LuaPlayer | undefined {
  if (command.player_index === undefined) return undefined
  const player = game.get_player(command.player_index)
  if (player === undefined) return undefined
  if (game.is_multiplayer() && !player.admin) {
    player.print(["automaton.debug-admin-only"])
    return undefined
  }
  return player
}

export function registerDebugCommands(): void {
  commands.add_command("am-give", ["automaton.debug-give-help"], (command) => {
    const player = adminPlayer(command)
    if (player === undefined) return
    const count = math.max(1, math.min(100, math.floor(tonumber(command.parameter) ?? 5)))
    const inserted = player.insert({ name: WORKER_MK1, count })
    player.print(["automaton.debug-given", inserted])
  })

  // /am-goto <номер|all> [x y]: к точке; без координат — к зданию под курсором или к игроку.
  commands.add_command("am-goto", ["automaton.debug-goto-help"], (command) => {
    const player = adminPlayer(command)
    if (player === undefined) return
    const args = (command.parameter ?? "").split(" ").filter((arg) => arg !== "")
    if (args.length === 0) {
      player.print(["automaton.debug-goto-help"])
      return
    }
    const robots: RobotRecord[] = []
    for (const record of Object.values(storage.robots.byId)) {
      if (record === undefined || !record.entity.valid || record.entity.surface !== player.surface) continue
      if (args[0] === "all" || record.id === tonumber(args[0])) robots.push(record)
    }
    if (robots.length === 0) {
      player.print(["automaton.debug-unknown-robot", args[0]])
      return
    }
    const x = tonumber(args[1])
    const y = tonumber(args[2])
    const selected = player.selected
    const target: { position: MapPosition } | { entity: LuaEntity } =
      x !== undefined && y !== undefined
        ? { position: { x, y } }
        : selected !== undefined && selected.name !== WORKER_MK1
          ? { entity: selected }
          : { position: player.position }
    for (const record of robots) moveRobot(record, target, { notifyPlayer: player.index })
    player.print(["automaton.debug-goto-sent", robots.length])
  })

  // /am-info <номер>: состояние машины — позиция, занятие, груз, топливо, энергия.
  commands.add_command("am-info", ["automaton.debug-info-help"], (command) => {
    const player = adminPlayer(command)
    if (player === undefined) return
    const record = storage.robots.byId[tonumber(command.parameter) ?? -1]
    if (record === undefined || !record.entity.valid) {
      player.print(["automaton.debug-unknown-robot", command.parameter ?? ""])
      return
    }
    const { x, y } = record.entity.position
    player.print(
      `${record.name}: (${math.floor(x)}, ${math.floor(y)}), ${record.activity}, ` +
        `energy ${math.floor(record.energy / 1000)} kJ, fuel ${serpent.line(record.fuel.get_contents())}, ` +
        `cargo ${serpent.line(record.cargo.get_contents())}`,
    )
  })
}
