-- Бенчмарк: N физических юнитов на стороне игрока бесконечно ездят по случайным точкам (поиск пути движка).
local N = __N__

local function rnd(s)
  s.seed = (s.seed * 1103515245 + 12345) % 2147483648
  return s.seed / 2147483648
end

local function go(s, unit)
  local dx, dy = (rnd(s) - 0.5) * 300, (rnd(s) - 0.5) * 300
  unit.commandable.set_command {
    type = defines.command.go_to_location, destination = { dx, dy },
    distraction = defines.distraction.none, radius = 3,
  }
end

script.on_init(function()
  local surface = game.surfaces[1]
  surface.request_to_generate_chunks({ 0, 0 }, 12)
  surface.force_generate_chunk_requests()
  local s = { seed = 42, units = {}, done = 0, failed = 0, placed = 0 }
  storage.s = s
  local side = math.ceil(math.sqrt(N))
  for i = 0, N - 1 do
    local pos = { (i % side) * 2 - side, math.floor(i / side) * 2 - side }
    if surface.can_place_entity { name = "bench-unit", position = pos } then
      local u = surface.create_entity { name = "bench-unit", position = pos, force = "player" }
      if u then
        s.units[u.unit_number] = u
        s.placed = s.placed + 1
        go(s, u)
      end
    end
  end
  log("UNITS placed " .. s.placed .. " of " .. N)
end)

script.on_event(defines.events.on_ai_command_completed, function(e)
  local s = storage.s
  local u = s.units[e.unit_number]
  if not (u and u.valid) then return end
  if e.result == defines.behavior_result.success then s.done = s.done + 1 else s.failed = s.failed + 1 end
  go(s, u)
end)

script.on_nth_tick(1800, function(e)
  local s = storage.s
  log("UNITS tick " .. e.tick .. ": arrived " .. s.done .. ", failed " .. s.failed)
end)
