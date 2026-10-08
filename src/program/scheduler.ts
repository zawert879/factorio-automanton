// Планировщик (4.8). Каждый тик:
// 1) таймеры — машины, которые ждут время или опрос условия (wait, waitUntil, follow, таймауты);
// 2) общий бюджет инструкций раздаётся готовым машинам по кругу, у каждой — квант своей модели.
// Ждущие действия машины бюджет не тратят: их будит конец действия или поездки (подписки ниже).
// Машина, ушедшая в минус по кванту (синхронные колбэки), пропускает тики, пока не отработает долг.
import { ActionResult, onActionFinished } from "../automaton/actions"
import { MoveResult, onMoveCancelled, onMoveFinished } from "../automaton/movement"
import { robotMemory, robotQuantum } from "../automaton/models"
import { RobotRecord } from "../automaton/registry"
import { showProblem, problemFor } from "../automaton/status"
import { onTick } from "../events"
import { completeWait, Program, runSlice } from "../lang/runtime"
import { enter, Q, Val } from "../lang/runtime/core"
import { actionErrorValue, ActionErrorCode, context } from "./context"
import { alertRobot } from "./alerts"
import { appendConsole, MachineRecord, onWake } from "./machines"
import { loadedProgram, noteLimitError } from "./store"

export interface SchedulerState {
  /** Готовые к исполнению машины (id), по кругу. */
  ready: number[]
  queued: Record<number, boolean | undefined>
  /** Тик → машины, которым в этот тик проверить ожидание. */
  timers: Record<number, number[] | undefined>
  /** Запрос пути (canReach) → машина. */
  paths: Record<number, number | undefined>
}

export const DEFAULT_INSTRUCTIONS_PER_TICK = 20000

export function initScheduler(): void {
  storage.scheduler ??= { ready: [], queued: {}, timers: {}, paths: {} }
}

function enqueue(id: number): void {
  const state = storage.scheduler
  if (state.queued[id]) return
  state.queued[id] = true
  state.ready.push(id)
}

/**
 * Проверить ожидание машины в тик tick (кадр ожидания должен указать __poll). С кадром — таймер только
 * для этого ожидания: если машина к тому времени ждёт уже другого, старый таймер её не тронет.
 */
export function sleepUntil(robotId: number, tick: number, frame?: Val): void {
  const timers = storage.scheduler.timers
  const at = math.max(tick, game.tick + 1)
  if (frame !== undefined) frame.__at = at
  const list = timers[at]
  if (list === undefined) timers[at] = [robotId]
  else list.push(robotId)
}

/** Опрос ожидания: вызывается в контексте машины, когда сработал её таймер. */
export type Poll = (this: void, record: MachineRecord, frame: Val, tick: number) => void
const polls: Record<string, Poll> = {}

export function registerPoll(name: string, poll: Poll): void {
  polls[name] = poll
}

/** Завершить ожидание (результат или ошибка) и поставить машину в очередь. */
export function resume(record: MachineRecord, result: Val, error_?: Val): void {
  completeWait(record.machine, result, error_)
  enqueue(record.robotId)
}

/** Кадр, которого ждёт машина (или undefined, если она не ждёт). */
export function waitingFrame(robotId: number): Val {
  const record = storage.machines[robotId]
  return record !== undefined && record.machine.status === "waiting" ? record.machine.waiting : undefined
}

function quantumOf(robot: RobotRecord): number {
  return robotQuantum(robot)
}

/** Ошибки лимитов (5.8): если программа раз за разом в них упирается — карантин. */
const LIMIT_CODES: Record<string, boolean> = {
  memory: true,
  "stack-overflow": true,
  "callback-too-long": true,
  "string-too-long": true,
  "array-too-long": true,
}

/** Ошибка программы: в консоль машины, значок над машиной, оповещение команде. */
function reportError(record: MachineRecord, robot: RobotRecord): void {
  const e = record.machine.error
  if (e === undefined) return
  const text = `${e.name}: ${e.message}`
  appendConsole(record, `Ошибка${e.line !== undefined ? ` (строка ${e.line})` : ""}: ${text}`)
  if (!robot.entity.valid) return
  showProblem(robot, problemFor("internal-error"))
  alertRobot(robot, "error", e.line !== undefined ? `${e.line}: ${text}` : text)
  const program = record.programId === undefined ? undefined : storage.programs.byId[record.programId]
  if (program !== undefined && e.code !== undefined && LIMIT_CODES[e.code] && noteLimitError(program)) {
    alertRobot(robot, "quarantine", program.name)
  }
}

/**
 * Исполнить fn в контексте машины: программа, квант, «чьи руки» для функций API. Ошибка внутри
 * (в том числе наша) — ошибка этой машины, а не мода.
 */
