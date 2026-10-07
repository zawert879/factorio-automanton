-- Бенчмарк: N роботов-перевозчиков в бесконечном цикле, виртуальное движение.
-- Программа (TS):  while (true) { move(ore); mine(50); move(chest); put("iron-ore", 50) }
local N = __N__
local WHEEL = 4096
local SPEED = 0.15                 -- клеток за тик
local MINE_TICKS, PUT_TICKS, CARGO = 300, 60, 50
local K = 100                      -- месторождений и сундуков
local ACT_NONE, ACT_MOVE, ACT_MINE, ACT_PUT = 0, 1, 2, 3

-- Так компилятор сгенерирует возобновляемую программу: goto, точки остановки на действиях.
local function prog(fr)
  local ore, chest = fr.ore, fr.chest
  local pc = fr.pc
  if pc == 1 then goto after_move1
  elseif pc == 2 then goto after_mine
  elseif pc == 3 then goto after_move2
  elseif pc == 4 then goto after_put
  end
  ::loop::
  fr.pc = 1
  do return ACT_MOVE, ore end
  ::after_move1::
  fr.pc = 2
  do return ACT_MINE, ore end
  ::after_mine::
  fr.pc = 3
  do return ACT_MOVE, -chest end
  ::after_move2::
  fr.pc = 4
  do return ACT_PUT, chest end
  ::after_put::
  goto loop
end

local function schedule(s, id, due)
  local slot = due % WHEEL
  local b = s.wheel[slot]
  if not b then b = {}; s.wheel[slot] = b end
  b[#b + 1] = id
end

script.on_init(function()
  local surface = game.surfaces[1]
  local s = {
    x = {}, y = {}, cargo = {}, act = {}, arg = {}, fr = {}, wheel = {},
    ores = {}, chests = {}, events = 0,
  }
  storage.s = s
  for i = 1, K do
    local ox, oy = -200 + i * 4, -60
    s.ores[i] = { x = ox, y = oy, e = surface.create_entity { name = "iron-ore", position = { ox, oy }, amount = 4000000000 } }
    local cx, cy = -200 + i * 4, 60
    s.chests[i] = { x = cx, y = cy, e = surface.create_entity { name = "iron-chest", position = { cx, cy }, force = "player" } }
  end
  for id = 1, N do
    s.x[id], s.y[id], s.cargo[id], s.act[id], s.arg[id] = 0, 0, 0, ACT_NONE, 0
    s.fr[id] = { pc = 0, ore = (id % K) + 1, chest = ((id * 7) % K) + 1 }
    schedule(s, id, 1 + (id * 7919) % 1700)   -- разнести старт по времени
  end
  local okc, mem = pcall(collectgarbage, "count")
  log("HAUL init N=" .. N .. " lua_mem_kb=" .. tostring(okc and math.floor(mem) or "n/a"))
end)

script.on_event(defines.events.on_tick, function(e)
  local s = storage.s
  local t = e.tick
  if t % 600 == 0 then for i = 1, K do s.chests[i].e.clear_items_inside() end end
  local slot = t % WHEEL
  local bucket = s.wheel[slot]
  if not bucket then return end
  s.wheel[slot] = nil
  local X, Y, CG, ACT, ARG, FR, ores, chests = s.x, s.y, s.cargo, s.act, s.arg, s.fr, s.ores, s.chests
  for k = 1, #bucket do
    local id = bucket[k]
    -- 1. завершить текущее действие
    local a = ACT[id]
    if a == ACT_MOVE then
      local tg = ARG[id]
      local p = tg > 0 and ores[tg] or chests[-tg]
      X[id], Y[id] = p.x, p.y
    elseif a == ACT_MINE then
      local r = ores[ARG[id]].e
      r.amount = r.amount - CARGO
      CG[id] = CG[id] + CARGO
    elseif a == ACT_PUT then
      chests[ARG[id]].e.insert { name = "iron-ore", count = CG[id] }
      CG[id] = 0
    end
    -- 2. продолжить программу до следующего действия
    local kind, arg = prog(FR[id])
    ACT[id], ARG[id] = kind, arg
    local ticks
    if kind == ACT_MOVE then
      local p = arg > 0 and ores[arg] or chests[-arg]
      local dx, dy = p.x - X[id], p.y - Y[id]
      ticks = math.max(1, math.floor(math.sqrt(dx * dx + dy * dy) / SPEED))
    elseif kind == ACT_MINE then ticks = MINE_TICKS
    else ticks = PUT_TICKS end
    schedule(s, id, t + ticks)
  end
  s.events = s.events + #bucket
  if t == 3000 then log("HAUL events in 3000 ticks: " .. s.events .. " (" .. string.format("%.0f", s.events / 3000) .. " per tick)") end
end)
