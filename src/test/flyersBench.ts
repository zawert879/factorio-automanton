// Нагрузочный тест летающих (11.6, npm run bench:flyers): N перевозчиков летают между случайными
// точками, по прибытии — сразу следующий рейс. N — из версии служебного мода automaton-bench-flyers
// («0.<N/1000>.0»). Тик 1 — расстановка, дальше замер (время тика считает --benchmark-verbose).
import { MapPosition } from "factorio:runtime"
import { moveRobot, onMoveFinished } from "../automaton/movement"
import { findRobot } from "../automaton/registry"
import { FLYER_MK1, MODELS, TECH } from "../names"

const FLYER = MODELS.find((m) => m.entity === FLYER_MK1)!
const version = script.active_mods["automaton-bench-flyers"] ?? "0.0.0"
const [thousands] = string.match(version, "^%d+%.(%d+)%.")
const N = (tonumber(thousands) ?? 0) * 1000
const AREA = 400

let seed = 12345
/** Свой генератор: одинаковые рейсы в каждом прогоне. */
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

function point(): MapPosition {
  return { x: (random() - 0.5) * AREA, y: (random() - 0.5) * AREA }
}

let arrivals = 0

script.on_nth_tick(1, (event) => {
  if (event.tick !== 1) return
  script.on_nth_tick(1, undefined)
  game.forces.player.technologies[TECH.flying1].researched = true
  const surface = game.get_surface("nauvis")!
  // Машины ставятся только в сгенерированных чанках.
  surface.request_to_generate_chunks({ x: 0, y: 0 }, AREA / 64 + 1)
  surface.force_generate_chunk_requests()
  let created = 0
  for (let i = 0; i < N; i++) {
    const position = point()
    // Заглушка сразу заменяется машиной (raise_built), поэтому create_entity возвращает пустое значение.
    surface.create_entity({ name: FLYER.placer, position, force: "player", raise_built: true })
    const robot = findRobot(surface.find_entities_filtered({ name: FLYER.entity, position, radius: 0.5, limit: 1 })[0])
    if (robot === undefined) continue
    robot.energy = 1e15
    moveRobot(robot, { position: point() })
    created++
  }
  log(`FLYERS: создано ${created} из ${N}`)
})

onMoveFinished((robot) => {
  arrivals++
  moveRobot(robot, { position: point() })
})

script.on_nth_tick(600, (event) => log(`FLYERS: тик ${event.tick}, прибытий ${arrivals}`))
