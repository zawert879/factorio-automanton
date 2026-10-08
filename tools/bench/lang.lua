-- Бенчмарк языка вне игры (Lua 5.2): npm run bench:lang. Собранные модули — в папке build (npm test собирает).
package.path = arg[1] .. "/?.lua;" .. package.path
local bench = require("src.test.langBench")
local times = {}
local order = {}
bench.runLangBench(function(label, fn)
  local start = os.clock()
  fn()
  local t = os.clock() - start
  if not times[label] or t < times[label] then times[label] = t end
  if not order[label] then order[label] = true; order[#order + 1] = label end
end)
local base
for _, label in ipairs(order) do
  local t = times[label]
  if label:find("| Lua$") then base = t end
  print(string.format("%-70s %8.1f мс  %5.2f×", label, t * 1000, t / base))
end
