// Запись анимаций для документации (npm run docs:record): сохранение с фабрикой науки + сцены с
// летающими, боем и табло. Каждая сцена — серия снимков экрана (game.take_screenshot) в
// script-output/automaton-record/<сцена>/<номер>.png; tools/docs/record.mjs собирает их в GIF.
// Включается служебным модом automaton-record.
import { MapPosition, PlayerIndex } from "factorio:runtime"
import { findRobot } from "../automaton/registry"
import { guiOf } from "../gui/common"
import { editViewLine, openPrograms, publishFromWindow } from "../gui/programs"
import { DISPLAYS, MARKER, MODELS, TECH } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { findProgram, publishProgram } from "../program/store"
import { renameDisplay } from "../world/displays"
import { markerOf, renameMarker } from "../world/markers"
import { lib } from "../lang/runtime/library"

/** Сцена: где снимать, масштаб, через сколько тиков кадр и сколько кадров. */
interface Scene {
  name: string
  position?: MapPosition
  zoom?: number
  every: number
  frames: number
  /** Снимок интерфейса игрока (окна мода), а не карты. */
  gui?: boolean
  /** Перед кадром с этим номером — действие (подготовка интерфейса). */
  before?: Record<number, (this: void) => void>
  resolution?: { x: number; y: number }
}

const FACTORY = { x: 45, y: 0 }
const EXTRA = { x: 150, y: 0 }

function nauvis() {
  return game.get_surface("nauvis")!
}

function player() {
  return game.get_player(1 as PlayerIndex)
}

/** Отдельные сцены рядом с фабрикой: челноки-летуны, бой, табло. */
function setupExtras(): void {
  const surface = nauvis()
  const force = game.forces.player
  for (const tech of [TECH.radio, TECH.display, TECH.combat1, TECH.flying1]) force.technologies[tech].researched = true
  const at = (x: number, y: number): MapPosition => ({ x: EXTRA.x + x, y: EXTRA.y + y })
  surface.request_to_generate_chunks(at(0, 40), 3)
  surface.force_generate_chunk_requests()
  const area = { left_top: at(-25, -20), right_bottom: at(25, 100) }
  for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = -25; x < 25; x++) for (let y = -20; y < 100; y++) tiles.push({ name: "grass-1", position: at(x, y) })
  surface.set_tiles(tiles, true, true, true)

  const robot = (model: number, position: MapPosition, program: string, args?: string) => {
    surface.create_entity({ name: MODELS[model].placer, position, force, raise_built: true })
    const record = findRobot(surface.find_entities_filtered({ name: MODELS[model].entity, position, radius: 0.5 })[0])!
    record.fuel.insert({ name: "coal", count: 20 })
    const found = findProgram(program, "player")!
    if (args !== undefined) machineOf(record.id).args = pcall(lib.JSON.parse, args)[1]
    assignProgram(record, found)
    return record
  }
  const markerAt = (name: string, position: MapPosition) => renameMarker(markerOf(surface.create_entity({ name: MARKER, position, force, raise_built: true })!)!, name)

  // Челноки: шесть летающих между двумя метками.
  markerAt("причал-А", at(-18, -10))
  markerAt("причал-Б", at(18, 8))
  publishProgram("Челнок", `while (true) {\n  move(marker("причал-А"))\n  wait(0.3)\n  move(marker("причал-Б"))\n  wait(0.3)\n}`)
  for (let i = 0; i < 6; i++) robot(5 + (i % 2), at(-18 + i * 2, -10 + (i % 3)), "Челнок")

  // Бой: охранник и кусаки.
  publishProgram("Охрана", `reload()\nguard(me.position, { radius: 20 })`)
  const guard = robot(3, at(0, 45), "Охрана")
  guard.cargo.insert({ name: "piercing-rounds-magazine", count: 20 })

  // Табло со складом: числа и полоска меняются.
  const display = surface.create_entity({ name: DISPLAYS[1].name, position: at(0, 80), force, raise_built: true })!
  renameDisplay(storage.displays.byId[display.unit_number!]!, "склад")
  publishProgram(
    "Табло склада",
    `const s = display("склад")
let n = 0
while (true) {
  n++
  s.frame(() => {
    s.clear("black")
    s.text(4, 4, "Склад", { color: "yellow", size: 12 })
    s.icon(170, 4, "iron-plate", 16)
    s.table(4, 24, [["Уголь", String(300 + n * 3)], ["Железо", String(120 + n * 2)], ["Медь", String(80 + n)], ["Машин", { text: String(17), color: "green" }]], { size: 10 })
    s.bar(4, 110, 184, 10, (n % 25) / 25, "green")
  })
  wait(0.2)
}`,
  )
  robot(0, at(4, 86), "Табло склада")
}

