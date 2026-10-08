// Демо-фабрика красной и зелёной науки (/am-science, сохранение automaton-science): честная цепочка
// без конвейеров — добыча угля, железа и меди, плавка, котельная (воду возит «Водовоз»), сборщики
// шестерён, провода, схем, красной и зелёной науки, лаборатории. Всю логистику делают машины по
// стартовым программам «Добытчик», «Перевозчик» и «Водовоз» с параметрами.
import { LuaForce, LuaSurface, MapPosition } from "factorio:runtime"
import { findRobot } from "../automaton/registry"
import { lib } from "../lang/runtime/library"
import { MARKER, MODELS, TECH } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { findProgram } from "../program/store"
import { markerOf, renameMarker } from "./markers"
import { createZone } from "./zones"

/** Прямоугольник фабрики относительно начала. */
const AREA = { left: -36, top: -26, right: 46, bottom: 30 }

/** Исследования, без которых цепочка не работает (рецепты сборщиков, жидкости, цель для лабораторий). */
const RESEARCH = ["automation", "electronics", "automation-science-pack", "logistic-science-pack", "steam-power", TECH.fluids, TECH.radio]
const TARGET_RESEARCH = TECH.construction

type Route = { item: string; from: { marker?: string; zone?: string }; to: { marker?: string; zone?: string }; keep?: number; batch?: number }

