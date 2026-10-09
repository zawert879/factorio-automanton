// 15.2 — прототип мастерской: что позволяет игра (node tools/spike/workshop.mjs, игра с окном на секунды).
// Тестовый игрок в симуляции главного меню: режим без персонажа на своей поверхности, разъёмы и узел рукой,
// провод кликами, клик по узлу (open-gui), вырезать и вставить, возврат к персонажу, удалённый вид. Итог — JSON.
import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildMod, prepareWork, scriptError } from "../test/factorio.mjs"

const data = `
local pin = table.deepcopy(data.raw["constant-combinator"]["constant-combinator"])
pin.name = "spike-pin"
pin.minable = {mining_time = 0.1, result = "spike-pin"}
pin.collision_box = {{-0.3, -0.3}, {0.3, 0.3}}
pin.selection_box = {{-0.4, -0.4}, {0.4, 0.4}}
local pinItem = table.deepcopy(data.raw.item["constant-combinator"])
pinItem.name = "spike-pin"
pinItem.place_result = "spike-pin"
local node = table.deepcopy(data.raw["simple-entity-with-owner"]["simple-entity-with-owner"])
node.name = "spike-node"
node.minable = {mining_time = 0.1, result = "spike-node"}
data:extend({pin, pinItem, node,
  {type = "item", name = "spike-node", icon = "__base__/graphics/icons/steel-chest.png", icon_size = 64, stack_size = 50, place_result = "spike-node"},
  {type = "custom-input", name = "spike-open", key_sequence = "", linked_game_control = "open-gui"},
})
`

const init = `
player = game.simulation.create_test_player{name = "tester"}
player.teleport({0, 4})
game.simulation.camera_player = player
game.simulation.camera_zoom = 1
game.simulation.camera_player_cursor_position = player.position
R = { steps = {}, errors = {} }
function log(t) R.steps[#R.steps + 1] = t end
function try(name, f) local ok, err = pcall(f) if not ok then R.errors[#R.errors + 1] = name .. ": " .. tostring(err) end return ok end
ws = game.create_surface("spike-ws", {width = 200, height = 200, peaceful_mode = true})
try("lab", function() ws.generate_with_lab_tiles = true end)
ws.always_day = true
ws.request_to_generate_chunks({0, 0}, 2)
ws.force_generate_chunk_requests()
R.tile = ws.get_tile(0, 0).name
character = player.character
step, wait = 1, 0
script.on_event("spike-open", function(e)
  local sel = game.get_player(e.player_index).selected
  R.opened = R.opened or {}
  R.opened[#R.opened + 1] = sel and sel.name or "nil"
end)
function pins(surface, filter)
  local out = {}
  for _, p in ipairs(surface.find_entities_filtered(filter or {name = "spike-pin"})) do
    local to = {}
    for _, id in ipairs({defines.wire_connector_id.circuit_red, defines.wire_connector_id.circuit_green}) do
      local c = p.get_wire_connector(id, false)
      if c then for _, conn in ipairs(c.connections) do to[#to + 1] = (id == defines.wire_connector_id.circuit_red and "r" or "g") .. "@" .. conn.target.owner.position.x .. "," .. conn.target.owner.position.y end end
    end
    out[#out + 1] = { name = p.name, ghost = p.name == "entity-ghost", x = p.position.x, y = p.position.y, to = to, decon = p.to_be_deconstructed() }
  end
  return out
end
function finish() helpers.write_file("automaton-spike/result.json", helpers.table_to_json(R), false); step = 1000 end
`

