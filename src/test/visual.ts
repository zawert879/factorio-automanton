// Сцена для снимков экрана (npm run shot): машины во всех позах, затем game.take_screenshot.
// Подключается из control.ts, только когда включён служебный мод automaton-visual.
// Снимки — script-output/automaton-visual/*.png; файл done.txt — сигнал, что всё снято.
import { MapPosition } from "factorio:runtime"
import { setActivity } from "../automaton/appearance"
import { moveRobot } from "../automaton/movement"
import { findRobot, RobotRecord } from "../automaton/registry"
import { Activity, BODY_DIRECTIONS, WORKER_MK1, WORKER_MK1_PLACER } from "../names"

const CENTER = { x: 300, y: 300 }

function nauvis() {
  return game.get_surface("nauvis")!
}

function arena(): void {
  const surface = nauvis()
  surface.request_to_generate_chunks(CENTER, 3)
  surface.force_generate_chunk_requests()
  const left = CENTER.x - 30
  const top = CENTER.y - 20
  for (const entity of surface.find_entities_filtered({ area: [[left, top], [left + 60, top + 40]] })) {
    if (entity.type !== "character") entity.destroy()
  }
  const tiles = []
  for (let x = left; x < left + 60; x++) for (let y = top; y < top + 40; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
}

function place(position: MapPosition): RobotRecord {
  nauvis().create_entity({ name: WORKER_MK1_PLACER, position, force: "player", raise_built: true })
  return findRobot(nauvis().find_entities_filtered({ name: WORKER_MK1, position, radius: 0.5 })[0])!
}

/** Ряд машин в одном занятии, по одной на каждое из 8 направлений. */
function row(activity: Activity, y: number): void {
  for (let direction = 0; direction < BODY_DIRECTIONS; direction++) {
    setActivity(place({ x: CENTER.x - 10.5 + direction * 3, y }), activity, direction)
  }
}

function shot(name: string, position: MapPosition = { x: CENTER.x, y: CENTER.y - 1 }, zoom = 2): void {
  game.take_screenshot({
    surface: nauvis(),
    position,
    resolution: { x: 1600, y: 900 },
    zoom,
    daytime: 0,
    path: `automaton-visual/${name}.png`,
    show_entity_info: true,
  })
}

script.on_nth_tick(1, (event) => {
  const tick = event.tick
  if (tick === 30) {
    arena()
    row("idle", CENTER.y - 6)
    row("mine", CENTER.y)
    // Эти поедут: проверка бега и разворота
    const runner = place({ x: CENTER.x - 12.5, y: CENTER.y + 6 })
    moveRobot(runner, { position: { x: CENTER.x + 14.5, y: CENTER.y + 6 } })
    const climber = place({ x: CENTER.x + 9.5, y: CENTER.y + 12 })
    moveRobot(climber, { position: { x: CENTER.x + 9.5, y: CENTER.y - 12 } })
    // Обычный персонаж рядом — сравнить размер и цвет с игроком.
    nauvis().create_entity({ name: "character", position: { x: CENTER.x - 10.5, y: CENTER.y - 3 }, force: "player" })
    // Здание: машина за ним (должна закрываться им) и перед ним (должна его закрывать).
    nauvis().create_entity({ name: "assembling-machine-1", position: { x: CENTER.x + 2.5, y: CENTER.y + 4.5 }, force: "player" })
    place({ x: CENTER.x + 2.5, y: CENTER.y + 2.6 })
    place({ x: CENTER.x + 2.5, y: CENTER.y + 6.4 })
  }
  if (tick === 150) shot("a")
  if (tick === 155) shot("building", { x: CENTER.x + 2.5, y: CENTER.y + 4.5 }, 4)
  if (tick === 160) shot("b")
  // Крупно: бегущие на восток (AM-17) и на север (AM-18).
  if (tick === 170) {
    for (const record of Object.values(storage.robots.byId)) {
      if (record?.activity === "run") shot(`run-${record.name}`, record.entity.position, 5)
    }
  }
  if (tick === 240) {
    helpers.write_file("automaton-visual/done.txt", "done", false)
    script.on_nth_tick(1, undefined)
  }
})
