-- Запуск тестов вне игры в Lua 5.2.
-- Аргументы: папка собранных тестов, затем имена модулей с тестами (tests.sample_test и т.п.).
local root = arg[1]
package.path = root .. "/?.lua;" .. package.path

local exit = os.exit

-- Окружение как в Factorio: этих модулей и функций там нет.
coroutine, io, os, loadfile, dofile = nil, nil, nil, nil, nil

local testing = require("src.test.testing")

local load_failed = false
for i = 2, #arg do
  local ok, err = pcall(require, arg[i])
  if not ok then
    print("ОШИБКА ЗАГРУЗКИ " .. arg[i] .. "\n    " .. tostring(err))
    load_failed = true
  end
end

local passed, failed = 0, 0
for _, case in ipairs(testing.registeredTests()) do
  local ok, err = pcall(case.fn)
  if ok then
    passed = passed + 1
  else
    failed = failed + 1
    print("✗ " .. case.name .. "\n    " .. tostring(err))
  end
end

print(string.format("\nпройдено: %d, упало: %d", passed, failed))
exit((failed == 0 and not load_failed) and 0 or 1)
