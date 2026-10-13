// Перенос и удаление узлов (23.1). Инструмент «Перенос» (кнопка в палитре): рамка, начатая на узле, переносит
// его туда, где её отпустили — начало рамки мод узнаёт по нажатию (ZONE_PRESS, связано с выделением, как края зон
// в 21.7), конец — угол рамки напротив начала; провода и настройки едут с узлом. Удалить — кнопка «Удалить»
// в окне узла (src/workshop/gui.ts) или клавиша Delete над узлом.
import { BoundingBox, LuaPlayer, MapPosition } from "factorio:runtime"
import { onCustomInput, onEvent } from "../events"
import { NODE_DELETE, NODE_MOVER, ZONE_PRESS } from "../names"
import { moveNode, nodeOfEntity, removeNode, workshopOf, workshopProgram } from "./entities"
import { workshopState } from "./state"

function holdsMover(player: LuaPlayer): boolean {
  const stack = player.cursor_stack
  return stack !== undefined && stack.valid_for_read && stack.name === NODE_MOVER
}

/** Узел под точкой мастерской (тело или разъём). */
function nodeAt(player: LuaPlayer, position: MapPosition) {
  if (workshopProgram(player.surface) === undefined) return undefined
  // Не по радиусу: он меряет до центра сущности, а узел — длинный прямоугольник.
  const area: BoundingBox = { left_top: { x: position.x - 0.05, y: position.y - 0.05 }, right_bottom: { x: position.x + 0.05, y: position.y + 0.05 } }
  for (const entity of player.surface.find_entities_filtered({ area })) {
    const found = nodeOfEntity(entity)
    if (found !== undefined) return found
  }
  return undefined
}

/** Конец рамки — угол области напротив начала; сдвиг — по клеткам. */
export function dragOffset(start: MapPosition, area: BoundingBox): { dx: number; dy: number } {
  const endX = math.abs(area.left_top.x - start.x) <= math.abs(area.right_bottom.x - start.x) ? area.right_bottom.x : area.left_top.x
  const endY = math.abs(area.left_top.y - start.y) <= math.abs(area.right_bottom.y - start.y) ? area.right_bottom.y : area.left_top.y
  return { dx: math.floor(endX - start.x + 0.5), dy: math.floor(endY - start.y + 0.5) }
}

/** Удалить узел под курсором игрока (клавиша Delete). */
export function deleteSelectedNode(player: LuaPlayer): boolean {
  const selected = player.selected
  const found = selected === undefined || workshopProgram(player.surface) === undefined ? undefined : nodeOfEntity(selected)
  if (found === undefined) return false
  removeNode(found.ws, found.node.id)
  return true
}

export function registerNodeMoves(): void {
  onCustomInput(ZONE_PRESS, (e) => {
    const state = workshopState()
    state.moves ??= {}
    state.moves[e.player_index] = undefined
    const player = game.get_player(e.player_index)
    if (player === undefined || !holdsMover(player)) return
    const found = nodeAt(player, e.cursor_position)
    if (found !== undefined) state.moves[e.player_index] = { programId: found.ws.programId, node: found.node.id, start: e.cursor_position }
  })
  onEvent(defines.events.on_player_selected_area, (e) => {
    if (e.item !== NODE_MOVER) return
    const state = workshopState()
    const grab = state.moves?.[e.player_index]
    if (state.moves !== undefined) state.moves[e.player_index] = undefined
    const ws = grab === undefined ? undefined : workshopOf(grab.programId)
    if (grab === undefined || ws === undefined || ws.surface !== e.surface) return
    const { dx, dy } = dragOffset(grab.start, e.area)
    if (!moveNode(ws, grab.node, dx, dy)) game.get_player(e.player_index)?.create_local_flying_text({ text: ["automaton-workshop.move-blocked"], create_at_cursor: true })
  })
  onCustomInput(NODE_DELETE, (e) => {
    const player = game.get_player(e.player_index)
    if (player !== undefined) deleteSelectedNode(player)
  })
}
