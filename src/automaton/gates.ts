// Ворота перед машинами. Наземные машины проходят ворота (у них свой слой столкновений — src/prototypes/gates.ts),
// а чтобы это выглядело как в игре, ворота открываются перед ними: раз в CHECK_TICKS ворота ближе RADIUS клеток к
// едущей машине (и к боевой — в патруле и охране она едет командой движку, без поездки) получают request_to_open.
// Ворота ищутся не запросом к движку на каждую машину, а по указателю «чанк → ворота» в storage: он обновляется
// при постройке и сносе, а при запуске и обновлении мода строится заново.
import { LuaEntity } from "factorio:runtime"
import { onEvent, onTick } from "../events"
import { MODELS } from "../names"
import { RobotRecord } from "./registry"

interface GateEntry {
  gate: LuaEntity
  unit: number
  x: number
  y: number
}

export interface GatesState {
  byChunk: Record<number, GateEntry[] | undefined>
  count: number
}

const CHECK_TICKS = 10
/** На таком расстоянии от машины ворота открываются (машина проходит 1 клетку за 10 тиков). */
const RADIUS = 3.5
/** Ворота держатся открытыми столько тиков после последней просьбы. */
const OPEN_TICKS = 40

const COMBAT_MODELS: Record<string, boolean> = {}
for (const model of MODELS) if (model.weapon !== undefined) COMBAT_MODELS[model.entity] = true

/** Номер чанка числом: поверхность, x и y чанка (до ±32768 чанков). */
function chunkKey(surface: number, x: number, y: number): number {
  return (surface * 65536 + math.floor(x / 32) + 32768) * 65536 + math.floor(y / 32) + 32768
}

function addGate(gate: LuaEntity): void {
  const { x, y } = gate.position
  const key = chunkKey(gate.surface_index, x, y)
  const list = (storage.gates.byChunk[key] ??= [])
  list.push({ gate, unit: gate.unit_number!, x, y })
  storage.gates.count++
}

function removeGate(gate: LuaEntity): void {
  const { x, y } = gate.position
  const key = chunkKey(gate.surface_index, x, y)
  const list = storage.gates.byChunk[key]
  if (list === undefined) return
  const unit = gate.unit_number
  const kept = list.filter((entry) => entry.unit !== unit && entry.gate.valid)
  storage.gates.count -= list.length - kept.length
  storage.gates.byChunk[key] = kept.length === 0 ? undefined : kept
}

/** Указатель ворот — заново по всем поверхностям (ворота могли поставить до мода или без событий). */
export function initGates(): void {
  storage.gates = { byChunk: {}, count: 0 }
  for (const [, surface] of pairs(game.surfaces)) {
    for (const gate of surface.find_entities_filtered({ type: "gate" })) addGate(gate)
  }
}

/** Открыть ворота рядом с машиной. */
function openNear(robot: RobotRecord): void {
  const entity = robot.entity
  if (!entity.valid) return
  const { x, y } = entity.position
  const surface = entity.surface_index
  // Чанки, которые задевает квадрат ±RADIUS вокруг машины (один–четыре).
  const keys: number[] = []
  for (const dx of [-RADIUS, RADIUS]) {
    for (const dy of [-RADIUS, RADIUS]) {
      const key = chunkKey(surface, x + dx, y + dy)
      if (!keys.includes(key)) keys.push(key)
    }
  }
  for (const key of keys) {
    for (const entry of storage.gates.byChunk[key] ?? []) {
      if ((entry.x - x) ** 2 + (entry.y - y) ** 2 > RADIUS * RADIUS || !entry.gate.valid) continue
      entry.gate.request_to_open(entity.force, OPEN_TICKS)
    }
  }
}

export function registerGates(): void {
  for (const event of [defines.events.on_built_entity, defines.events.on_robot_built_entity, defines.events.script_raised_built, defines.events.script_raised_revive]) {
    onEvent(event, (e: { entity: LuaEntity }) => {
      if (e.entity.valid && e.entity.type === "gate") addGate(e.entity)
    })
  }
  onEvent(defines.events.on_entity_cloned, (e) => {
    if (e.destination.valid && e.destination.type === "gate") addGate(e.destination)
  })
  for (const event of [defines.events.on_player_mined_entity, defines.events.on_robot_mined_entity, defines.events.on_entity_died, defines.events.script_raised_destroy]) {
    onEvent(event, (e: { entity: LuaEntity }) => {
      if (e.entity.valid && e.entity.type === "gate") removeGate(e.entity)
    })
  }
  onTick((tick) => {
    if (tick % CHECK_TICKS !== 0 || storage.gates.count <= 0) return
    for (const [id, order] of pairs(storage.movement.orders)) {
      if (order === undefined || (order.phase !== "going" && order.phase !== "sidestep")) continue
      const robot = storage.robots.byId[id]
      if (robot !== undefined) openNear(robot)
    }
    // Боевые машины в патруле и охране едут командой движку, без поездки.
    for (const [, robot] of pairs(storage.robots.byId)) {
      if (COMBAT_MODELS[robot.model] && storage.movement.orders[robot.id] === undefined) openNear(robot)
    }
  })
}
