// Сцена для снимков экрана (npm run shot): машины во всех позах, затем game.take_screenshot.
// Подключается из control.ts, только когда включён служебный мод automaton-visual.
// Снимки — script-output/automaton-visual/*.png; файл done.txt — сигнал, что всё снято.
import { MapPosition, PlayerIndex } from "factorio:runtime"
import { setActivity } from "../automaton/appearance"
import { moveRobot } from "../automaton/movement"
import { say, showProblem } from "../automaton/status"
import { findRobot, RobotRecord } from "../automaton/registry"
import { Activity, BODY_DIRECTIONS, CHARGING_STATION, DISPLAYS, MODELS, TECH, WORKER_MK1, WORKER_MK1_PLACER } from "../names"
import { renameDisplay } from "../world/displays"
import { guiOf } from "../gui/common"
import { openMachine } from "../gui/machine"
import { closePrograms, openPrograms, publishFromWindow, showTypes } from "../gui/programs"
import { openPicker } from "../gui/picker"
import { assignProgram } from "../program/machines"
import { publish, publishProgram } from "../program/store"
import { writeVsCodeFolder } from "../program/sync"

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

/** Снимок экрана игрока с интерфейсом (окна мода). */
function guiShot(name: string): void {
  const player = game.get_player(1 as PlayerIndex)
  if (player === undefined) return
  game.take_screenshot({ player, show_gui: true, resolution: { x: player.display_resolution.width, y: player.display_resolution.height }, zoom: 1, path: `automaton-visual/${name}.png` })
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
    // Игрок — у сцены (после генерации чанков): рядом с ним полёты летающих детализируются.
    // В начале freeplay идёт заставка (крушение корабля) — в ней телепорт не работает.
    const player = game.get_player(1 as PlayerIndex)
    if (player !== undefined) {
      if (player.controller_type === defines.controllers.cutscene) player.exit_cutscene()
      player.teleport({ x: CENTER.x, y: CENTER.y + 15 })
    }
    row("idle", CENTER.y - 6)
    row("mine", CENTER.y)
    // Эти поедут: проверка бега и разворота
    const runner = place({ x: CENTER.x - 12.5, y: CENTER.y + 6 })
    moveRobot(runner, { position: { x: CENTER.x + 14.5, y: CENTER.y + 6 } })
    const climber = place({ x: CENTER.x + 9.5, y: CENTER.y + 12 })
    moveRobot(climber, { position: { x: CENTER.x + 9.5, y: CENTER.y - 12 } })
    // Обычный персонаж рядом — сравнить размер и цвет с игроком.
    nauvis().create_entity({ name: "character", position: { x: CENTER.x - 10.5, y: CENTER.y - 3 }, force: "player" })
    // Модели Mk2 и Mk3 (этап 8) рядом с Mk1 и зарядная станция.
    nauvis().create_entity({ name: MODELS[1].placer, position: { x: CENTER.x - 7.5, y: CENTER.y - 3 }, force: "player", raise_built: true })
    nauvis().create_entity({ name: MODELS[2].placer, position: { x: CENTER.x - 4.5, y: CENTER.y - 3 }, force: "player", raise_built: true })
    nauvis().create_entity({ name: CHARGING_STATION, position: { x: CENTER.x - 1, y: CENTER.y - 3 }, force: "player" })
    // Летающие Mk1 и Mk2 (этап 11): одна висит, вторая летит через площадку.
    nauvis().create_entity({ name: MODELS[5].placer, position: { x: CENTER.x + 8.5, y: CENTER.y - 3 }, force: "player", raise_built: true })
    nauvis().create_entity({ name: MODELS[6].placer, position: { x: CENTER.x - 12.5, y: CENTER.y - 5 }, force: "player", raise_built: true })
    const flyer = findRobot(nauvis().find_entities_filtered({ name: MODELS[6].entity, position: { x: CENTER.x - 12.5, y: CENTER.y - 5 }, radius: 0.5 })[0])!
    moveRobot(flyer, { position: { x: CENTER.x + 30, y: CENTER.y - 5 } })
    // Боевые Mk1 и Mk2 (этап 10).
    nauvis().create_entity({ name: MODELS[3].placer, position: { x: CENTER.x + 2.5, y: CENTER.y - 3 }, force: "player", raise_built: true })
    nauvis().create_entity({ name: MODELS[4].placer, position: { x: CENTER.x + 5.5, y: CENTER.y - 3 }, force: "player", raise_built: true })
    // Здание: машина за ним (должна закрываться им) и перед ним (должна его закрывать).
    nauvis().create_entity({ name: "assembling-machine-1", position: { x: CENTER.x + 2.5, y: CENTER.y + 4.5 }, force: "player" })
    place({ x: CENTER.x + 2.5, y: CENTER.y + 2.6 })
    place({ x: CENTER.x + 2.5, y: CENTER.y + 6.4 })
    // Статус: значки проблем и облачко.
    const problems = ["fuel", "no-path", "full", "warning", "danger"] as const
    for (let i = 0; i < problems.length; i++) showProblem(place({ x: CENTER.x - 10.5 + i * 3, y: CENTER.y + 9 }), problems[i])
    say(place({ x: CENTER.x + 6.5, y: CENTER.y + 9 }), "Привет! Иду за рудой", 10)
  }
  if (tick === 150) shot("a")
  if (tick === 155) shot("building", { x: CENTER.x + 2.5, y: CENTER.y + 4.5 }, 4)
  if (tick === 158) shot("status", { x: CENTER.x + 1, y: CENTER.y + 8 }, 3)
  if (tick === 159) shot("models", { x: CENTER.x - 2, y: CENTER.y - 3.5 }, 3)
  if (tick === 80) shot("flyer", { x: CENTER.x + 2, y: CENTER.y - 4 }, 2)
  if (tick === 160) shot("b")
  // Крупно: бегущие на восток (AM-17) и на север (AM-18).
  if (tick === 170) {
    for (const record of Object.values(storage.robots.byId)) {
      if (record?.activity === "run") shot(`run-${record.name}`, record.entity.position, 5)
    }
  }
  // Окна (этап 5): машина с программой, библиотека программ с ошибкой компиляции, типы для VS Code.
  if (tick === 175) {
    const robot = place({ x: CENTER.x - 4.5, y: CENTER.y - 12 })
    robot.cargo.insert({ name: "iron-ore", count: 17 })
    robot.cargo.insert({ name: "coal", count: 5 })
    const result = publishProgram(
      "Шахтёр",
      `const { ore } = me.args<{ ore: string }>()
let n = 0
while (true) {
  n++
  print("виток", n, "руда:", me.cargo.count("iron-ore"))
  wait(0.2)
}`,
    )
    if (result.ok) assignProgram(robot, result.program)
    storage.machines[robot.id]!.args = { ore: "iron-ore" }
  }
  // Табло (этап 9): большое табло «штаб» с таблицей занятости, полоской и значком.
  if (tick === 177) {
    game.forces.player.technologies[TECH.display].researched = true
    const entity = nauvis().create_entity({ name: DISPLAYS[1].name, position: { x: CENTER.x + 14, y: CENTER.y - 14 }, force: "player", raise_built: true })!
    renameDisplay(storage.displays.byId[entity.unit_number!]!, "штаб")
    const small = nauvis().create_entity({ name: DISPLAYS[0].name, position: { x: CENTER.x + 22.5, y: CENTER.y - 15 }, force: "player", raise_built: true })!
    renameDisplay(storage.displays.byId[small.unit_number!]!, "часы")
    const drawer = place({ x: CENTER.x + 14.5, y: CENTER.y - 10 })
    const result = publishProgram(
      "Табло",
      `const s = display("штаб")
const c = display("часы")
s.frame(() => {
  s.clear("black")
  s.text(4, 4, "Занятость роботов", { color: "yellow", size: 12 })
  s.table(4, 22, [["Робот", "Задача"], ["AM-1", { text: "свободен", color: "green" }], ["AM-2", { text: "руда → печь #12", color: "yellow" }], ["AM-3", { text: "заправка", color: "orange" }]], { header: true })
  s.bar(4, s.height - 12, s.width - 8, 8, 0.66, "green")
  s.icon(170, 4, "iron-plate", 16)
  s.circle(180, 60, 8, { color: "blue", fill: true })
  s.line(150, 80, 190, 100, { color: "red", width: 2 })
})
c.clear({ r: 0.05, g: 0.1, b: 0.2 })
c.text(48, 20, "12:34", { color: "white", size: 24, align: "center" })
for (let x = 10; x < 86; x++) c.pixel(x, 54, x % 2 === 0 ? "green" : "red")`,
    )
    if (result.ok) assignProgram(drawer, result.program)
  }
  if (tick === 200) {
    const player = game.get_player(1 as PlayerIndex)
    const robot = Object.values(storage.robots.byId).find((r) => r !== undefined && storage.machines[r.id] !== undefined)
    if (player !== undefined && robot !== undefined) openMachine(player, robot)
  }
  if (tick === 199) shot("display", { x: CENTER.x + 17, y: CENTER.y - 14 }, 3)
  if (tick === 205) guiShot("machine-window")
  if (tick === 210) {
    const player = game.get_player(1 as PlayerIndex)
    if (player !== undefined) {
      // Дерево папок (этап 17): библиотека в папке и программа, которая её импортирует.
      publish({ name: "lib/Счёт", source: `export function twice(x: number): number {\n  return x * 2\n}` })
      publish({ name: "Добыча/Удвоитель", source: `import { twice } from "../lib/Счёт"\nprint(twice(2))` })
      openPrograms(player, storage.programs.nextId - 1, undefined)
      const window = guiOf(player).programs!
      let lines = ""
      for (let i = 1; i <= 30; i++) lines += `\nprint("строка ${i + 7}")`
      window.code.text = window.code.text + lines + "\nlet x = 1 == 2\n"
      publishFromWindow(player)
    }
  }
  if (tick === 215) guiShot("programs-window")
  if (tick === 220) {
    const player = game.get_player(1 as PlayerIndex)
    if (player !== undefined) showTypes(player)
  }
  if (tick === 225) guiShot("types-window")
  if (tick === 230) {
    const player = game.get_player(1 as PlayerIndex)
    if (player !== undefined) writeVsCodeFolder(player)
  }
  // Окно выбора программы (17.4): из рамки «Программатора» — для нескольких машин.
  if (tick === 232) {
    const player = game.get_player(1 as PlayerIndex)
    const ids = Object.values(storage.robots.byId).filter((r) => r !== undefined).map((r) => r!.id).slice(0, 3)
    if (player !== undefined) {
      player.gui.screen["automaton-types"]?.destroy()
      closePrograms(player)
      openPicker(player, ids, true)
    }
  }
  if (tick === 235) guiShot("picker")
  // Дерево технологий (этап 6): технологии автоматонов на месте «Логистики». Экран технологий в одиночной
  // игре ставит её на паузу — поэтому снимок последний, в том же тике (shot.mjs ждёт файлы ещё пару секунд).
  if (tick === 240) {
    const player = game.get_player(1 as PlayerIndex)
    if (player !== undefined) {
      player.opened = undefined
      player.gui.screen.clear()
      player.open_technology_gui(TECH.radio)
      guiShot("tech-tree")
    }
    helpers.write_file("automaton-visual/done.txt", "done", false)
    script.on_nth_tick(1, undefined)
  }
})
