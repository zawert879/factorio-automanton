// Стресс-тест машин (13.5, npm run bench:machines): N рабочих Mk1 по программе «толпы» — поездки по кругу,
// добыча, сообщения, доска, вычисления. N — из версии служебного мода automaton-bench-machines («0.<N>.0»).
// Время тика — из --benchmark-verbose; по обработчикам тика — профилировщик (в лог, BENCHPROF).
import { MapPosition } from "factorio:runtime"
import { findRobot } from "../automaton/registry"
import { startTickProfiling } from "../events"
import { MODELS, TECH } from "../names"
import { assignProgram } from "../program/machines"
import { publishProgram } from "../program/store"

const version = script.active_mods["automaton-bench-machines"] ?? "0.0.0"
const [count] = string.match(version, "^%d+%.(%d+)%.")
const N = tonumber(count) ?? 0

const PROGRAM = `const id = me.id
const base = me.position
const points = [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }]
let i = id % 4
subscribe("толпа")
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
  if (i % 3 === 0) broadcast("толпа", { from: id, i })
  const m = tryReceive<{ from: number; i: number }>("толпа")
  let sum = 0
  for (let k = 0; k < 100; k++) sum += Math.floor(Math.random() * 10)
  if (m !== null && sum < 0) print(m.data.from)
  wait(0.5)
}`

const COLUMNS = 20

script.on_nth_tick(1, (event) => {
  if (event.tick !== 1) return
  script.on_nth_tick(1, undefined)
  game.forces.player.technologies[TECH.radio].researched = true
  const surface = game.get_surface("nauvis")!
  const program = publishProgram("толпа", PROGRAM)
  if (!program.ok) error("программа толпы не компилируется")
  // Участки по 30×30 клеток: в каждом — машина и полоса руды.
  surface.request_to_generate_chunks({ x: 0, y: 0 }, math.ceil((COLUMNS * 30) / 64) + 1)
  surface.force_generate_chunk_requests()
  let created = 0
  for (let i = 0; i < N; i++) {
    const center: MapPosition = { x: (i % COLUMNS) * 30 - (COLUMNS * 30) / 2, y: math.floor(i / COLUMNS) * 30 - 150 }
    const tiles = []
    for (let x = -14; x < 14; x++) for (let y = -14; y < 14; y++) tiles.push({ name: "grass-1", position: { x: center.x + x, y: center.y + y } })
    surface.set_tiles(tiles, true, true, true)
    for (const e of surface.find_entities_filtered({ area: [[center.x - 14, center.y - 14], [center.x + 14, center.y + 14]] })) if (e.type !== "character") e.destroy()
    for (let x = -2; x <= 2; x++) surface.create_entity({ name: "iron-ore", position: { x: center.x + x + 0.5, y: center.y + 4.5 }, amount: 100000 })
    surface.create_entity({ name: MODELS[0].placer, position: center, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position: center, radius: 0.5 })[0])
    if (robot === undefined) continue
    robot.energy = 1e15
    assignProgram(robot, program.program)
    created++
  }
  log(`MACHINES: создано ${created} из ${N}`)
  const totals = startTickProfiling()
  script.on_nth_tick(1700, () => {
    for (const [name, total] of totals) log(["", "BENCHPROF ", name, " ", total])
    log(`MACHINES: шагов на доске ${serpent.line(storage.board.player?.values["шаги"])}`)
  })
})