const update = `
if step >= 1000 then return end
wait = wait + 1
local sim = game.simulation
local function at(x, y) return sim.move_cursor{position = {x, y}, speed = 0.6} end
-- 1. Режим без персонажа (god) на поверхности мастерской.
if step == 1 and wait > 10 then
  try("god", function() player.set_controller{type = defines.controllers.god} end)
  try("god-teleport", function() player.teleport({0, 0}, ws) end)
  try("camera-surface", function() sim.camera_surface_index = ws.index end)
  R.god = { surface = player.surface.name, controller = player.controller_type, character_valid = character and character.valid, character_surface = character and character.surface.name }
  try("god-cursor", function() player.cursor_stack.set_stack{name = "spike-pin", count = 10} end)
  step, wait = 2, 0
elseif step == 2 and at(-3.5, 0.5) then sim.control_press{control = "build", notify = false}; step, wait = 3, 0
elseif step == 3 and wait > 5 and at(2.5, 0.5) then sim.control_press{control = "build", notify = false}; step, wait = 4, 0
elseif step == 4 and wait > 5 then
  try("node-cursor", function() player.cursor_stack.set_stack{name = "spike-node", count = 5} end)
  step, wait = 5, 0
elseif step == 5 and at(-0.5, 3.5) then sim.control_press{control = "build", notify = false}; step, wait = 6, 0
elseif step == 6 and wait > 5 then
  R.godBuilt = pins(ws, {name = {"spike-pin", "spike-node", "entity-ghost"}})
  player.clear_cursor()
  try("red-wire", function() player.cursor_stack.set_stack{name = "red-wire"} end)
  R.wireCursor = player.cursor_stack.valid_for_read and player.cursor_stack.name or "empty"
  step, wait = 7, 0
-- 2. Провод рукой: клик по разъёму, клик по второму.
elseif step == 7 and at(-3.5, 0.5) then sim.control_press{control = "build", notify = false}; step, wait = 8, 0
elseif step == 8 and wait > 5 and at(2.5, 0.5) then sim.control_press{control = "build", notify = false}; step, wait = 9, 0
elseif step == 9 and wait > 5 then
  R.wiredByClick = pins(ws)
  if #R.wiredByClick > 0 and #R.wiredByClick[1].to == 0 then
    try("drag_wire", function() R.drag1 = player.drag_wire{position = {-3.5, 0.5}}; R.drag2 = player.drag_wire{position = {2.5, 0.5}} end)
    R.wiredByDrag = pins(ws)
  end
  player.clear_cursor()
  step, wait = 10, 0
-- 3. Клик по узлу — событие open-gui.
elseif step == 10 and at(-0.5, 3.5) then
  R.selectedNode = player.selected and player.selected.name or "nil"
  sim.control_press{control = "open-gui", notify = true}
  step, wait = 11, 0
elseif step == 11 and wait > 10 then
  R.openedGui = player.opened and (player.opened.name or player.opened_gui_type) or tostring(player.opened_gui_type)
  player.opened = nil
  step, wait = 20, 0
-- 4. Вырезать и вставить (Ctrl+X, Ctrl+V): провода и что делать с призраками.
elseif step == 20 and wait > 5 then sim.control_press{control = "cut", notify = false}; step, wait = 21, 0
elseif step == 21 and at(-5, -1.5) then sim.control_down{control = "select-for-blueprint", notify = false}; step, wait = 22, 0
elseif step == 22 and at(4, 5) then sim.control_up{control = "select-for-blueprint"}; step, wait = 23, 0
elseif step == 23 and wait > 20 then
  R.cutCursor = player.cursor_stack.valid_for_read and player.cursor_stack.name or (player.is_cursor_blueprint() and "blueprint-record" or "empty")
  R.afterCut = pins(ws, {name = {"spike-pin", "spike-node"}})
  step, wait = 24, 0
elseif step == 24 and at(0.5, 10.5) then sim.control_press{control = "build", notify = false}; step, wait = 25, 0
elseif step == 25 and wait > 20 then
  R.pastedGhosts = pins(ws, {name = "entity-ghost"})
  local revived = 0
  for _, g in ipairs(ws.find_entities_filtered{name = "entity-ghost"}) do if g.revive() then revived = revived + 1 end end
  R.revived = revived
  for _, e in ipairs(ws.find_entities_filtered{to_be_deconstructed = true}) do e.destroy() end
  R.afterPaste = pins(ws)
  player.clear_cursor()
  step, wait = 30, 0
-- 5. Назад к персонажу; узел на обычной карте поставить нельзя.
elseif step == 30 and wait > 5 then
  try("back", function() player.teleport({0, 4}, game.surfaces[1]); player.set_controller{type = defines.controllers.character, character = character} end)
  try("camera-back", function() sim.camera_surface_index = 1 end)
  R.back = { surface = player.surface.name, same = player.character == character, controller = player.controller_type }
  R.canPlaceNauvis = game.surfaces[1].can_place_entity{name = "spike-pin", position = {3.5, 6.5}, force = "player", build_check_type = defines.build_check_type.manual}
  try("nauvis-cursor", function() player.cursor_stack.set_stack{name = "spike-pin", count = 5} end)
  step, wait = 31, 0
elseif step == 31 and at(2.5, 2.5) then sim.control_press{control = "build", notify = false}; step, wait = 32, 0
elseif step == 32 and wait > 10 then
  R.nauvisPins = #game.surfaces[1].find_entities_filtered{name = "spike-pin"}
  player.clear_cursor()
  step, wait = 40, 0
-- 6. Удалённый вид на мастерскую: призраки и провода.
elseif step == 40 and wait > 5 then
  try("remote", function() player.set_controller{type = defines.controllers.remote, surface = ws, position = {0, 20}} end)
  try("camera-ws", function() sim.camera_surface_index = ws.index; sim.camera_position = {0, 20} end)
  R.remote = { surface = player.surface.name, physical = player.physical_surface.name, controller = player.controller_type }
  try("cursor_ghost", function() player.cursor_ghost = "spike-pin" end)
  step, wait = 41, 0
elseif step == 41 and at(-2.5, 20.5) then sim.control_press{control = "build", notify = false}; step, wait = 42, 0
elseif step == 42 and wait > 5 and at(1.5, 20.5) then sim.control_press{control = "build", notify = false}; step, wait = 43, 0
elseif step == 43 and wait > 10 then
  R.remoteGhosts = pins(ws, {name = "entity-ghost", area = {{-6, 18}, {6, 23}}})
  for _, g in ipairs(ws.find_entities_filtered{name = "entity-ghost", area = {{-6, 18}, {6, 23}}}) do g.revive() end
  player.clear_cursor()
  try("remote-wire", function() player.cursor_stack.set_stack{name = "green-wire"} end)
  R.remoteWireCursor = player.cursor_stack.valid_for_read and player.cursor_stack.name or "empty"
  step, wait = 44, 0
elseif step == 44 and at(-2.5, 20.5) then sim.control_press{control = "build", notify = false}; step, wait = 45, 0
elseif step == 45 and wait > 5 and at(1.5, 20.5) then sim.control_press{control = "build", notify = false}; step, wait = 46, 0
elseif step == 46 and wait > 10 then
  R.remoteWired = pins(ws, {name = "spike-pin", area = {{-6, 18}, {6, 23}}})
  player.clear_cursor()
  try("exit-remote", function() player.exit_remote_view() end)
  R.afterRemote = { surface = player.surface.name, controller = player.controller_type }
  finish()
end
`

