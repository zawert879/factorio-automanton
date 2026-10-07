-- Runtime stage: события, команды, GUI.
-- Данные, которые должны пережить сохранение, кладём в `storage` (в 2.0 он заменил `global`).

local function init_storage()
  storage.command_uses = storage.command_uses or 0
end

script.on_init(init_storage)
script.on_configuration_changed(init_storage)

script.on_event(defines.events.on_player_created, function(event)
  local player = game.get_player(event.player_index)
  if player and player.mod_settings["automaton-show-greeting"].value then
    player.print({ "automaton.greeting", player.name })
  end
end)

commands.add_command("automaton", { "automaton.command-help" }, function(command)
  storage.command_uses = storage.command_uses + 1
  local message = { "automaton.hello", storage.command_uses }
  local player = command.player_index and game.get_player(command.player_index)
  if player then
    player.print(message)
  else
    game.print(message)
  end
end)
