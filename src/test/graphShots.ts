// Снимки схем (npm run shot:graphs): программы-примеры, собранные схемами (src/graph/samples.ts), — в своих
// мастерских: схема целиком, мастерская глазами игрока (панель, палитра, окно узла), код из схемы.
// Подключается из control.ts, только когда включён служебный мод automaton-graph-shots.
import { PlayerIndex } from "factorio:runtime"
import { graphSamples } from "../graph/samples"
import { graphToSource } from "../graph/codegen"
import { Graph } from "../graph/model"
import { NODE_WIDTH } from "../names"
import { findProgram, publish } from "../program/store"
import { nodeCorner, ensureWorkshop, workshopOf } from "../workshop/entities"
import { enterWorkshop } from "../workshop/session"
import { Workshop } from "../workshop/state"

const OUT = "automaton-graph-shots"

/** Вся схема в кадре: рамка узлов, масштаб 1 (большая схема — мельче). */
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
  // Масштаб 1 (подписи читаются), большая схема — мельче, чтобы снимок был не больше 4096 точек.
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
  const player = game.get_player(1 as PlayerIndex)
  if (player === undefined) return
  game.take_screenshot({ player, show_gui: true, resolution: { x: player.display_resolution.width, y: player.display_resolution.height }, zoom: 1, path: `${OUT}/${name}.png` })
}

const samples = graphSamples()
let index = 0

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
    if (!source_ok(samples)) helpers.write_file(`${OUT}/errors.txt`, graphErrors(samples), true)
  }
  // По схеме за кадр: мастерская построена, rendering отрисован.
  if (tick >= 40 && tick % 4 === 0 && index < samples.length) {
    const sample = samples[index++]
    const program = findProgram(sample.name)
    const ws = program === undefined ? undefined : workshopOf(program.id)
    if (ws !== undefined) shootWorkshop(ws, `graph-${index}`)
  }
  // Глазами игрока: мастерская «Шахтёра», окно узла «Копать».
  if (tick === 40 + samples.length * 4 + 10) {
    const player = game.get_player(1 as PlayerIndex)
    const program = findProgram(samples[0].name)
    // В начале freeplay идёт заставка (крушение корабля): в ней вход в мастерскую не сработает.
    if (player !== undefined && player.controller_type === defines.controllers.cutscene) player.exit_cutscene()
    if (player !== undefined && program !== undefined) enterWorkshop(player, program)
  }
  if (tick === 40 + samples.length * 4 + 40) guiShot("workshop-player")
  if (tick === 40 + samples.length * 4 + 50) {
    helpers.write_file(`${OUT}/done.txt`, "done", false)
    script.on_nth_tick(1, undefined)
  }
})

function source_ok(list: { name: string; graph: Graph }[]): boolean {
  return list.every((s) => graphToSource(s.graph, s.name).ok)
}

function graphErrors(list: { name: string; graph: Graph }[]): string {
  return list
    .map((s) => `${s.name}: ${graphToSource(s.graph, s.name).diagnostics.map((d) => `${d.code}@${d.node}${d.pin !== undefined ? `.${d.pin}` : ""}`).join(", ")}`)
    .join("\n")
}
