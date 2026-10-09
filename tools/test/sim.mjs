// npm run test:sim — проверки, которым нужен настоящий игрок: игра С ОКНОМ на секунды, служебный мод
// automaton-sim заменяет симуляции главного меню одной своей; в ней тестовый игрок мышью и клавишами
// (game.simulation) делает то, что в игре без окна не сделать. Сейчас — чертежи с машинами (18.7): чертёж
// рамкой над машинами и сундуком, Ctrl+C рамкой, вставка и постройка по нему. Итог — result.json в script-output.
import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildMod, prepareWork, scriptError } from "./factorio.mjs"

const TIMEOUT_MS = 120_000

// Сценарий симуляции (Lua): шаги по тикам — условие (дождаться) и действие.
const init = `
player = game.simulation.create_test_player{name = "tester"}
player.teleport({0, 6})
game.simulation.camera_player = player
game.simulation.camera_zoom = 1
game.simulation.camera_player_cursor_position = player.position
local s = game.surfaces[1]
s.build_checkerboard{{-30, -20}, {30, 20}}
s.create_entity{name = "wooden-chest", position = {-5.5, 0.5}, force = "player"}
local placed = {}
for _, x in ipairs({-3.5, -1.5}) do
  s.create_entity{name = "automaton-worker-mk1-placer", position = {x, 0.5}, force = "player", raise_built = true}
end
result = { steps = {} }
local ok, published = pcall(remote.call, "automaton", "publish", "sim/work", "while (true) wait(1)")
result.publish = ok and published or tostring(published)
local units = s.find_entities_filtered{type = "unit", area = {{-5, -1}, {0, 2}}}
result.units = #units
for _, u in ipairs(units) do
  local info = remote.call("automaton", "robotInfo", u.unit_number)
  if info and u.position.x < -2.5 then remote.call("automaton", "run", info.id, "sim/work") end
end
step = 1
wait = 0
result.setup = {}
script.on_event(defines.events.on_player_setup_blueprint, function(e)
  local bp = e.stack
  local count = bp and bp.valid_for_read and bp.is_blueprint and #(bp.get_blueprint_entities() or {}) or -1
  local mapped = 0
  for _ in pairs(e.mapping.get()) do mapped = mapped + 1 end
  result.setup[#result.setup + 1] = { item = e.item, stack = bp and bp.valid_for_read and bp.name or "-", entities = count, mapped = mapped,
    to_setup = player.blueprint_to_setup.valid_for_read and #(player.blueprint_to_setup.get_blueprint_entities() or {}) or -1 }
end)
function entitiesOf(stack)
  local list = {}
  if not (stack and stack.valid_for_read and stack.is_blueprint) then return list end
  for _, e in ipairs(stack.get_blueprint_entities() or {}) do
    local tag = e.tags and e.tags.automaton
    list[#list + 1] = { name = e.name, x = e.position.x, y = e.position.y, program = tag and tag.program, args = tag and tag.args }
  end
  return list
end
function finish()
  helpers.write_file("automaton-sim/result.json", helpers.table_to_json(result), false)
  step = 1000
end
`

