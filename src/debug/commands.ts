// Отладочные команды для разработки и проверки в игре. В мультиплеере — только для админов.
import { CustomCommandData, LuaPlayer } from "factorio:runtime"
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
}
