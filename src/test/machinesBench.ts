// Стресс-тест машин (13.5, npm run bench:machines и bench:scale): N рабочих Mk1 по программе «толпы» —
// поездки по кругу, добыча, сообщения, доска, вычисления. N — из версии служебного мода
// automaton-bench-machines («0.<N>.0»).
// Время тика — из --benchmark-verbose; по обработчикам тика — профилировщик (в лог, BENCHPROF).
import { MapPosition } from "factorio:runtime"
import { findRobot } from "../automaton/registry"
import { startTickProfiling } from "../events"
import { MODELS, TECH } from "../names"
import { assignProgram } from "../program/machines"
import { publishProgram } from "../program/store"

const version = script.active_mods["automaton-bench-machines"] ?? "0.0.0"
const [count, variant] = string.match(version, "^%d+%.(%d+)%.(%d+)")
const N = tonumber(count) ?? 0
/** Вариант «0.N.1» — без рации (subscribe / publish / tryReceive). С рацией — каждая подписана на соседа. */
const RADIO = variant !== "1"

const PROGRAM = `const id = me.id
const base = me.position
const points = [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }]
let i = id % 4
${RADIO ? `const neighbour = robot(id - 1)
if (neighbour !== null) subscribe(neighbour, "толпа")` : ""}
while (true) {
  if (id % 4 === 0) {
    move({ x: base.x, y: base.y + 3 })
    mine("iron-ore", 3)
  } else {
    const p = points[i % 4]
    move({ x: base.x + p.x - 12, y: base.y + p.y - 12 })
  }
  i++
  board.increment("шаги")
  ${RADIO ? `if (i % 3 === 0) publish("толпа", { from: id, i })
  const m = tryReceive<{ from: number; i: number }>("толпа")` : `const m: { data: { from: number } } | null = null`}
  let sum = 0
  for (let k = 0; k < 100; k++) sum += Math.floor(Math.random() * 10)
  if (m !== null && sum < 0) print(m.data.from)
  wait(0.5)
}`

/** Участок машины: 30×30 клеток (программа ездит по квадрату 25×25 вокруг своего места). */
const CELL = 30

script.on_nth_tick(1, (event) => {
  if (event.tick !== 1) return
  script.on_nth_tick(1, undefined)
  game.forces.player.technologies[TECH.radio].researched = true
  const surface = game.get_surface("nauvis")!
  const program = publishProgram("толпа", PROGRAM)
  if (!program.ok) error("программа толпы не компилируется")
  // Квадратная сетка вокруг точки появления: камера (замер FPS) смотрит на машины. Скалы, деревья и руда
  // выключены в генераторе карты (tools/bench/scale.mjs) — расчищать нужно только воду.
  const columns = math.max(1, math.ceil(math.sqrt(N)))
  const rows = math.max(1, math.ceil(N / columns))
  const half = (math.max(columns, rows) * CELL) / 2
  surface.request_to_generate_chunks({ x: 0, y: 0 }, math.ceil(half / 32) + 1)
  surface.force_generate_chunk_requests()
  // Обломки корабля freeplay у точки появления (если сценарий их создал) и огонь от них.
  for (const e of surface.find_entities_filtered({ area: [[-80, -80], [80, 80]] })) {
    if (e.name.startsWith("crash-site") || e.type === "fire") e.destroy()
  }
  let created = 0
  let failed = 0
  for (let i = 0; i < N; i++) {
    const center: MapPosition = {
      x: math.floor((i % columns) - (columns - 1) / 2) * CELL,
      y: math.floor(math.floor(i / columns) - (rows - 1) / 2) * CELL,
    }
    // Вода (её генератор карты не выключает) — только там, где она есть, участок становится травой.
    const area: [[number, number], [number, number]] = [[center.x - 14, center.y - 14], [center.x + 14, center.y + 14]]
    if (surface.count_tiles_filtered({ area, collision_mask: "water_tile" }) > 0) {
      const tiles = []
      for (let x = -14; x < 14; x++) for (let y = -14; y < 14; y++) tiles.push({ name: "grass-1", position: { x: center.x + x, y: center.y + y } })
      surface.set_tiles(tiles, true, true, true)
    }
    for (let x = -2; x <= 2; x++) surface.create_entity({ name: "iron-ore", position: { x: center.x + x + 0.5, y: center.y + 4.5 }, amount: 100000 })
    surface.create_entity({ name: MODELS[0].placer, position: center, force: "player", raise_built: true })
    const entity = surface.find_entities_filtered({ name: MODELS[0].entity, position: center, radius: 3 })[0]
    if (entity === undefined) {
      if (failed++ < 3) log(`MACHINES: не поставилась у ${center.x},${center.y}: клетка ${surface.get_tile(center.x, center.y).name}, рядом ${surface.find_entities_filtered({ position: center, radius: 2 }).map((e) => e.name).join(",")}`)
      continue
    }
    const robot = findRobot(entity)
    if (robot === undefined) continue
    robot.energy = 1e15
    assignProgram(robot, program.program)
    created++
  }
  log(`MACHINES: создано ${created} из ${N}${RADIO ? "" : ", без рации"}`)
  // Замер с окном: камера — у точки появления, отдалена, чтобы в кадре были машины.
  for (const player of game.connected_players) {
    if (player.controller_type === defines.controllers.cutscene) player.exit_cutscene()
    player.teleport({ x: CELL / 2, y: CELL / 2 })
    player.zoom = 0.3
  }
  const totals = startTickProfiling()
  script.on_nth_tick(1700, () => {
    for (const [name, total] of totals) log(["", "BENCHPROF ", name, " ", total])
    log(`MACHINES: шагов на доске ${serpent.line(storage.board.player?.values["шаги"])}`)
  })
  // Снимок кадра с окном — проверить, что камера смотрит на машины.
  script.on_nth_tick(600, () => {
    const player = game.connected_players[0]
    if (player !== undefined) game.take_screenshot({ player, path: `automaton-bench/view-${N}.png`, show_entity_info: true })
  })
})
