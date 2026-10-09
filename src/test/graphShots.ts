// Снимки схем (npm run shot:graphs): программы-примеры, собранные схемами (src/graph/samples.ts), — в своих
// мастерских (схема целиком), мастерская глазами игрока, и сцены, где машины работают по этим схемам: серии
// кадров (из них tools/visual/shot.mjs собирает GIF) и окно машины. Включается служебным модом automaton-graph-shots.
import { MapPosition, PlayerIndex } from "factorio:runtime"
import { findRobot, RobotRecord } from "../automaton/registry"
import { graphToSource } from "../graph/codegen"
import { graphSamples } from "../graph/samples"
import { openMachine } from "../gui/machine"
import { lib } from "../lang/runtime/library"
import { DISPLAYS, MARKER, MODELS, NODE_WIDTH, TECH } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { findProgram, publish, publishProgram } from "../program/store"
import { renameDisplay } from "../world/displays"
import { markerOf, renameMarker } from "../world/markers"
import { createZone } from "../world/zones"
import { ensureWorkshop, nodeCorner, workshopOf } from "../workshop/entities"
import { enterWorkshop, exitWorkshop } from "../workshop/session"
import { Workshop } from "../workshop/state"

const OUT = "automaton-graph-shots"
const samples = graphSamples()

function nauvis() {
  return game.get_surface("nauvis")!
}

function player() {
  return game.get_player(1 as PlayerIndex)
}

// ---------- Схемы в мастерской ----------

/** Вся схема в кадре: рамка узлов, масштаб 1 (большая схема — мельче, не больше 4096 точек). */
function shootWorkshop(ws: Workshop, file: string): void {
  let [left, top, right, bottom] = [math.huge, math.huge, -math.huge, -math.huge]
  for (const [, node] of pairs(ws.nodes)) {
    if (!node.body.valid) continue
    const corner = nodeCorner(node.body)
    const height = node.body.selection_box.right_bottom.y - node.body.selection_box.left_top.y
    left = math.min(left, corner.x)
    top = math.min(top, corner.y)
    right = math.max(right, corner.x + NODE_WIDTH)
    bottom = math.max(bottom, corner.y + height + 1.5)
  }
  const width = right - left + 4
  const height = bottom - top + 4
  const zoom = math.min(1, 4096 / (width * 32), 4096 / (height * 32))
  game.take_screenshot({
    surface: ws.surface,
    position: { x: (left + right) / 2, y: (top + bottom) / 2 },
    resolution: { x: math.ceil(width * 32 * zoom), y: math.ceil(height * 32 * zoom) },
    zoom,
    daytime: 0,
    path: `${OUT}/${file}.png`,
  })
}

function guiShot(name: string): void {
  const p = player()
  if (p === undefined) return
  game.take_screenshot({ player: p, show_gui: true, resolution: { x: p.display_resolution.width, y: p.display_resolution.height }, zoom: 1, path: `${OUT}/${name}.png` })
}

// ---------- Сцены работы ----------

interface WorkScene {
  name: string
  center: MapPosition
}

const SCENES: WorkScene[] = []

