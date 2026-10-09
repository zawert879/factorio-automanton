// npm run test:sim (вторая часть) — мастерская схем настоящим игроком (15.4–15.6): вход в режиме без персонажа,
// узел из палитры (чертёж в руке), красный провод кликами, клик по узлу — окно настроек, вырезать и вставить
// с проводом, публикация, выход к персонажу. Игра С ОКНОМ на секунды; итог — result.json.
import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildMod, prepareWork, scriptError } from "./factorio.mjs"

const TIMEOUT_MS = 120_000

const init = `
player = game.simulation.create_test_player{name = "tester"}
player.teleport({0, 6})
game.simulation.camera_player = player
game.simulation.camera_zoom = 1
game.simulation.camera_player_cursor_position = player.position
game.surfaces[1].build_checkerboard{{-30, -20}, {30, 20}}
R = { steps = {} }
local W = "automaton-workshop"
R.enter = remote.call(W, "enter", player.index, "sim/схема")
R.controller = player.controller_type
R.surface = player.surface.name
R.character = player.character == nil
pcall(function() game.simulation.camera_surface_index = player.surface.index end)
game.simulation.camera_position = {20, 6}
step, wait = 1, 0
function graph() return remote.call(W, "graph", "sim/схема") end
function finish()
  helpers.write_file("automaton-sim/result.json", helpers.table_to_json(R), false)
  step = 1000
end
`

const update = `
if step >= 1000 then return end
wait = wait + 1
local sim = game.simulation
local W = "automaton-workshop"
local function at(p) return sim.move_cursor{position = p, speed = 0.8} end
-- 1. Узел «Ждать» из палитры: чертёж в руке, клик — узел с разъёмами.
if step == 1 and wait > 20 then
  remote.call(W, "pick", player.index, "wait")
  R.cursor = player.cursor_stack.valid_for_read and player.cursor_stack.name or "empty"
  step, wait = 2, 0
elseif step == 2 and at({27, 4}) then sim.control_press{control = "build", notify = false}; step, wait = 3, 0
elseif step == 3 and wait > 20 then
  player.clear_cursor()
  local g = graph()
  R.afterPick = #g.nodes
  for _, n in ipairs(g.nodes) do if n.kind == "wait" then waitNode = n.id end end
  R.waitNode = waitNode
  startOut = remote.call(W, "pin", "sim/схема", 1, "out:next")
  waitIn = waitNode and remote.call(W, "pin", "sim/схема", waitNode, "in:exec")
  player.cursor_stack.set_stack{name = "red-wire"}
  step, wait = 4, 0
-- 2. Красный провод: «Старт» → «Ждать».
elseif step == 4 and startOut and at(startOut) then sim.control_press{control = "build", notify = false}; step, wait = 5, 0
elseif step == 5 and wait > 5 and waitIn and at(waitIn) then sim.control_press{control = "build", notify = false}; step, wait = 6, 0
elseif step == 6 and wait > 10 then
  player.cursor_stack.clear()
  R.cursorAfterClear = player.cursor_stack.valid_for_read and player.cursor_stack.name or "empty"
  R.wires = graph().wires
  bodyAt = remote.call(W, "body", "sim/схема", waitNode)
  step, wait = 7, 0
-- 3. Клик по узлу пустой рукой — окно настроек.
elseif step == 7 and bodyAt and at({bodyAt.x, bodyAt.y - 0.6}) then sim.control_press{control = "open-gui", notify = true}; step, wait = 8, 0
elseif step == 8 and wait > 10 then
  R.nodeWindow = player.gui.screen["automaton-workshop-node"] ~= nil
  if player.gui.screen["automaton-workshop-node"] then player.gui.screen["automaton-workshop-node"].destroy() end
  step, wait = 9, 0
-- 4. Вырезать «Ждать» рамкой и вставить ниже: узел на новом месте, провод со «Старта» цел.
elseif step == 9 and wait > 5 then sim.control_press{control = "cut", notify = false}; step, wait = 10, 0
elseif step == 10 and at({bodyAt.x - 3.5, bodyAt.y - 2.5}) then sim.control_down{control = "select-for-blueprint", notify = false}; step, wait = 11, 0
elseif step == 11 and at({bodyAt.x + 3.5, bodyAt.y + 2.5}) then sim.control_up{control = "select-for-blueprint"}; step, wait = 12, 0
elseif step == 12 and wait > 20 then
  R.cutCursor = player.cursor_stack.valid_for_read and player.cursor_stack.name or (player.is_cursor_blueprint() and "record" or "empty")
  step, wait = 13, 0
elseif step == 13 and at({bodyAt.x, bodyAt.y + 10}) then sim.control_press{control = "build", notify = false}; step, wait = 14, 0
elseif step == 14 and wait > 20 then
  player.clear_cursor()
  local g = graph()
  R.afterPaste = { nodes = #g.nodes, wires = g.wires, problems = g.problems }
  for _, n in ipairs(g.nodes) do if n.kind == "wait" then R.movedY = n.y end end
  R.publish = remote.call(W, "publish", player.index)
  step, wait = 15, 0
-- 5. Выйти: снова персонаж на обычной карте.
elseif step == 15 and wait > 10 then
  remote.call(W, "exit", player.index)
  R.exitController = player.controller_type
  R.exitSurface = player.surface.name
  R.exitCharacter = player.character ~= nil
  finish()
end
`

