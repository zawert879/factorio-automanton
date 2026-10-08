// Доска и очереди задач команды (9.3, 9.4). Состояние — в storage, по командам (force).
// Доска: «ключ → значение», каждая операция атомарна (машины исполняются по очереди, между операциями
// одной машины другая не вклинится). Захват ключа (claim) — с истечением через ttl.
// Задачи: очереди с приоритетом; взятая задача арендуется машиной на lease секунд; не закончила
// (done/fail) — задача возвращается в очередь. Ждущие next() машины получают задачи по очереди.
import { onRobotRemoved } from "../automaton/registry"
import { onTick } from "../events"
import { Val } from "../lang/runtime/core"
import { onMachineReset } from "./machines"
import { resume, waitingFrame } from "./scheduler"

export interface Claim {
  owner: number
  until: number
}

export interface BoardState {
  values: Record<string, Val>
  claims: Record<string, Claim | undefined>
}

export interface TaskItem {
  id: number
  data: Val
  priority: number
  /** Порядок постановки — внутри одного приоритета первой берётся старшая задача. */
  seq: number
  leasedBy?: number
  leaseUntil?: number
}

export interface TaskQueue {
  items: TaskItem[]
  /** Машины, которые ждут задачу (next), по очереди. */
  waiters: number[]
}

export interface TasksState {
  nextId: number
  /** Команда → очередь → задачи. */
  queues: Record<string, Record<string, TaskQueue | undefined> | undefined>
}

export const MAX_BOARD_KEYS = 10000
export const DEFAULT_CLAIM_SECONDS = 60
export const DEFAULT_LEASE_SECONDS = 60
const LEASE_CHECK_TICKS = 60

export function initBoard(): void {
  storage.board ??= {}
  storage.tasks ??= { nextId: 1, queues: {} }
}

export function boardOf(force: string): BoardState {
  return (storage.board[force] ??= { values: {}, claims: {} })
}

/** Захват ключа: свободен, истёк или уже свой — захватить (продлить). */
export function claim(force: string, key: string, robotId: number, ticks: number): boolean {
  const board = boardOf(force)
  const current = board.claims[key]
  if (current !== undefined && current.owner !== robotId && current.until > game.tick) return false
  board.claims[key] = { owner: robotId, until: game.tick + ticks }
  return true
}

export function release(force: string, key: string, robotId: number): void {
  const board = boardOf(force)
  if (board.claims[key]?.owner === robotId) board.claims[key] = undefined
}

// ---------- Задачи ----------

export function queueOf(force: string, name: string): TaskQueue {
  const queues = (storage.tasks.queues[force] ??= {})
  return (queues[name] ??= { items: [], waiters: [] })
}

/** Лучшая свободная задача: старший приоритет, внутри — раньше поставленная. */
function bestFree(queue: TaskQueue): TaskItem | undefined {
  let best: TaskItem | undefined
  for (const item of queue.items) {
    if (item.leasedBy !== undefined) continue
    if (best === undefined || item.priority > best.priority || (item.priority === best.priority && item.seq < best.seq)) best = item
  }
  return best
}

/** Как задача становится значением программы (обёртку задаёт api/board.ts). */
let toProgram: (this: void, force: string, queue: string, item: TaskItem) => Val = (_f, _q, item) => item

export function setTaskWrapper(wrap: (this: void, force: string, queue: string, item: TaskItem) => Val): void {
  toProgram = wrap
}

/** Взять свободную задачу в аренду (или undefined, если свободных нет). */
export function lease(force: string, name: string, robotId: number, ticks: number): TaskItem | undefined {
  const item = bestFree(queueOf(force, name))
  if (item === undefined) return undefined
  item.leasedBy = robotId
  item.leaseUntil = game.tick + ticks
  return item
}

/** Раздать свободные задачи ждущим машинам. */
export function offer(force: string, name: string): void {
  const queue = queueOf(force, name)
  while (queue.waiters.length > 0) {
    const robotId = queue.waiters[0]
    const frame = waitingFrame(robotId)
    const record = storage.machines[robotId]
    // Машина уже не ждёт эту очередь (таймаут, перезапуск) — убрать из ожидающих.
    if (record === undefined || frame?.__taskQueue !== name || frame.__taskForce !== force) {
      queue.waiters.shift()
      continue
    }
    const item = lease(force, name, robotId, frame.lease)
    if (item === undefined) return
    queue.waiters.shift()
    resume(record, toProgram(force, name, item))
  }
}

export function pushTask(force: string, name: string, data: Val, priority: number): void {
  const queue = queueOf(force, name)
  const id = storage.tasks.nextId++
  queue.items.push({ id, data, priority, seq: id })
  offer(force, name)
}

function findItem(force: string, name: string, id: number): [TaskQueue, number] | undefined {
  const queue = queueOf(force, name)
  for (let i = 0; i < queue.items.length; i++) if (queue.items[i].id === id) return [queue, i]
  return undefined
}

/** Задача выполнена (только арендатором): убрать из очереди. */
export function finishTask(force: string, name: string, id: number, robotId: number): boolean {
  const found = findItem(force, name, id)
  if (found === undefined || found[0].items[found[1]].leasedBy !== robotId) return false
  found[0].items.splice(found[1], 1)
  return true
}

/** Вернуть задачу в очередь (fail, истекла аренда, машина пропала). */
export function returnTask(force: string, name: string, item: TaskItem): void {
  item.leasedBy = undefined
  item.leaseUntil = undefined
  offer(force, name)
}

export function failTask(force: string, name: string, id: number, robotId: number): boolean {
  const found = findItem(force, name, id)
  if (found === undefined) return false
  const item = found[0].items[found[1]]
  if (item.leasedBy !== robotId) return false
  returnTask(force, name, item)
  return true
}

/** Вернуть все задачи машины (перезапуск программы, машина пропала). */
function releaseLeases(robotId: number): void {
  for (const [force, queues] of pairs(storage.tasks.queues)) {
    for (const [name, queue] of pairs(queues)) {
      for (const item of queue.items) if (item.leasedBy === robotId) returnTask(force, name, item)
    }
  }
}

function expireLeases(tick: number): void {
  for (const [force, queues] of pairs(storage.tasks.queues)) {
    for (const [name, queue] of pairs(queues)) {
      for (const item of queue.items) if (item.leasedBy !== undefined && item.leaseUntil! <= tick) returnTask(force, name, item)
    }
  }
}

export function registerBoard(): void {
  onTick((tick) => {
    if (tick % LEASE_CHECK_TICKS === 0) expireLeases(tick)
  })
  onMachineReset((robotId) => releaseLeases(robotId))
  onRobotRemoved((robotId) => releaseLeases(robotId))
}
