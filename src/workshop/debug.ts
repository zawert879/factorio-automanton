// Отладка в мастерской (15.9): на узле, где сейчас стоит машина с этой программой, — рамка и имя машины;
// машина, выбранная для отладки (панель мастерской), — жёлтой рамкой, её точки остановки — красным кружком
// на узлах. Точка ставится в окне узла; «Продолжить», «Шаг», «Пауза» — как в окне отладки кода (18.8).
import { LuaRenderObject } from "factorio:runtime"
import { onTick } from "../events"
import { Machine, pausedLines, Program } from "../lang/runtime"
import { MachineRecord } from "../program/machines"
import { loadedProgram, ProgramRecord } from "../program/store"
import { NODE_WIDTH } from "../names"
import { workshopOf } from "./entities"
import { Workshop, workshopState } from "./state"

const REFRESH_TICKS = 15

/** Узел, на котором стоит машина: строка самого внутреннего вызова, у которой есть узел (помощники — без узла). */
export function machineNode(program: ProgramRecord, loaded: Program, machine: Machine): number | undefined {
  const lines = pausedLines(loaded, machine)
  for (let i = lines.length - 1; i >= 0; i--) {
    const node = program.graphLines?.[lines[i]]
    if (node !== undefined) return node
  }
  return undefined
}

/** Строки кода узла (по возрастанию); первая, где можно остановиться, — место точки остановки узла. */
export function nodeLines(program: ProgramRecord, nodeId: number): number[] {
  const lines: number[] = []
  for (const [line, node] of pairs(program.graphLines ?? {})) if (node === nodeId) lines.push(line)
  table.sort(lines)
  return lines
}

export function breakLine(program: ProgramRecord, nodeId: number): number | undefined {
  return nodeLines(program, nodeId).find((l) => program.breakable === undefined || program.breakable.includes(l))
}

/** Машины с программой (на карте, не подобранные). */
export function machinesOf(program: ProgramRecord): MachineRecord[] {
  const list: MachineRecord[] = []
  for (const [, record] of pairs(storage.machines)) if (record.programId === program.id && !record.parked && storage.robots.byId[record.robotId]?.entity.valid) list.push(record)
  table.sort(list, (a, b) => a.robotId < b.robotId)
  return list
}

function refresh(ws: Workshop, selected: Record<number, boolean | undefined>): void {
  const state = workshopState()
  const old = state.debugRenders?.[ws.programId] ?? []
  for (const render of old) if (render.valid) render.destroy()
  const renders: LuaRenderObject[] = []
  state.debugRenders ??= {}
  state.debugRenders[ws.programId] = renders
  const program = storage.programs.byId[ws.programId]
  if (program?.graphLines === undefined) return
  const loaded = loadedProgram(program)
  if (loaded === undefined || typeof loaded === "string") return
  const atNode: Record<number, string[] | undefined> = {}
  const chosen: Record<number, boolean | undefined> = {}
  for (const record of machinesOf(program)) {
    const node = machineNode(program, loaded, record.machine)
    const name = storage.robots.byId[record.robotId]?.name ?? `${record.robotId}`
    if (node !== undefined) {
      const list = atNode[node] ?? []
      list.push(name)
      atNode[node] = list
      if (selected[record.robotId]) chosen[node] = true
    }
    // Точки остановки выбранной машины — красный кружок в заголовке узла.
    if (selected[record.robotId]) {
      for (const [line] of pairs(record.breakpoints ?? {})) {
        const node = program.graphLines[line]
        const body = node === undefined ? undefined : ws.nodes[node]?.body
        if (body === undefined || !body.valid) continue
        renders.push(rendering.draw_circle({ color: { r: 0.85, g: 0.12, b: 0.1 }, radius: 0.28, filled: true, target: { entity: body, offset: [NODE_WIDTH / 2 - 0.95, -bodyHalf(body) + 0.5] }, surface: ws.surface }))
      }
    }
  }
  for (const [node, names] of pairs(atNode)) {
    const body = ws.nodes[node]?.body
    if (body === undefined || !body.valid) continue
    const half = bodyHalf(body)
    const color = chosen[node] ? { r: 1, g: 0.85, b: 0.2 } : { r: 0.35, g: 1, b: 0.45 }
    renders.push(
      rendering.draw_rectangle({
        color,
        width: chosen[node] ? 5 : 3,
        filled: false,
        left_top: { entity: body, offset: [-NODE_WIDTH / 2 + 0.3, -half - 0.2] },
        right_bottom: { entity: body, offset: [NODE_WIDTH / 2 - 0.3, half + 0.2] },
        surface: ws.surface,
      }),
      rendering.draw_text({
        text: `▶ ${names.join(", ")}`,
        color,
        scale: 1.2,
        target: { entity: body, offset: [-NODE_WIDTH / 2 + 0.4, -half - 1] },
        surface: ws.surface,
      }),
    )
  }
}

function bodyHalf(body: { selection_box: { left_top: { y: number }; right_bottom: { y: number } } }): number {
  return (body.selection_box.right_bottom.y - body.selection_box.left_top.y) / 2
}

/** Только мастерские, где сейчас кто-то есть: остальные не перерисовываются. */
export function registerWorkshopDebug(): void {
  onTick((tick) => {
    if (tick % REFRESH_TICKS !== 0) return
    const state = storage.workshop
    if (state === undefined) return
    const selected: Record<number, Record<number, boolean | undefined> | undefined> = {}
    for (const [, visitor] of pairs(state.visitors)) {
      const list = selected[visitor.programId] ?? {}
      if (visitor.debugRobot !== undefined) list[visitor.debugRobot] = true
      selected[visitor.programId] = list
    }
    for (const [programId, chosen] of pairs(selected)) {
      const ws = workshopOf(programId)
      if (ws !== undefined) refresh(ws, chosen)
    }
    // Мастерские без гостей — снять подсветку.
    for (const [programId, renders] of pairs(state.debugRenders ?? {})) {
      if (selected[programId] !== undefined) continue
      for (const render of renders) if (render.valid) render.destroy()
      state.debugRenders![programId] = undefined
    }
  })
}
