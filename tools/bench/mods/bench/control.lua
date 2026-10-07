local REPS, N, THR = 1000, 100, 50
local items = {}
for i = 1, N do items[i] = { count = (i * 37) % 100 } end

local results = {}
local function bench(name, fn)
  for _ = 1, 3 do
    local p = helpers.create_profiler()
    local r, extra = fn()
    p.stop()
    results[#results + 1] = { name, p, r, extra }
  end
end

-- Эталон: обычный Lua, вложенные циклы целиком
bench("A native nested loops", function()
  local s = 0
  for _ = 1, REPS do
    local total = 0
    for i = 1, #items do
      local c = items[i].count
      if c < THR then total = total + c * 2 end
    end
    s = s + total
  end
  return s
end)

-- Возобновляемая функция «как сгенерирует компилятор»: goto, локальные переменные Lua,
-- сохранение в кадр только при паузе (кончился квант).
local YIELD = {}
local function prog(fr)
  local rep, i, n, s, total, c
  local gas = fr.gas
  if fr.pc == 1 then
    rep, i, n, s, total = fr.rep, fr.i, fr.n, fr.s, fr.total
    goto inner
  end
  s = 0
  rep = 1
  ::outer::
  if rep > REPS then goto finish end
  total = 0
  i = 1
  n = #items
  ::inner::
  if i > n then goto inner_end end
  c = items[i].count
  if c < THR then total = total + c * 2 end
  i = i + 1
  gas = gas - 1
  if gas <= 0 then
    fr.pc = 1
    fr.rep, fr.i, fr.n, fr.s, fr.total = rep, i, n, s, total
    return YIELD
  end
  goto inner
  ::inner_end::
  s = s + total
  rep = rep + 1
  goto outer
  ::finish::
  return s
end

local function drive(slice)
  return function()
    local fr = { pc = 0 }
    local yields = 0
    while true do
      fr.gas = slice
      local r = prog(fr)
      if r ~= YIELD then return r, yields end
      yields = yields + 1
    end
  end
end

bench("B resumable, no pauses", drive(1e12))
bench("C resumable, pause every 5000", drive(5000))
bench("D resumable, pause every 500", drive(500))
bench("E resumable, pause every 50", drive(50))

script.on_init(function()
  for _, r in ipairs(results) do
    log({ "", "BENCH ", r[1], " (result ", tostring(r[3]), ", pauses ", tostring(r[4] or 0), "): ", r[2] })
  end
end)