const update = `
if step >= 1000 then return end
wait = wait + 1
local sim = game.simulation
local function at(x, y) return sim.move_cursor{position = {x, y}, speed = 0.6} end
local function log(text) result.steps[#result.steps + 1] = text end
local s = game.surfaces[1]
-- 1. Ctrl+C рамкой над машинами и сундуком, вставка правее, постройка: машина рукой поверх призрака, остальное — скриптом.
if step == 1 and wait > 30 then
  sim.control_press{control = "copy", notify = false}
  step, wait = 2, 0
elseif step == 2 and at(-7, -1) then
  sim.control_down{control = "select-for-blueprint", notify = false}
  step, wait = 3, 0
elseif step == 3 and at(0, 2) then
  sim.control_up{control = "select-for-blueprint"}
  step, wait = 4, 0
elseif step == 4 and wait > 20 then
  log("copy: cursor=" .. tostring(player.cursor_stack.valid_for_read and player.cursor_stack.name))
  step, wait = 5, 0
elseif step == 5 and at(12, 0.5) then
  sim.control_press{control = "build", notify = false}
  step, wait = 6, 0
elseif step == 6 and wait > 20 then
  local ghosts = s.find_entities_filtered{name = "entity-ghost", area = {{4, -6}, {20, 6}}}
  result.ghosts = #ghosts
  player.clear_cursor()
  -- Рукой — призрак машины с программой (тег призрака приходит в on_built_entity).
  for _, g in ipairs(ghosts) do
    if g.valid and g.ghost_name == "automaton-worker-mk1-placer" and g.tags and g.tags.automaton and g.tags.automaton.program then
      local position = g.position
      player.teleport({position.x, position.y + 3})
      player.cursor_stack.set_stack{name = "automaton-worker-mk1", count = 1}
      local ok, err = pcall(player.build_from_cursor, {position = position})
      log("build_from_cursor: " .. tostring(ok) .. " " .. tostring(err))
      local unit = s.find_entities_filtered{type = "unit", position = position, radius = 0.6}[1]
      local info = unit and remote.call("automaton", "robotInfo", unit.unit_number)
      result.handBuilt = info and info.program or "нет машины"
      break
    end
  end
  player.clear_cursor()
  player.teleport({0, 6})
  step, wait = 7, 0
elseif step == 7 and wait > 10 then
  for _, g in ipairs(s.find_entities_filtered{name = "entity-ghost", area = {{4, -6}, {20, 6}}}) do g.revive{raise_revive = true} end
  result.built = {}
  for _, u in ipairs(s.find_entities_filtered{type = "unit", area = {{4, -6}, {20, 6}}}) do
    local info = remote.call("automaton", "robotInfo", u.unit_number)
    result.built[#result.built + 1] = info and { name = info.name, program = info.program, status = info.status } or { name = "?" }
  end
  step, wait = 10, 0
-- 2. Новый чертёж рамкой: окно настройки чертежа (подтверждение дважды — открыть и принять), чертёж в руке.
elseif step == 10 and wait > 20 then
  player.cursor_stack.set_stack{name = "blueprint"}
  step, wait = 11, 0
elseif step == 11 and at(-7, -1) then
  sim.control_down{control = "select-for-blueprint", notify = false}
  step, wait = 12, 0
elseif step == 12 and at(0, 2) then
  sim.control_up{control = "select-for-blueprint"}
  step, wait = 13, 0
elseif step == 13 and wait == 20 then
  sim.control_press{control = "confirm-gui", notify = false}
elseif step == 13 and wait == 45 then
  sim.control_press{control = "confirm-gui", notify = false}
elseif step == 13 and wait == 75 then
  result.blueprint = entitiesOf(player.cursor_stack)
  log("blueprint: cursor=" .. tostring(player.cursor_stack.valid_for_read and player.cursor_stack.name))
  player.clear_cursor()
  step, wait = 20, 0
-- 3. Рамка над одними машинами (без зданий): игра может счесть чертёж пустым.
elseif step == 20 and wait > 20 then
  player.cursor_stack.set_stack{name = "blueprint"}
  step, wait = 21, 0
elseif step == 21 and at(-4.5, -1) then
  sim.control_down{control = "select-for-blueprint", notify = false}
  step, wait = 22, 0
elseif step == 22 and at(0, 2) then
  sim.control_up{control = "select-for-blueprint"}
  step, wait = 23, 0
elseif step == 23 and wait == 20 then
  sim.control_press{control = "confirm-gui", notify = false}
elseif step == 23 and wait == 45 then
  sim.control_press{control = "confirm-gui", notify = false}
elseif step == 23 and wait == 75 then
  result.machinesOnly = entitiesOf(player.cursor_stack)
  log("machines only: cursor=" .. tostring(player.cursor_stack.valid_for_read and player.cursor_stack.name))
  player.clear_cursor()
  step, wait = 30, 0
-- 4. Строительные роботы: призраки машин с тегами у робопорта, предметы — в сундуке хранения.
elseif step == 30 and wait > 10 then
  local port = s.create_entity{name = "roboport", position = {0, 14}, force = "player"}
  s.create_entity{name = "electric-energy-interface", position = {4, 14}, force = "player"}
  s.create_entity{name = "medium-electric-pole", position = {2, 12}, force = "player"}
  port.insert{name = "construction-robot", count = 10}
  local chest = s.create_entity{name = "storage-chest", position = {-3.5, 12.5}, force = "player"}
  chest.insert{name = "automaton-worker-mk1", count = 5}
  s.create_entity{name = "entity-ghost", inner_name = "automaton-worker-mk1-placer", position = {6.5, 16.5}, force = "player", tags = { automaton = { program = "sim/work", args = "{\\"ore\\":\\"coal\\"}" } }}
  s.create_entity{name = "entity-ghost", inner_name = "automaton-worker-mk1-placer", position = {8.5, 16.5}, force = "player", tags = { automaton = { program = "нет-такой" } }}
  step, wait = 31, 0
elseif step == 31 and (wait > 1200 or #s.find_entities_filtered{name = "entity-ghost", area = {{5, 15}, {10, 18}}} == 0) then
  result.robotBuilt = {}
  for _, u in ipairs(s.find_entities_filtered{type = "unit", area = {{5, 15}, {10, 18}}}) do
    local info = remote.call("automaton", "robotInfo", u.unit_number)
    result.robotBuilt[#result.robotBuilt + 1] = info and { program = info.program, ore = info.args and info.args.ore } or {}
  end
  log("robots: ticks=" .. wait)
  finish()
end
`

