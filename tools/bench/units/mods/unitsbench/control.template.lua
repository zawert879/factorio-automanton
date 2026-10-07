-- Бенчмарк: N физических юнитов на стороне игрока бесконечно ездят (поиск пути движка).
-- ROUTE: "random" — в случайные точки; "shuttle" — челноком между двумя постоянными точками своей пары
-- (как перевозчики: маршруты повторяются); "waypoints" — челнок, но путь каждого маршрута ищется один раз
-- (request_path), а юниты едут по нему перегонами по HOP клеток (составная команда).
-- CACHE: кэш путей движка (pathfind_flags.cache).
local N = __N__
local ROUTE = "__ROUTE__"
local CACHE = __CACHE__

local function rnd(s)
  s.seed = (s.seed * 1103515245 + 12345) % 2147483648
  return s.seed / 2147483648
end

-- 20 постоянных маршрутов (пар точек) для челноков
local ROUTES = {}
for i = 1, 20 do
  local a = { -120 + (i % 5) * 10, -120 + math.floor(i / 5) * 10 }
  local b = { 100 - (i % 5) * 10, 100 - math.floor(i / 5) * 10 }
  ROUTES[i] = { a, b }
end

local HOP = 20

-- Путь маршрута → перегоны: точки пути через каждые ~HOP клеток и сама цель.
local function hops(path, destination)
  local result, travelled, last = {}, 0, nil
  for _, waypoint in ipairs(path) do
    local p = waypoint.position
    if last then travelled = travelled + math.sqrt((p.x - last.x) ^ 2 + (p.y - last.y) ^ 2) end
    last = p
    if travelled >= HOP then
      result[#result + 1] = p
      travelled = 0
    end
  end
  result[#result + 1] = destination
  return result
end

local function go(s, unit)
  local destination
  if ROUTE == "waypoints" then
    local index = unit.unit_number % 20 + 1
    s.leg[unit.unit_number] = (s.leg[unit.unit_number] or 0) % 2 + 1
    local leg = s.leg[unit.unit_number]
    destination = ROUTES[index][leg]
    local path = s.paths[index .. ":" .. leg]
    if path then
      local commands = {}
      for _, p in ipairs(hops(path, destination)) do
        commands[#commands + 1] = {
          type = defines.command.go_to_location, destination = p, radius = 3,
          distraction = defines.distraction.none, pathfind_flags = { cache = CACHE },
        }
      end
      unit.commandable.set_command {
        type = defines.command.compound, structure_type = defines.compound_command.return_last,
        commands = commands, distraction = defines.distraction.none,
      }
      return
    end
  elseif ROUTE == "shuttle" then
    local route = ROUTES[unit.unit_number % 20 + 1]
    s.leg[unit.unit_number] = (s.leg[unit.unit_number] or 0) % 2 + 1
    destination = route[s.leg[unit.unit_number]]
  else
    destination = { (rnd(s) - 0.5) * 300, (rnd(s) - 0.5) * 300 }
  end
  unit.commandable.set_command {
    type = defines.command.go_to_location, destination = destination,
    distraction = defines.distraction.none, radius = 3,
    pathfind_flags = { cache = CACHE },
  }
end

script.on_init(function()
  local surface = game.surfaces[1]
  surface.request_to_generate_chunks({ 0, 0 }, 12)
  surface.force_generate_chunk_requests()
  local s = { seed = 42, units = {}, done = 0, failed = 0, placed = 0, leg = {}, paths = {}, requests = {} }
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
  if ROUTE == "waypoints" then
    local proto = prototypes.entity["bench-unit"]
    for index, route in ipairs(ROUTES) do
      for leg = 1, 2 do
        local from = route[leg % 2 + 1]
        local id = surface.request_path {
          bounding_box = proto.collision_box, collision_mask = proto.collision_mask,
          start = from, goal = route[leg], force = "player", radius = 3,
          pathfind_flags = { cache = false }, path_resolution_modifier = 0,
        }
        s.requests[id] = index .. ":" .. leg
      end
    end
  end
end)

script.on_event(defines.events.on_script_path_request_finished, function(e)
  local s = storage.s
  local key = s.requests[e.id]
  if key and e.path then s.paths[key] = e.path end
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
