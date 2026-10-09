// Программа у машины: какая программа и версия, состояние исполнения (кадры — в storage), параметры
// (args), память (memory, переживает перезапуск и подбор), консоль (последние 100 строк).
import { LuaRandomGenerator, MapPosition } from "factorio:runtime"
import { cancelAction } from "../automaton/actions"
import { cancelMove } from "../automaton/movement"
import { onRobotRegistered, onRobotRemoved, RobotRecord } from "../automaton/registry"
import { Val } from "../lang/runtime/core"
import { Machine, newMachine } from "../lang/runtime"
import { onProgramPublished, onProgramRemoved, ProgramRecord } from "./store"

export interface MachineRecord {
  robotId: number
  programId?: number
  /** Версия программы, с которой запущена машина. */
  version: number
  machine: Machine
  args: Val
  memory: Record<string, Val>
  console: string[]
  /** Math.random программы: свой генератор у каждой машины, одинаковый у всех игроков. */
  rng: LuaRandomGenerator
  home?: MapPosition
  /** Подпись над машиной (me.label). */
  label?: string
  /** Машину подобрали: программа стоит, память и параметры ждут, пока её поставят снова. */
  parked?: boolean
  /** Пауза для отладки (окно машины): планировщик её пропускает, «Шаг» — до следующей строки. */
  paused?: boolean
  /** Точки остановки машины (18.8): строки в кодировке модулей (модуль × 1 000 000 + строка). */
  breakpoints?: Record<number, boolean | undefined>
  /** Строка, на которой машина встала по точке остановки или шагу (18.8); снимается при продолжении. */
  stopLine?: number
  lastChatTick?: number
}

export const CONSOLE_LINES = 100

export function initMachines(): void {
  storage.machines ??= {}
}

const wakeListeners: Array<(this: void, robotId: number) => void> = []

/** Машину нужно исполнить (планировщик ставит её в очередь). */
export function onWake(listener: (this: void, robotId: number) => void): void {
  wakeListeners.push(listener)
}

export function wake(robotId: number): void {
  for (const listener of wakeListeners) listener(robotId)
}

const resetListeners: Array<(this: void, robotId: number) => void> = []

/** Программа машины начинается заново или останавливается: её связь, аренды задач и т. п. сбрасываются. */
export function onMachineReset(listener: (this: void, robotId: number) => void): void {
  resetListeners.push(listener)
}

function reset(robotId: number): void {
  for (const listener of resetListeners) listener(robotId)
}

export function machineOf(robotId: number): MachineRecord {
  let record = storage.machines[robotId]
  if (record === undefined) {
    record = {
      robotId,
      version: 0,
      machine: { status: "done" },
      args: {},
      memory: {},
      console: [],
      rng: game.create_random_generator(robotId * 7919 + 17),
    }
    storage.machines[robotId] = record
  }
  return record
}

export function appendConsole(record: MachineRecord, line: string): void {
  record.console.push(line)
  while (record.console.length > CONSOLE_LINES) record.console.shift()
}

function stopActivity(robotId: number): void {
  const robot = storage.robots.byId[robotId]
  if (robot === undefined || !robot.entity.valid) return
  cancelAction(robot)
  cancelMove(robot)
}

/** Запустить программу машины заново (с текущей версией). Память и параметры сохраняются. */
export function restartMachine(record: MachineRecord): void {
  const program = record.programId === undefined ? undefined : storage.programs.byId[record.programId]
  stopActivity(record.robotId)
  reset(record.robotId)
  if (program === undefined) {
    record.machine = { status: "done" }
    return
  }
  if (program.quarantined) {
    record.machine = { status: "done" }
    appendConsole(record, `— ${program.name}: программа в карантине`)
    return
  }
  if (program.library) {
    // Библиотека (только объявления): запускать нечего — она для других программ.
    record.machine = { status: "done" }
    appendConsole(record, `— ${program.name}: это библиотека — её импортируют другие программы, запустить её нельзя`)
    return
  }
  record.version = program.version
  record.stopLine = undefined
  record.machine = newMachine()
  appendConsole(record, `— ${program.name} v${program.version}`)
  wake(record.robotId)
}

export function assignProgram(robot: RobotRecord, program: ProgramRecord | undefined): MachineRecord {
  const record = machineOf(robot.id)
  record.programId = program?.id
  restartMachine(record)
  return record
}

export function stopMachine(record: MachineRecord): void {
  stopActivity(record.robotId)
  reset(record.robotId)
  record.machine = { status: "done" }
  appendConsole(record, "— остановлена")
}

export function registerMachines(): void {
  // Новая версия программы — машины с ней начинают заново.
  onProgramPublished((program) => {
    for (const [, record] of pairs(storage.machines)) {
      if (record.programId === program.id && !record.parked) restartMachine(record)
    }
  })
  // Программу удалили или отправили в карантин — машины с ней останавливаются.
  onProgramRemoved((program) => {
    for (const [, record] of pairs(storage.machines)) {
      if (record.programId !== program.id) continue
      stopActivity(record.robotId)
      reset(record.robotId)
      record.machine = { status: "done" }
      if (!program.quarantined) record.programId = undefined
      appendConsole(record, program.quarantined ? `— ${program.name}: в карантине (постоянные ошибки лимитов)` : `— ${program.name}: программа удалена`)
    }
  })
  onRobotRemoved((id, reason) => {
    const record = storage.machines[id]
    if (record === undefined) return
    if (reason === "destroyed") {
      storage.machines[id] = undefined
      return
    }
    record.parked = true
    record.machine = { status: "done" }
    reset(id)
  })
  onRobotRegistered((robot) => {
    const record = storage.machines[robot.id]
    if (record?.parked) {
      record.parked = undefined
      restartMachine(record)
    }
  })
}
