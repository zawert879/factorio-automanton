// Сборка сохранения с демо-фабрикой науки (npm run demo:science): тик 1 — постройка, дальше каждые
// 30 секунд в лог — сколько сделано колб и не стоят ли машины с ошибкой; дамп складов и машин —
// на тиках из DUMP_TICKS (для отладки цепочки).
import { buildScienceDemo } from "../world/scienceDemo"

const DUMP_TICKS = [15000, 30000, 33000]

script.on_nth_tick(1, (event) => {
  if (event.tick !== 1) return
  script.on_nth_tick(1, undefined)
  // Новый игрок в этом сохранении — без заставки и обломков корабля.
  if (remote.interfaces["freeplay"]?.["set_skip_intro"]) remote.call("freeplay", "set_skip_intro", true)
  if (remote.interfaces["freeplay"]?.["set_disable_crashsite"]) remote.call("freeplay", "set_disable_crashsite", true)
  buildScienceDemo(game.get_surface("nauvis")!, { x: 45, y: 0 }, game.forces.player)
  log("SCIENCE: построено")
})

function stats(tick: number): void {
  const production = game.forces.player.get_item_production_statistics("nauvis")
  const made = (name: string) => production.get_input_count(name)
  const errors: string[] = []
  for (const [id, record] of pairs(storage.machines)) {
    if (record.machine.status === "error") errors.push(`${storage.robots.byId[id]?.name}: ${record.machine.error?.message}`)
  }
  const research = game.forces.player.current_research
  log(
    `SCIENCE: тик ${tick}, красных ${made("automation-science-pack")}, зелёных ${made("logistic-science-pack")}, ` +
      `шестерён ${made("iron-gear-wheel")}, схем ${made("electronic-circuit")}, железа ${made("iron-plate")}, меди ${made("copper-plate")}, ` +
      `исследование ${research?.name ?? "—"} ${math.floor(game.forces.player.research_progress * 100)}%` +
      (errors.length > 0 ? `; ошибки: ${errors.join(" / ")}` : ""),
  )
}

function dumpWorld(): void {
  const surface = game.get_surface("nauvis")!
  for (const [, marker] of pairs(storage.markers.byId)) {
    if (!marker.entity.valid) continue
    const chest = surface.find_entities_filtered({ type: "container", position: marker.entity.position, radius: 3 })[0]
    if (chest !== undefined) log(`SCIENCE: сундук «${marker.name}» ${serpent.line(chest.get_inventory(defines.inventory.chest)!.get_contents().map((c) => `${c.name}:${c.count}`))}`)
  }
  for (const f of surface.find_entities_filtered({ name: "stone-furnace" })) {
    const contents = (id: defines.inventory) => serpent.line(f.get_inventory(id)!.get_contents().map((c) => `${c.name}:${c.count}`))
    log(`SCIENCE: печь @${f.position.x},${f.position.y} вход ${contents(defines.inventory.furnace_source)} топливо ${contents(defines.inventory.fuel)} выход ${contents(defines.inventory.furnace_result)}`)
  }
}

function dumpMachines(): void {
  for (const [id, record] of pairs(storage.machines)) {
    const robot = storage.robots.byId[id]
    if (robot === undefined) continue
    const program = record.programId === undefined ? "—" : storage.programs.byId[record.programId]?.name
    const contents = robot.cargo.get_contents().map((c) => `${c.name}:${c.count}`).join(",")
    const waiting = record.machine.waiting as { __host?: string } | undefined
    const action = storage.actions.current[id]
    const order = storage.movement.orders[id]
    const goal = order?.destinationEntity?.valid ? `${order.destinationEntity.name}@${order.destinationEntity.position.x},${order.destinationEntity.position.y}` : serpent.line(order?.destination)
    log(
      `SCIENCE: ${robot.name} ${program} ${record.machine.status} ждёт ${waiting?.__host ?? "—"}` +
        (action !== undefined ? ` действие ${action.kind} ${action.done}/${action.params.count}` : "") +
        (order !== undefined ? ` поездка ${order.phase} к ${goal} повторы ${order.stuckRetries}/${order.pathRetries}` : "") +
        ` @${math.floor(robot.entity.position.x)},${math.floor(robot.entity.position.y)} груз[${contents}] | ${record.console.slice(-2).join(" / ")}`,
    )
  }
}

script.on_nth_tick(1800, (event) => stats(event.tick))
script.on_nth_tick(300, (event) => {
  if (!DUMP_TICKS.includes(event.tick)) return
  log(`SCIENCE: === дамп на тике ${event.tick}`)
  dumpWorld()
  dumpMachines()
})
