// Сохраняемое состояние мода. Только простые данные и ссылки на объекты игры: без функций и метатаблиц.
import type { RobotRegistry } from "./automaton/registry"

declare global {
  const storage: {
    commandUses: number
    robots: RobotRegistry
  }
}
