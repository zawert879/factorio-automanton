// Программа у машины: какая программа и версия, состояние исполнения (кадры — в storage), параметры
// (args), память (memory, переживает перезапуск и подбор), консоль (последние 100 строк).
import { LuaRandomGenerator, MapPosition } from "factorio:runtime"
import { cancelAction } from "../automaton/actions"
import { cancelMove } from "../automaton/movement"
import { onRobotRegistered, onRobotRemoved, RobotRecord } from "../automaton/registry"
import { Val } from "../lang/runtime/core"
import { Machine, newMachine } from "../lang/runtime"
import { onProgramPublished, ProgramRecord } from "./store"

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
  if (program === undefined) {
    record.machine = { status: "done" }
    return
  }
  record.version = program.version
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
  onRobotRemoved((id, reason) => {
    const record = storage.machines[id]
    if (record === undefined) return
    if (reason === "destroyed") {
      storage.machines[id] = undefined
      return
    }
    record.parked = true
    record.machine = { status: "done" }
  })
  onRobotRegistered((robot) => {
    const record = storage.machines[robot.id]
    if (record?.parked) {
      record.parked = undefined
      restartMachine(record)
    }
  })
}
