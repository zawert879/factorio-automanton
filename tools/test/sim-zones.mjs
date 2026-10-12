// npm run test:sim (часть) — края зон (21.7) настоящей мышью: игра С ОКНОМ на секунды, тестовый игрок с «Программатором»
// создаёт зону рамкой, тянет правый край, переносит зону за центральную ручку и тянет угол; ручки видны, пока
// инструмент в руке. Нажатие выделения идёт с notify = true — так до мода доходит связанная клавиша, как в игре.
import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildMod, prepareWork, scriptError } from "./factorio.mjs"

const TIMEOUT_MS = 120_000

const init = `
player = game.simulation.create_test_player{name = "tester"}
player.teleport({0, 8})
game.simulation.camera_player = player
game.simulation.camera_zoom = 1
game.simulation.camera_player_cursor_position = player.position
game.surfaces[1].build_checkerboard{{-30, -20}, {30, 20}}
player.cursor_stack.set_stack{name = "automaton-programmer"}
result = {}
step = 1
wait = 0
function zones()
  local list = remote.call("automaton", "zones")
  local a = list[1] and list[1].area
  return { count = #list, area = a and { a.left_top.x, a.left_top.y, a.right_bottom.x, a.right_bottom.y } }
end
function renders() return #rendering.get_all_objects("automaton") end
result.events = {}
script.on_event(defines.events.on_player_selected_area, function(e)
  result.events[#result.events + 1] = { tick = e.tick, step = step, area = { e.area.left_top.x, e.area.left_top.y, e.area.right_bottom.x, e.area.right_bottom.y } }
end)
function finish()
  helpers.write_file("automaton-sim/result.json", helpers.table_to_json(result), false)
  step = 1000
end
`

// Шаги: рамка (нажать в from, протянуть, отпустить в to), затем — записать зоны под именем key.
const update = `
if step >= 1000 then return end
wait = wait + 1
local sim = game.simulation
local function at(x, y) return sim.move_cursor{position = {x, y}, speed = 0.5} end
local drags = {
  { from = {-6, -2}, to = {1.9, 2.9}, key = "created" },
  { from = {2.2, 0.5}, to = {5.4, 0.8}, key = "edge" },
  { from = {-0.5, 0.5}, to = {1.5, 2.5}, key = "moved" },
  { from = {-4.2, -0.2}, to = {-6.4, -1.6}, key = "corner" },
}
local index = math.floor((step - 1) / 4) + 1
local phase = (step - 1) % 4
local d = drags[index]
if d == nil then
  if step < 900 then
    result.rendersHolding = renders()
    player.clear_cursor()
    step, wait = 900, 0
  elseif wait > 10 then
    result.rendersEmpty = renders()
    finish()
  end
  return
end
if phase == 0 and wait > 20 and at(d.from[1], d.from[2]) then
  sim.control_down{control = "select-for-blueprint", notify = true}
  result.events[#result.events + 1] = { tick = game.tick, step = step, down = true }
  step, wait = step + 1, 0
elseif phase == 1 and at(d.to[1], d.to[2]) then
  sim.control_up{control = "select-for-blueprint"}
  result.events[#result.events + 1] = { tick = game.tick, step = step, up = true }
  step, wait = step + 1, 0
-- В симуляции рамка завершается со следующим вводом, а не с отпусканием: чуть сдвинуть курсор, как игрок.
elseif phase == 2 and at(d.to[1] + 0.05, d.to[2]) and wait > 15 then
  result[d.key] = zones()
  -- Новая зона спрашивает имя (поле ввода в фокусе) — закрыть окно, имя остаётся предложенное.
  local naming = player.gui.screen["automaton-naming"]
  if naming then naming.destroy() end
  step, wait = step + 1, 0
elseif phase == 3 and wait > 15 then
  if not (player.cursor_stack.valid_for_read and player.cursor_stack.name == "automaton-programmer") then
    player.cursor_stack.set_stack{name = "automaton-programmer"}
  end
  step, wait = step + 1, 0
end
`

buildMod()
const env = prepareWork("automaton-sim-zones", "automaton-sim")
const markerDir = join(env.work, "mods", "automaton-sim")
writeFileSync(
  join(markerDir, "data-final-fixes.lua"),
  `local constants = data.raw["utility-constants"]["default"]
constants.main_menu_simulations = {
  automaton_zones = {
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
console.log(JSON.stringify(result))

const failures = []
const check = (ok, text) => {
  console.log(`${ok ? "✓" : "✗"} ${text}`)
  if (!ok) failures.push(text)
}
const area = (key) => (result[key]?.area ?? []).join(",")
check(result.created?.count === 1 && area("created") === "-6,-2,2,3", "рамкой создана зона")
check(result.edge?.count === 1 && area("edge") === "-6,-2,5,3", "рамка от правого края двигает край, новой зоны нет")
check(area("moved") === "-4,0,7,5", "рамка от центральной ручки переносит зону")
check(area("corner") === "-6,-2,7,5", "рамка от угла двигает два края")
check(result.rendersHolding > result.rendersEmpty, "ручки видны с «Программатором» в руке и пропадают без него")
if (failures.length > 0) process.exit(1)