buildMod()
const env = prepareWork("automaton-sim-workshop", "automaton-sim")
writeFileSync(
  join(env.work, "mods", "automaton-sim", "data-final-fixes.lua"),
  `data.raw["utility-constants"]["default"].main_menu_simulations = {
  automaton_workshop = { checkboard = true, mods = {"automaton"}, length = 60 * 60, init = ${JSON.stringify(init)}, update = ${JSON.stringify(update)} },
}
`,
)
const outFile = join(env.data, "script-output", "automaton-sim", "result.json")
const factorio = process.env.FACTORIO_BIN ?? join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")
const game = spawn(factorio, env.common, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SteamAppId: "427520" } })
let output = ""
game.stdout.on("data", (c) => (output += c))
game.stderr.on("data", (c) => (output += c))
const started = Date.now()
await new Promise((resolve) => {
  const t = setInterval(() => {
    if (existsSync(outFile) || Date.now() - started > TIMEOUT_MS || game.exitCode !== null) {
      clearInterval(t)
      setTimeout(resolve, 500)
    }
  }, 500)
})
game.kill()
if (!existsSync(outFile)) {
  console.error(`Симуляция мастерской не дала итога:\n${scriptError(output)}`)
  process.exit(1)
}
const r = JSON.parse(readFileSync(outFile, "utf8"))
console.log(JSON.stringify(r, null, 1))
const arr = (x) => (Array.isArray(x) ? x : [])
const failures = []
const check = (ok, text) => {
  console.log(`${ok ? "✓" : "✗"} ${text}`)
  if (!ok) failures.push(text)
}
check(r.enter === true && r.controller === 2 && r.surface.startsWith("automaton-workshop-") && r.character, "вход: режим без персонажа на поверхности мастерской")
check(r.cursor === "blueprint" && r.afterPick === 2, "палитра: узел в руке чертежом, поставлен кликом")
check(arr(r.wires).includes(`1.next>${r.waitNode}.exec`), "красный провод кликами: «Старт» → «Ждать»")
check(r.nodeWindow === true, "клик по узлу — окно настроек")
check(r.afterPaste?.nodes === 2 && arr(r.afterPaste?.wires).length === 1 && r.afterPaste?.problems === 0, "вырезать и вставить: узел перенесён, провод цел")
check(r.publish?.errors === 0 && r.publish?.version === 2, "публикация из мастерской: новая версия")
check(r.exitController === 1 && r.exitSurface === "nauvis" && r.exitCharacter, "выход: снова персонаж на карте")
if (failures.length > 0) process.exit(1)
