// Демо из каркаса: приветствие при входе и команда /automaton.
// Уйдёт, когда появятся настоящие автоматоны.
import { LocalisedString } from "factorio:runtime"

export function initDemoStorage(): void {
  storage.commandUses ??= 0
}

export function registerDemo(): void {
  script.on_event(defines.events.on_player_created, (event) => {
    const player = game.get_player(event.player_index)
    if (player && player.mod_settings["automaton-show-greeting"].value) {
      player.print(["automaton.greeting", player.name])
    }
  })

  commands.add_command("automaton", ["automaton.command-help"], (command) => {
    storage.commandUses += 1
    const message: LocalisedString = ["automaton.hello", storage.commandUses]
    const player = command.player_index !== undefined ? game.get_player(command.player_index) : undefined
    if (player) {
      player.print(message)
    } else {
      game.print(message)
    }
  })
}