export function buildScienceDemo(surface: LuaSurface, origin: MapPosition, force: LuaForce): string {
  const at = (x: number, y: number): MapPosition => ({ x: origin.x + x, y: origin.y + y })
  const area = { left_top: at(AREA.left, AREA.top), right_bottom: at(AREA.right, AREA.bottom) }

  // Местность: трава без деревьев и камней; озеро для водовоза.
  surface.request_to_generate_chunks(at(5, 0), 3)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area })) if (e.type !== "character") e.destroy()
  const tiles: { name: string; position: MapPosition }[] = []
  for (let x = AREA.left; x < AREA.right; x++) {
    for (let y = AREA.top; y < AREA.bottom; y++) {
      const lake = x >= -34 && x < -27 && y >= -2 && y < 8
      tiles.push({ name: lake ? "water" : "grass-1", position: at(x, y) })
    }
  }
  surface.set_tiles(tiles, true, true, true)
  for (const name of RESEARCH) force.technologies[name].researched = true

  // Месторождения.
  const patch = (name: string, x0: number, y0: number, w: number, h: number) => {
    for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) surface.create_entity({ name, position: at(x + 0.5, y + 0.5), amount: 20000 })
  }
  patch("coal", -30, 16, 6, 6)
  patch("iron-ore", -2, 20, 8, 7)
  patch("copper-ore", 16, 20, 8, 7)

  const build = (name: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
    surface.create_entity({ name, position: at(x, y), force, raise_built: true, ...extra } as never)!
  const markerAt = (name: string, x: number, y: number) => {
    const entity = build(MARKER, x, y)
    renameMarker(markerOf(entity)!, name)
  }
  const chest = (name: string, x: number, y: number) => {
    const entity = build("wooden-chest", x, y)
    markerAt(name, x + 2, y)
    return entity
  }
  const zoneAround = (name: string, x0: number, y0: number, x1: number, y1: number) =>
    createZone(name, surface, { left_top: at(x0, y0), right_bottom: at(x1, y1) })

  // Склады.
  // Стартовый запас угля: пока шахтёры не разогнались, им топятся печи, котёл и машины.
  chest("уголь", -20.5, 14.5).insert({ name: "coal", count: 300 })
  chest("железная руда", 2.5, 16.5)
  chest("медная руда", 20.5, 16.5)
  chest("железо", 2.5, 2.5)
  chest("медь", 19.5, 2.5)
  chest("наука", 40.5, -4.5)

  // Котельная: котёл и две паровые машины, воду возит водовоз прямо в котёл.
  build("boiler", -19.5, 4, { direction: defines.direction.north }).insert({ name: "coal", count: 20 })
  build("steam-engine", -19.5, 0.5, { direction: defines.direction.north })
  build("steam-engine", -19.5, -4.5, { direction: defines.direction.north })
  markerAt("котельная", -23.5, 4.5)
  // Сундук угля у котельной: перевозчик кладёт туда остаток, водовоз заправляется оттуда.
  build("wooden-chest", -23.5, 2.5)
  zoneAround("котельная", -24, 1.5, -17, 5.5)

  // Печи.
  for (const x of [-2, 1, 4, 7]) build("stone-furnace", x, 8).insert({ name: "coal", count: 5 })
  zoneAround("печи-железо", -3.5, 6.5, 8.5, 9.5)
  for (const x of [16, 19, 22]) build("stone-furnace", x, 8).insert({ name: "coal", count: 5 })
  zoneAround("печи-медь", 14.5, 6.5, 23.5, 9.5)

  // Сборщики с рецептами и лаборатории; питание — подстанции.
  const assembler = (recipe: string, x: number) => {
    const e = build("assembling-machine-1", x, -10.5)
    e.set_recipe(recipe)
  }
  assembler("iron-gear-wheel", -4.5)
  zoneAround("шестерни", -6, -12, -3, -9)
  assembler("copper-cable", 0.5)
  zoneAround("провод", -1, -12, 2, -9)
  assembler("electronic-circuit", 5.5)
  zoneAround("схемы", 4, -12, 7, -9)
  assembler("automation-science-pack", 10.5)
  assembler("automation-science-pack", 15.5)
  zoneAround("красная", 9, -12, 17, -9)
  assembler("logistic-science-pack", 20.5)
  assembler("logistic-science-pack", 25.5)
  zoneAround("зелёная", 19, -12, 27, -9)
  build("lab", 30.5, -10.5)
  build("lab", 35.5, -10.5)
  zoneAround("лаборатории", 29, -12, 37, -9)
  for (const [x, y] of [
    [-12, -4],
    [0, -15],
    [16, -15],
    [32, -15],
  ]) build("substation", x, y)
  force.add_research(TARGET_RESEARCH)

  // Машины.
  const robot = (program: string, x: number, y: number, args: string) => {
    const position = surface.find_non_colliding_position(MODELS[0].entity, at(x, y), 6, 0.5)!
    surface.create_entity({ name: MODELS[0].placer, position, force, raise_built: true })
    const record = findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position, radius: 0.5 })[0])!
    record.fuel.insert({ name: "coal", count: 50 })
    const found = findProgram(program, force.name)
    if (found === undefined) error(`нет стартовой программы ${program}`)
    const [ok, value] = pcall(lib.JSON.parse, args)
    if (!ok) error(`параметры ${program}: ${tostring(value)}`)
    const machine = machineOf(record.id)
    machine.args = value
    assignProgram(record, found)
    return record
  }
  const routes = (list: Route[]) => helpers.table_to_json({ routes: list } as never)

  for (const y of [15, 17, 19, 21]) robot("Добытчик", -24, y, `{"ore": "coal", "depot": "уголь"}`)
  for (const x of [0, 3, 6]) robot("Добытчик", x, 19, `{"ore": "iron-ore", "depot": "железная руда"}`)
  for (const x of [18, 22]) robot("Добытчик", x, 19, `{"ore": "copper-ore", "depot": "медная руда"}`)
  robot("Водовоз", -26, 2, `{"target": "котельная"}`)

  robot("Перевозчик", 0, 12, routes([
    { item: "iron-ore", from: { marker: "железная руда" }, to: { zone: "печи-железо" }, keep: 20, batch: 80 },
    { item: "coal", from: { marker: "уголь" }, to: { zone: "печи-железо" }, keep: 5, batch: 20 },
    { item: "iron-plate", from: { zone: "печи-железо" }, to: { marker: "железо" } },
  ]))
  robot("Перевозчик", 18, 12, routes([
    { item: "copper-ore", from: { marker: "медная руда" }, to: { zone: "печи-медь" }, keep: 20, batch: 60 },
    { item: "coal", from: { marker: "уголь" }, to: { zone: "печи-медь" }, keep: 5, batch: 15 },
    { item: "copper-plate", from: { zone: "печи-медь" }, to: { marker: "медь" } },
  ]))
  robot("Перевозчик", -10, 6, routes([
    { item: "coal", from: { marker: "уголь" }, to: { zone: "котельная" }, keep: 20, batch: 40 },
    { item: "copper-plate", from: { marker: "медь" }, to: { zone: "провод" }, keep: 20, batch: 40 },
    { item: "copper-plate", from: { marker: "медь" }, to: { zone: "красная" }, keep: 10, batch: 20 },
  ]))
  robot("Перевозчик", -4, -6, routes([
    { item: "iron-plate", from: { marker: "железо" }, to: { zone: "шестерни" }, keep: 40, batch: 60 },
    { item: "iron-gear-wheel", from: { zone: "шестерни" }, to: { zone: "красная" }, keep: 10 },
    { item: "iron-gear-wheel", from: { zone: "шестерни" }, to: { zone: "зелёная" }, keep: 10 },
  ]))
  robot("Перевозчик", 6, -6, routes([
    { item: "iron-plate", from: { marker: "железо" }, to: { zone: "схемы" }, keep: 20, batch: 40 },
    { item: "copper-cable", from: { zone: "провод" }, to: { zone: "схемы" }, keep: 30 },
    { item: "electronic-circuit", from: { zone: "схемы" }, to: { zone: "зелёная" }, keep: 10 },
    { item: "iron-plate", from: { marker: "железо" }, to: { zone: "зелёная" }, keep: 10, batch: 20 },
  ]))
  robot("Перевозчик", 30, -6, routes([
    { item: "automation-science-pack", from: { zone: "красная" }, to: { zone: "лаборатории" }, keep: 20 },
    { item: "logistic-science-pack", from: { zone: "зелёная" }, to: { zone: "лаборатории" }, keep: 20 },
    { item: "automation-science-pack", from: { zone: "красная" }, to: { marker: "наука" } },
    { item: "logistic-science-pack", from: { zone: "зелёная" }, to: { marker: "наука" } },
  ]))
  force.chart(surface, area)
  return `${area.left_top.x},${area.left_top.y}`
}