buildMod()
const env = prepareWork("automaton-spike", "automaton-spike")
const dir = join(env.work, "mods", "automaton-spike")
writeFileSync(join(dir, "data.lua"), data)
writeFileSync(
  join(dir, "data-final-fixes.lua"),
  `data.raw["utility-constants"]["default"].main_menu_simulations = {
  spike = { checkboard = true, mods = {"automaton-spike"}, length = 60 * 60, init = ${JSON.stringify(init)}, update = ${JSON.stringify(update)} },
}
`,
)
const outFile = join(env.data, "script-output", "automaton-spike", "result.json")
const factorio = join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")
const game = spawn(factorio, env.common, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SteamAppId: "427520" } })
let output = ""
game.stdout.on("data", (c) => (output += c))
game.stderr.on("data", (c) => (output += c))
const started = Date.now()
await new Promise((resolve) => {
  const t = setInterval(() => {
    if (existsSync(outFile) || Date.now() - started > 90_000 || game.exitCode !== null) { clearInterval(t); setTimeout(resolve, 500) }
  }, 500)
})
game.kill()
if (!existsSync(outFile)) {
  console.error(`нет итога (${game.exitCode})\n${scriptError(output)}\n${output.split("\n").filter((l) => /Error|error|Ошибка/.test(l)).slice(0, 20).join("\n")}`)
  process.exit(1)
}
console.log(JSON.stringify(JSON.parse(readFileSync(outFile, "utf8")), null, 1))