export function inMachine(record: MachineRecord, robot: RobotRecord, fn: (this: void, program: Program) => void): void {
  const programRecord = record.programId === undefined ? undefined : storage.programs.byId[record.programId]
  if (programRecord === undefined) {
    record.machine = { status: "done" }
    return
  }
  const program = loadedProgram(programRecord)
  if (typeof program === "string") {
    record.machine = { status: "error", error: { name: "Error", message: `program does not load: ${program}`, value: undefined } }
    reportError(record, robot)
    return
  }
  enter(program)
  program.setBudget(quantumOf(robot))
  Q.a = 0
  context.robot = robot
  context.machine = record
  const [ok, problem] = pcall(fn, program)
  context.robot = undefined
  context.machine = undefined
  if (!ok) {
    log(`automaton: внутренняя ошибка у машины ${robot.name}: ${tostring(problem)}`)
    const value: Val = type(problem) === "table" ? problem : undefined
    const message = value !== undefined && value.message !== undefined ? tostring(value.message) : tostring(problem)
    record.machine = { status: "error", error: { name: value?.name ?? "Error", message, value } }
  }
  if (record.machine.status === "error") reportError(record, robot)
  else if (record.machine.status === "done") appendConsole(record, "— программа завершена")
}

function runTimers(tick: number): void {
  const state = storage.scheduler
  const ids = state.timers[tick]
  if (ids === undefined) return
  state.timers[tick] = undefined
  for (const id of ids) {
    const record = storage.machines[id]
    const robot = storage.robots.byId[id]
    if (record === undefined || robot === undefined || !robot.entity.valid || record.machine.status !== "waiting") continue
    const frame = record.machine.waiting
    if (frame?.__at !== undefined && frame.__at !== tick) continue
    const poll = frame?.__poll === undefined ? undefined : polls[frame.__poll]
    if (poll !== undefined) inMachine(record, robot, () => poll(record, frame, tick))
  }
}

function runReady(): void {
  const state = storage.scheduler
  let budget = (settings.global["automaton-instructions-per-tick"]?.value as number | undefined) ?? DEFAULT_INSTRUCTIONS_PER_TICK
  let count = state.ready.length
  while (count > 0 && budget > 0) {
    count--
    const id = state.ready.shift()!
    state.queued[id] = undefined
    const record = storage.machines[id]
    const robot = storage.robots.byId[id]
    if (record === undefined || record.parked || record.paused || record.machine.status !== "ready") continue
    if (robot === undefined || !robot.entity.valid) continue
    const quantum = quantumOf(robot)
    const debt = record.machine.debt ?? 0
    if (debt > 0) {
      record.machine.debt = math.max(0, debt - quantum)
      enqueue(id)
      continue
    }
    budget -= quantum
    record.machine.memoryLimit = robotMemory(robot)
    inMachine(record, robot, (program) => runSlice(program, record.machine, quantum))
    if (record.machine.status === "ready") enqueue(id)
  }
}

/** Шаг отладки: один отрезок с квантом в одну инструкцию (машина на паузе). */
export function stepMachine(record: MachineRecord): void {
  const robot = storage.robots.byId[record.robotId]
  if (robot === undefined || !robot.entity.valid || record.machine.status !== "ready") return
  inMachine(record, robot, (program) => runSlice(program, record.machine, 1))
}

// ---------- Конец действий и поездок ----------

function onAction(robot: RobotRecord, result: ActionResult): void {
  const frame = waitingFrame(robot.id)
  if (frame === undefined || frame.__action !== result.kind) return
  const record = storage.machines[robot.id]!
  if (result.error !== undefined) resume(record, undefined, actionErrorValue(result.error as ActionErrorCode))
  // build возвращает здание (обёртку делает продолжение функции API), остальные — сколько сделано.
  else resume(record, result.entity ?? result.count)
}

const MOVE_ERRORS: Record<MoveResult, ActionErrorCode | undefined> = { arrived: undefined, "no-path": "no-path", stuck: "stuck", "no-fuel": "no-fuel" }

function onMove(robot: RobotRecord, result: MoveResult): void {
  const frame = waitingFrame(robot.id)
  if (frame === undefined || !frame.__move) return
  const record = storage.machines[robot.id]!
  const code = MOVE_ERRORS[result]
  resume(record, undefined, code === undefined ? undefined : actionErrorValue(code))
}

function onMoveCancel(robot: RobotRecord): void {
  const frame = waitingFrame(robot.id)
  if (frame === undefined || !frame.__move) return
  resume(storage.machines[robot.id]!, undefined, actionErrorValue(frame.timedOut ? "timeout" : "cancelled"))
}

export function registerScheduler(): void {
  onWake((id) => enqueue(id))
  onActionFinished((robot, result) => onAction(robot, result))
  onMoveFinished((robot, result) => onMove(robot, result))
  onMoveCancelled((robot) => onMoveCancel(robot))
  onTick((tick) => {
    runTimers(tick)
    if (storage.scheduler.ready.length > 0) runReady()
  })
}