buildMod()
const env = prepareWork("automaton-sim", "automaton-sim")
const markerDir = join(env.work, "mods", "automaton-sim")
writeFileSync(
  join(markerDir, "data-final-fixes.lua"),
  `local constants = data.raw["utility-constants"]["default"]
constants.main_menu_simulations = {
  automaton_blueprints = {
    checkboard = true,
    mods = {"automaton"},
    length = 60 * 60,
    init = ${JSON.stringify(init)},
    update = ${JSON.stringify(update)},
  },
}
`,
)

const outDir = join(env.data, "script-output", "automaton-sim")
const factorio = process.env.FACTORIO_BIN ?? join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")
const game = spawn(factorio, env.common, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SteamAppId: "427520" } })
let output = ""
game.stdout.on("data", (chunk) => (output += chunk))
game.stderr.on("data", (chunk) => (output += chunk))

const started = Date.now()
const resultFile = join(outDir, "result.json")
await new Promise((resolve) => {
  const timer = setInterval(() => {
    if (existsSync(resultFile) || Date.now() - started > TIMEOUT_MS || game.exitCode !== null) {
      clearInterval(timer)
      setTimeout(resolve, 500)
    }
  }, 500)
})
game.kill()
if (!existsSync(resultFile)) {
  console.error(`Симуляция не дала итога (${game.exitCode !== null ? `игра вышла с кодом ${game.exitCode}` : "время вышло"}):\n${scriptError(output)}`)
  process.exit(1)
}
const result = JSON.parse(readFileSync(resultFile, "utf8"))
console.log(JSON.stringify(result, null, 1))

const failures = []
const check = (ok, text) => {
  console.log(`${ok ? "✓" : "✗"} ${text}`)
  if (!ok) failures.push(text)
}
// Пустая таблица Lua приходит из table_to_json как {}, а не [].
const arr = (x) => (Array.isArray(x) ? x : [])
const machines = (list) => arr(list).filter((e) => e.name === "automaton-worker-mk1-placer")
check(result.units === 2, "две машины поставлены")
check(machines(result.blueprint).length === 2, "чертёж рамкой: обе машины в чертеже")
check(arr(result.blueprint).some((e) => e.name === "wooden-chest"), "чертёж рамкой: сундук тоже")
check(machines(result.blueprint).some((e) => e.program === "sim/work"), "чертёж рамкой: программа у машины")
check(result.ghosts === 3, "Ctrl+C и вставка: три призрака (сундук и две машины)")
check(arr(result.built).length === 2, "по чертежу встали две машины")
check(arr(result.built).some((b) => b.program === "sim/work"), "построенная машина — с программой")
check(result.handBuilt === "sim/work", "рукой поверх призрака: машина с программой")
// Ограничение игры: в рамке нет ничего, что игра кладёт в чертёж, — чертёж не создаётся и события нет.
check(machines(result.machinesOnly).length === 0, "рамка над одними машинами: игра чертёж не создаёт (известное ограничение, в рамке нужно здание)")
const robotBuilt = arr(result.robotBuilt)
check(robotBuilt.length === 2, "строительные роботы построили обе машины")
check(robotBuilt.some((r) => r.program === "sim/work" && r.ore === "coal"), "робот: программа и параметры из тега")
check(robotBuilt.some((r) => r.program === undefined), "робот: программы нет у команды — без программы")
if (failures.length > 0) process.exit(1)
