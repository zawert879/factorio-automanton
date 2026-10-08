// Сигналы цепей (9.6): signals.read / readAll / write у сигнальной метки (её подключают проводами).
// Читается вся сеть (красный и зелёный провода вместе), включая то, что выставила сама метка.
// Читать и писать — стоя у метки (me.reach).
import { LuaConstantCombinatorControlBehavior, LuaEntity, SignalIDWrite } from "factorio:runtime"
import { distanceToEntity } from "../../automaton/actions"
import { charge, defineHostObject, hostMethods, Val } from "../../lang/runtime/core"
import { SIGNAL_MARKER } from "../../names"
import { actionError, currentRobot } from "../context"
import { ROBOT_REACH } from "../handles"
import { text } from "./common"

/** Сущность сигнальной метки из значения программы (marker(...)), в досягаемости. */
function signalMarker(value: Val): LuaEntity {
  if (type(value) !== "table" || value.__t !== "host" || value.__h !== "marker") actionError("invalid-target", "signals need a marker")
  const marker = storage.markers.byId[value.__id]
  if (marker === undefined || !marker.entity.valid) actionError("invalid-target", "marker removed")
  if (marker.entity.name !== SIGNAL_MARKER) actionError("invalid-target", "this marker has no wires: use a signal marker")
  if (distanceToEntity(currentRobot().entity.position, marker.entity) > ROBOT_REACH.reach) actionError("out-of-reach")
  return marker.entity
}

/** Сигнал по имени: предмет, жидкость или виртуальный сигнал («signal-A»). */
function signalId(name: string): SignalIDWrite {
  if (prototypes.virtual_signal[name] !== undefined) return { type: "virtual", name }
  if (prototypes.item[name] !== undefined) return { type: "item", name }
  if (prototypes.fluid[name] !== undefined) return { type: "fluid", name }
  return actionError("invalid-target", `unknown signal ${name}`)
}

const RED = defines.wire_connector_id.circuit_red
const GREEN = defines.wire_connector_id.circuit_green

defineHostObject("signals")

hostMethods.signals.read = (_o: Val, _k: Val, at: Val, signal: Val) => signalMarker(at).get_signal(signalId(text(signal)), RED, GREEN)

hostMethods.signals.readAll = (_o: Val, _k: Val, at: Val) => {
  const result: Record<string, number> = {}
  for (const signal of signalMarker(at).get_signals(RED, GREEN) ?? []) {
    const name = signal.signal.name
    if (name !== undefined) result[name] = (result[name] ?? 0) + signal.count
  }
  charge(1)
  return result
}

hostMethods.signals.write = (_o: Val, _k: Val, at: Val, values: Val) => {
  const entity = signalMarker(at)
  if (type(values) !== "table" || values.__n !== undefined || values.__t !== undefined) actionError("invalid-target", "write needs an object { signal: value }")
  const filters: { value: SignalIDWrite & { quality: string; comparator: "=" }; min: number }[] = []
  const names: string[] = []
  for (const [name] of pairs(values as Record<string, Val>)) names.push(name)
  table.sort(names)
  for (const name of names) {
    const count = values[name]
    if (type(count) !== "number") actionError("invalid-target", `signal ${name} must be a number`)
    if (count === 0) continue
    filters.push({ value: { ...signalId(name), quality: "normal", comparator: "=" }, min: math.floor(count as number) })
  }
  if (filters.length > 1000) actionError("limit-exceeded", "too many signals")
  const behavior = entity.get_or_create_control_behavior() as LuaConstantCombinatorControlBehavior
  behavior.enabled = true
  const section = behavior.get_section(1) ?? behavior.add_section()
  if (section === undefined) actionError("invalid-target", "the marker has no signal section")
  section.filters = filters as never
}
