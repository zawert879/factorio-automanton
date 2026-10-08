// Сохраняемое состояние мода. Только простые данные и ссылки на объекты игры: без функций и метатаблиц.
import type { ActionsState } from "./automaton/actions"
import type { GuiState } from "./gui/common"
import type { Draft } from "./gui/programs"
import type { SyncBuffer } from "./program/sync"
import type { CommsState } from "./program/comms"
import type { BoardState, TasksState } from "./program/board"
import type { MovementState } from "./automaton/movement"
import type { FlightState } from "./automaton/flight"
import type { RobotRegistry } from "./automaton/registry"
import type { HandlesState } from "./program/handles"
import type { MachineRecord } from "./program/machines"
import type { SchedulerState } from "./program/scheduler"
import type { ProgramsState } from "./program/store"
import type { MarkersState } from "./world/markers"
import type { DisplaysState } from "./world/displays"
import type { NamingTarget } from "./world/naming"
import type { ZonesState } from "./world/zones"
import type { LuaRandomGenerator } from "factorio:runtime"

declare global {
  const storage: {
    commandUses: number
    robots: RobotRegistry
    movement: MovementState
    /** Полёты летающих машин (src/automaton/flight.ts). */
    flight: FlightState
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
    /** Табло (src/world/displays.ts). */
    displays: DisplaysState
    zones: ZonesState
    /** Открытые диалоги имени метки или зоны: по номеру игрока. */
    naming?: Record<number, NamingTarget | undefined>
    /** Открытые окна мода: по номеру игрока. */
    gui?: Record<number, GuiState | undefined>
    /** Неопубликованный текст в редакторе: по номеру игрока. */
    drafts?: Record<number, Draft | undefined>
    /** Программы, которые VS Code передаёт частями (/automaton-sync): по отправителю. */
    sync?: Record<string, SyncBuffer | undefined>
    /** Команды, которым уже опубликованы стартовые программы (src/world/start.ts). */
    startersPublished?: Record<string, boolean | undefined>
    /** Сообщения между машинами (src/program/comms.ts). */
    comms: CommsState
    /** Доска команды: по имени команды (src/program/board.ts). */
    board: Record<string, BoardState | undefined>
    /** Очереди задач (src/program/board.ts). */
    tasks: TasksState
    /** Применённые уровни скорости и груза по командам (src/automaton/models.ts). */
    upgradeLevels?: Record<string, string | undefined>
  }
}
