// Сохраняемое состояние мода. Только простые данные и ссылки на объекты игры: без функций и метатаблиц.
import type { ActionsState } from "./automaton/actions"
import type { GuiState } from "./gui/common"
import type { MovementState } from "./automaton/movement"
import type { RobotRegistry } from "./automaton/registry"
import type { HandlesState } from "./program/handles"
import type { MachineRecord } from "./program/machines"
import type { SchedulerState } from "./program/scheduler"
import type { ProgramsState } from "./program/store"
import type { MarkersState } from "./world/markers"
import type { NamingTarget } from "./world/naming"
import type { ZonesState } from "./world/zones"
import type { LuaRandomGenerator } from "factorio:runtime"

declare global {
  const storage: {
    commandUses: number
    robots: RobotRegistry
    movement: MovementState
    actions: ActionsState
    /** Случайные числа игровой логики (одинаковые у всех игроков). */
    rng: LuaRandomGenerator
    /** Библиотека программ команды. */
    programs: ProgramsState
    /** Программа у каждой машины: по id машины. */
    machines: Record<number, MachineRecord | undefined>
    scheduler: SchedulerState
    /** Обёртки объектов игры для программ (одна на объект). */
    handles: HandlesState
    markers: MarkersState
    zones: ZonesState
    /** Открытые диалоги имени метки или зоны: по номеру игрока. */
    naming?: Record<number, NamingTarget | undefined>
    /** Открытые окна мода: по номеру игрока. */
    gui?: Record<number, GuiState | undefined>
  }
}
