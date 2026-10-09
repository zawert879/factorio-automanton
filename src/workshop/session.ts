// Вход в мастерскую и выход (этап 15): игрок оставляет персонажа на заводе и правит схему в режиме без
// персонажа (как в моде Blueprint Sandboxes): здания ставятся сразу, провода тянутся кликами. На выходе —
// обратно в своего персонажа; персонажа не стало — новый у точки появления.
import { LuaPlayer, MapPosition, PlayerIndex } from "factorio:runtime"
import { ProgramRecord } from "../program/store"
import { ensureWorkshop, workshopOf } from "./entities"
import { Workshop, WorkshopVisitor, workshopState } from "./state"

export function visitorOf(player: LuaPlayer): WorkshopVisitor | undefined {
  return workshopState().visitors[player.index]
}

const enterListeners: Array<(this: void, player: LuaPlayer, ws: Workshop) => void> = []
const exitListeners: Array<(this: void, player: LuaPlayer) => void> = []

/** Окна мастерской открывает и закрывает gui.ts — подписка без кольцевого импорта. */
export function onWorkshopEnter(listener: (this: void, player: LuaPlayer, ws: Workshop) => void): void {
  enterListeners.push(listener)
}
export function onWorkshopExit(listener: (this: void, player: LuaPlayer) => void): void {
  exitListeners.push(listener)
}

/** Где встать в мастерской: у «Старта» (или первого узла). */
function viewPosition(ws: Workshop): MapPosition {
  let best: MapPosition | undefined
  for (const [, node] of pairs(ws.nodes)) {
    if (!node.body.valid) continue
    if (node.kind === "start") return { x: node.body.position.x + 14, y: node.body.position.y + 8 }
    best ??= { x: node.body.position.x + 14, y: node.body.position.y + 8 }
  }
  return best ?? { x: 16, y: 8 }
}

export function enterWorkshop(player: LuaPlayer, program: ProgramRecord): Workshop {
  const state = workshopState()
  const ws = ensureWorkshop(program.id, program.force, program.graph)
  let visitor = state.visitors[player.index]
  if (visitor === undefined) {
    if (player.controller_type === defines.controllers.remote) player.exit_remote_view()
    player.clear_cursor()
    const character = player.character
    visitor = { programId: program.id, character, surface: player.physical_surface, position: player.physical_position }
    state.visitors[player.index] = visitor
    if (character !== undefined) player.set_controller({ type: defines.controllers.god })
  }
  visitor.programId = program.id
  player.teleport(viewPosition(ws), ws.surface)
  player.zoom = 0.75
  for (const listener of enterListeners) listener(player, ws)
  return ws
}

export function exitWorkshop(player: LuaPlayer): void {
  const state = workshopState()
  const visitor = state.visitors[player.index]
  if (visitor === undefined) return
  for (const listener of exitListeners) listener(player)
  // Провод в руке в режиме без персонажа clear_cursor не убирает: в руке мастерской — только инструменты.
  player.cursor_stack?.clear()
  player.clear_cursor()
  player.get_main_inventory()?.clear()
  state.visitors[player.index] = undefined
  const character = visitor.character
  if (character !== undefined && character.valid) {
    player.teleport(character.position, character.surface)
    player.set_controller({ type: defines.controllers.character, character })
    return
  }
  // Персонажа нет (погиб, пока игрок был в мастерской, или его и не было) — на прежнее место или к точке появления.
  const surface = visitor.surface?.valid ? visitor.surface : game.surfaces[1]
  const position = visitor.position ?? player.force.get_spawn_position(surface)
  player.teleport(position, surface)
  if (visitor.character !== undefined) player.create_character()
}

/** Игроки в мастерской этой программы (программу удалили — всех наружу). */
export function visitorsOf(programId: number): LuaPlayer[] {
  const players: LuaPlayer[] = []
  for (const [index, visitor] of pairs(workshopState().visitors)) {
    if (visitor.programId !== programId) continue
    const player = game.get_player(index as PlayerIndex)
    if (player !== undefined) players.push(player)
  }
  return players
}

export function currentWorkshop(player: LuaPlayer): Workshop | undefined {
  const visitor = visitorOf(player)
  return visitor === undefined ? undefined : workshopOf(visitor.programId)
}