/** Кусаки на охранника — перед сценой боя. */
function releaseBiters(): void {
  const surface = nauvis()
  const target = surface.find_entities_filtered({ name: MODELS[3].entity, position: { x: EXTRA.x, y: EXTRA.y + 45 }, radius: 3 })[0]
  for (let i = 0; i < 5; i++) {
    const biter = surface.create_entity({ name: "small-biter", position: { x: EXTRA.x - 16 + i * 1.5, y: EXTRA.y + 30 + (i % 2) * 2 }, force: "enemy" })
    if (biter !== undefined && target !== undefined) biter.commandable!.set_command({ type: defines.command.attack, target, distraction: defines.distraction.none })
  }
}

/**
 * Редактор: просмотр с подсветкой — правка строки (ошибки в коде) — публикация (ошибки красным в строках) —
 * исправление — публикация.
 */
function editorStep(step: number): void {
  const p = player()
  if (p === undefined) return
  if (step === 0) openPrograms(p, findProgram("Шахтёр", "player")!.id, undefined)
  if (step === 1) {
    const window = guiOf(p).programs!
    const source = findProgram("Шахтёр", "player")!.source
    window.code.text = source.replace("move(field);", "mov(field);").replace('mine(item);', 'mine(item, "много");')
    editViewLine(p, source.split("\n").findIndex((line) => line.includes("move(field);")) + 1)
  }
  if (step === 2) publishFromWindow(p)
  if (step === 3) {
    const window = guiOf(p).programs!
    window.code.text = findProgram("Шахтёр", "player")!.source
    publishFromWindow(p)
  }
}

const SCENES: Scene[] = [
  { name: "factory", position: { x: FACTORY.x + 5, y: FACTORY.y + 5 }, zoom: 0.26, every: 20, frames: 48, resolution: { x: 640, y: 360 } },
  { name: "miners", position: { x: FACTORY.x - 23, y: FACTORY.y + 16 }, zoom: 0.98, every: 4, frames: 80 },
  { name: "smelting", position: { x: FACTORY.x + 3, y: FACTORY.y + 9 }, zoom: 0.8, every: 6, frames: 40, resolution: { x: 640, y: 360 } },
  { name: "assembly", position: { x: FACTORY.x + 15, y: FACTORY.y - 8 }, zoom: 0.53, every: 8, frames: 50, resolution: { x: 640, y: 360 } },
  { name: "water", position: { x: FACTORY.x - 25, y: FACTORY.y + 3 }, zoom: 0.8, every: 6, frames: 40, resolution: { x: 640, y: 360 } },
  { name: "flyers", position: { x: EXTRA.x, y: EXTRA.y - 1 }, zoom: 0.68, every: 3, frames: 70 },
  { name: "combat", position: { x: EXTRA.x - 6, y: EXTRA.y + 40 }, zoom: 0.98, every: 3, frames: 70, before: { 0: () => releaseBiters() } },
  { name: "display", position: { x: EXTRA.x + 1, y: EXTRA.y + 82 }, zoom: 1.2, every: 6, frames: 30 },
  {
    name: "editor",
    gui: true,
    every: 60,
    frames: 4,
    before: { 0: () => editorStep(0), 1: () => editorStep(1), 2: () => editorStep(2), 3: () => editorStep(3) },
  },
]

const RESOLUTION = { x: 720, y: 405 }
const START_DELAY = 120

let start: number | undefined
let schedule: { tick: number; scene: Scene; frame: number }[] = []

function shoot(scene: Scene, frame: number): void {
  scene.before?.[frame]?.()
  const path = `automaton-record/${scene.name}/${string.format("%04d", frame)}.png`
  if (scene.gui) {
    const p = player()
    if (p === undefined) return
    game.take_screenshot({ player: p, show_gui: true, resolution: { x: p.display_resolution.width, y: p.display_resolution.height }, zoom: 1, path })
    return
  }
  game.take_screenshot({
    surface: nauvis(),
    position: scene.position!,
    resolution: scene.resolution ?? RESOLUTION,
    zoom: scene.zoom ?? 1,
    path,
    show_entity_info: true,
    daytime: 0,
    anti_alias: true,
  })
}

script.on_nth_tick(1, (event) => {
  if (start === undefined) {
    start = event.tick
    setupExtras()
    const p = player()
    if (p !== undefined) {
      if (p.controller_type === defines.controllers.cutscene) p.exit_cutscene()
      p.teleport({ x: (FACTORY.x + EXTRA.x) / 2, y: 20 })
    }
    // Расписание: сцены по очереди, между ними — пауза.
    let tick = event.tick + START_DELAY
    for (const scene of SCENES) {
      for (let frame = 0; frame < scene.frames; frame++) schedule.push({ tick: tick + frame * scene.every, scene, frame })
      tick += scene.frames * scene.every + 30
    }
    schedule.push({ tick, scene: { name: "done", every: 1, frames: 0 }, frame: -1 })
    return
  }
  while (schedule.length > 0 && schedule[0].tick <= event.tick) {
    const item = schedule.shift()!
    if (item.frame < 0) {
      helpers.write_file("automaton-record/done.txt", "done", false)
      schedule = []
      return
    }
    shoot(item.scene, item.frame)
  }
})
