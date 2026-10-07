// Сохраняемое состояние мода. Только простые данные и ссылки на объекты игры: без функций и метатаблиц.
import type { ActionsState } from "./automaton/actions"
import type { MovementState } from "./automaton/movement"
import type { RobotRegistry } from "./automaton/registry"

declare global {
  const storage: {
    commandUses: number
    robots: RobotRegistry
    movement: MovementState
    actions: ActionsState
  }
}