function scene(name: string, index: number): (x: number, y: number) => MapPosition {
  const center = { x: 240 + index * 64, y: 0 }
  SCENES.push({ name, center })
  const surface = nauvis()
  surface.request_to_generate_chunks(center, 2)
  surface.force_generate_chunk_requests()
  const [left, top] = [center.x - 28, center.y - 20]
  for (const e of surface.find_entities_filtered({ area: [[left, top], [left + 56, top + 40]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = left; x < left + 56; x++) for (let y = top; y < top + 40; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  return (x, y) => ({ x: center.x + x, y: center.y + y })
}

function ore(name: string, from: MapPosition, w: number, h: number, amount = 1500): void {
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) nauvis().create_entity({ name, position: { x: from.x + x + 0.5, y: from.y + y + 0.5 }, amount })
}

function chest(position: MapPosition, items: [string, number][] = []) {
  const entity = nauvis().create_entity({ name: "iron-chest", position, force: "player" })!
  for (const [name, count] of items) entity.insert({ name, count })
  return entity
}

function marker(name: string, position: MapPosition): void {
  renameMarker(markerOf(nauvis().create_entity({ name: MARKER, position, force: "player", raise_built: true })!)!, name)
}

function machine(position: MapPosition, program: string, args?: string, model = 0): RobotRecord {
  const surface = nauvis()
  surface.create_entity({ name: MODELS[model].placer, position, force: "player", raise_built: true })
  const record = findRobot(surface.find_entities_filtered({ name: MODELS[model].entity, position, radius: 0.5 })[0])!
  record.fuel.insert({ name: "coal", count: 20 })
  if (args !== undefined) machineOf(record.id).args = pcall(lib.JSON.parse, args)[1]
  const found = findProgram(program)
  if (found !== undefined) assignProgram(record, found)
  return record
}

function buildScenes(): void {
  const force = game.forces.player
  for (const tech of [TECH.radio, TECH.display, TECH.fluids, TECH.combat1]) force.technologies[tech].researched = true
  // Тени облаков меняют весь кадр — GIF раздувается.
  nauvis().show_clouds = false

  // Шахтёры (уголь) и копатель (железо, заправка — функцией).
  let at = scene("miners", 0)
  ore("coal", at(-22, -12), 6, 6)
  chest(at(14, -9))
  marker("склад-уголь", at(14, -7))
  // Груз почти полон (без 8 и 16 угля) — за запись шахтёры успеют докопать и довезти уголь до склада.
  for (const [y, room] of [[-10, 8], [-6, 16]] as const) {
    const miner = machine(at(-12, y), "Шахтёр", '{"depot": "склад-уголь"}')
    miner.cargo.insert({ name: "coal", count: 10000 })
    miner.cargo.remove({ name: "coal", count: room })
  }
  ore("iron-ore", at(-22, 4), 6, 6)
  chest(at(6, 10), [["coal", 50]])
  marker("уголь", at(6, 12))
  chest(at(16, 8))
  marker("склад-железо", at(16, 10))
  machine(at(-12, 7), "Копатель", '{"depot": "склад-железо", "coal": "уголь"}')

  // Печник: три печи в зоне, руда и уголь со склада, плиты — в сундук.
  at = scene("smelter", 1)
  for (const x of [-6, 0, 6]) nauvis().create_entity({ name: "stone-furnace", position: at(x, -8), force: "player" })
  createZone("печи", nauvis(), { left_top: at(-9, -11), right_bottom: at(9, -5) })
  chest(at(-16, 6), [["iron-ore", 300], ["coal", 60]])
  marker("склад-печи", at(-16, 8))
  chest(at(16, 6))
  marker("плиты", at(16, 8))
  machine(at(0, 4), "Печник", '{"zone": "печи", "from": "склад-печи", "to": "плиты"}')

  // Водовоз: от озера — в резервуар у котельной.
  at = scene("water", 2)
  const lake = []
  for (let x = -26; x < -16; x++) for (let y = -8; y < 8; y++) lake.push({ name: "water", position: at(x, y) })
  nauvis().set_tiles(lake, true, true, true)
  nauvis().create_entity({ name: "storage-tank", position: at(14, 0), force: "player" })
  marker("котельная", at(10, 4))
  machine(at(-15, 0), "Водовоз", '{"target": "котельная"}')

  // Перевозчик: плиты со склада — в сборщики зоны.
  at = scene("hauler", 3)
  chest(at(-16, 0), [["iron-plate", 400]])
  marker("плиты-склад", at(-16, 2))
  for (const y of [-6, 0, 6]) {
    const assembler = nauvis().create_entity({ name: "assembling-machine-1", position: at(10, y), force: "player" })!
    assembler.set_recipe("iron-gear-wheel")
  }
  createZone("сборка", nauvis(), { left_top: at(6, -10), right_bottom: at(14, 10) })
  machine(at(-8, 0), "Перевозчик", '{"from": "плиты-склад", "to": "сборка"}')

  // Команда: оркестратор раздаёт задачи «руда в печь», рабочие копают и носят; хранитель отвечает про уголь.
  at = scene("team", 4)
  for (const x of [-14, -8]) {
    const furnace = nauvis().create_entity({ name: "stone-furnace", position: at(x, -12), force: "player" })!
    furnace.insert({ name: "coal", count: 20 })
  }
  createZone("печи-2", nauvis(), { left_top: at(-17, -15), right_bottom: at(-5, -9) })
  ore("iron-ore", at(6, 4), 8, 6)
  createZone("поле", nauvis(), { left_top: at(5, 3), right_bottom: at(15, 11) })
  const screen = nauvis().create_entity({ name: DISPLAYS[0].name, position: at(-11, 2), force: "player", raise_built: true })!
  renameDisplay(storage.displays.byId[screen.unit_number!]!, "штаб")
  machine(at(-11, -4), "Оркестратор", '{"zone": "печи-2", "display": "штаб"}')
  machine(at(0, -2), "Рабочий", '{"field": "поле"}')
  machine(at(2, -2), "Рабочий", '{"field": "поле"}')
  chest(at(20, -12), [["coal", 120]])
  machine(at(18, -10), "Хранитель")
  machine(at(14, -10), "Счетовод")

  // Патруль: три поста, арсенал с магазинами.
  at = scene("patrol", 5)
  marker("пост-1", at(-12, -10))
  marker("пост-2", at(12, -10))
  marker("пост-3", at(0, 12))
  chest(at(-20, 8), [["firearm-magazine", 100]])
  createZone("арсенал", nauvis(), { left_top: at(-23, 5), right_bottom: at(-17, 11) })
  machine(at(0, 0), "Патруль", undefined, 3)
}

const FRAME_EVERY = 10
const FRAMES = 120

function shootScenes(frame: number): void {
  for (const s of SCENES) {
    game.take_screenshot({
      surface: nauvis(),
      position: s.center,
      resolution: { x: 1024, y: 640 },
      zoom: 0.62,
      daytime: 0,
      show_entity_info: true,
      path: `${OUT}/${s.name}/${string.format("%03d", frame)}.png`,
    })
  }
}

// ---------- Ход сценария ----------

const WORKSHOP_TICK = 40
const PLAYER_TICK = WORKSHOP_TICK + samples.length * 4 + 10
const SCENES_TICK = PLAYER_TICK + 40
const FRAMES_TICK = SCENES_TICK + 120
const WINDOW_TICK = FRAMES_TICK + FRAMES * FRAME_EVERY + 10
let workshopIndex = 0

script.on_nth_tick(1, (event) => {
  const tick = event.tick
  if (tick === 30) {
    for (const sample of samples) {
      const source = graphToSource(sample.graph, sample.name)
      const result = publish({ name: sample.name, source: source.source, graph: sample.graph, graphLines: source.lineNodes, author: "схема" })
      if (!result.ok) {
        helpers.write_file(`${OUT}/errors.txt`, `${sample.name}: ${result.diagnostics.map((d) => `${d.code}@${d.line}`).join(", ")}\n${source.source}\n`, true)
        continue
      }
      ensureWorkshop(result.program.id, result.program.force, sample.graph)
    }
    // Тот, кто спрашивает хранителя (обычная программа кодом).
    publishProgram(
      "Счетовод",
      `const keeper = scan.robots().find((r) => r.program === "Хранитель")!
while (true) {
  const coal = request<number>(keeper, "сколько", "coal", 10)
  say(\`угля на складе: \${coal}\`, 3)
  wait(4)
}`,
    )
  }
  // Схемы — по одной за кадр.
  if (tick >= WORKSHOP_TICK && tick % 4 === 0 && workshopIndex < samples.length) {
    const sample = samples[workshopIndex++]
    const program = findProgram(sample.name)
    const ws = program === undefined ? undefined : workshopOf(program.id)
    if (ws !== undefined) shootWorkshop(ws, `graph-${workshopIndex}`)
  }
  // Мастерская «Шахтёра» глазами игрока.
  if (tick === PLAYER_TICK) {
    const p = player()
    const program = findProgram(samples[0].name)
    // В начале freeplay идёт заставка (крушение корабля): в ней вход в мастерскую не сработает.
    if (p !== undefined && p.controller_type === defines.controllers.cutscene) p.exit_cutscene()
    if (p !== undefined && program !== undefined) enterWorkshop(p, program)
  }
  if (tick === PLAYER_TICK + 30) guiShot("workshop-player")
  if (tick === SCENES_TICK) {
    const p = player()
    if (p !== undefined) exitWorkshop(p)
    buildScenes()
  }
  if (tick >= FRAMES_TICK && tick < FRAMES_TICK + FRAMES * FRAME_EVERY && (tick - FRAMES_TICK) % FRAME_EVERY === 0) shootScenes((tick - FRAMES_TICK) / FRAME_EVERY)
  // Окно машины со схемой «Шахтёр»: программа, консоль, груз.
  if (tick === WINDOW_TICK) {
    const p = player()
    const robot = Object.values(storage.robots.byId).find((r) => r !== undefined && storage.programs.byId[storage.machines[r.id]?.programId ?? -1]?.name === "Шахтёр")
    if (p !== undefined && robot !== undefined) {
      p.teleport({ x: robot.entity.position.x, y: robot.entity.position.y + 4 })
      openMachine(p, robot)
    }
  }
  if (tick === WINDOW_TICK + 20) guiShot("machine-window")
  if (tick === WINDOW_TICK + 30) {
    // Состояние машин сцен — для проверки, что схемы работают.
    const lines: string[] = []
    for (const [id, record] of pairs(storage.machines)) {
      const program = record.programId === undefined ? "—" : storage.programs.byId[record.programId]?.name ?? "?"
      const e = record.machine.error
      lines.push(`${storage.robots.byId[id]?.name ?? id} ${program}: ${record.machine.status}${e !== undefined ? ` ${e.name}: ${e.message} @${e.line}` : ""} | ${record.console.slice(-4).join(" / ")}`)
    }
    helpers.write_file(`${OUT}/machines.txt`, lines.join("\n"), false)
    helpers.write_file(`${OUT}/done.txt`, "done", false)
    script.on_nth_tick(1, undefined)
  }
})
