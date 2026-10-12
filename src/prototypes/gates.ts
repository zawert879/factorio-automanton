// Ворота для машин (data-final-fixes, после всех модов). Наземные машины — юниты: сами ворота для них не
// открываются, а поиск пути движка считает закрытые ворота стеной — за стену с воротами машина не проходила.
// Поэтому у машин свой слой столкновений automaton-solid: он есть у всего, с чем машина сталкивалась раньше
// (здания, стены, деревья, скалы, вода, персонажи, кусаки, поезда), кроме ворот. Поиск пути ведёт машину через
// ворота, а открывает их перед машиной скрипт (src/automaton/gates.ts).
import { PrototypeData } from "factorio:common"
import { AUTOMATON_COLLISION_LAYER, MODELS } from "../names"

declare const data: PrototypeData

type Mask = { layers?: Record<string, true | undefined>; [key: string]: unknown }
type Proto = Record<string, any>

export function letAutomatonsThroughGates(): void {
  const raw = data.raw as unknown as Record<string, Record<string, Proto> | undefined>
  const defaults = (raw["utility-constants"]!.default as Proto).default_collision_masks as Record<string, Mask | undefined>
  // С чем сталкивается юнит по умолчанию (player, train, is_object): у этих прототипов будет и слой машин.
  const unitLayers = Object.keys(defaults.unit?.layers ?? {})
  data.extend([{ type: "collision-layer", name: AUTOMATON_COLLISION_LAYER }])

  const robots: Record<string, boolean> = {}
  for (const model of MODELS) robots[model.entity] = true
  for (const [type, prototypes] of pairs(raw)) {
    if (type === "gate" || prototypes === undefined) continue
    for (const [name, proto] of pairs(prototypes)) {
      if (robots[name]) continue
      const mask = (proto.collision_mask as Mask | undefined) ?? defaults[type]
      if (mask === undefined || mask.layers === undefined || !unitLayers.some((layer) => mask.layers![layer] === true)) continue
      proto.collision_mask = { ...mask, layers: { ...mask.layers, [AUTOMATON_COLLISION_LAYER]: true } }
    }
  }
  // Наземные машины — только свой слой (друг с другом не сталкиваются, как и раньше); у летающих масок нет.
  for (const model of MODELS) {
    if (model.flying) continue
    const unit = raw.unit?.[model.entity]
    if (unit !== undefined) unit.collision_mask = { layers: { [AUTOMATON_COLLISION_LAYER]: true }, not_colliding_with_itself: true }
  }
}
