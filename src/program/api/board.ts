// Доска и задачи (9.3, 9.4) для программ: board.get/set/delete/keys/increment/compareAndSet/claim/release,
// tasks.push/next/size и объект задачи (data, done, fail). Состояние — src/program/board.ts.
import { LuaForce } from "factorio:runtime"
import { charge, defineHostObject, hostGetters, hostMethods, Val } from "../../lang/runtime/core"
import { programArray } from "../values"
import {
  boardOf,
  claim,
  DEFAULT_CLAIM_SECONDS,
  DEFAULT_LEASE_SECONDS,
  failTask,
  finishTask,
  lease,
  MAX_BOARD_KEYS,
  pushTask,
  queueOf,
  release,
  setTaskWrapper,
  TaskItem,
} from "../board"
import { actionError, currentRobot } from "../context"
import { registerPoll, resume, sleepUntil } from "../scheduler"
import { copyValue } from "../values"
import { packData } from "./comms"
import { finishWaiting, startWaiting, text, ticks } from "./common"

const MAX_KEY_BYTES = 200

function force(): string {
  return (currentRobot().entity.force as LuaForce).name
}

function keyOf(value: Val): string {
  const key = text(value)
  if (key.length > MAX_KEY_BYTES) actionError("limit-exceeded", "key is too long")
  return key
}

/** Равенство значений доски: числа, строки, ссылки на объекты — по значению; массивы и объекты — поэлементно. */
export function sameValue(a: Val, b: Val, depth = 0): boolean {
  if (a === b) return true
  if (type(a) !== "table" || type(b) !== "table" || depth > 50) return false
  if (a.__t === "host" || b.__t === "host") return false
  if (a.__n !== b.__n) return false
  for (const [k, v] of pairs(a as LuaTable<string, Val>)) if (!sameValue(v, b[k], depth + 1)) return false
  for (const [k] of pairs(b as LuaTable<string, Val>)) if (a[k] === undefined) return false
  return true
}

// ---------- board ----------

defineHostObject("board")
const boardMethods = hostMethods.board

function store(key: string, value: Val): void {
  const board = boardOf(force())
  if (value === undefined) {
    board.values[key] = undefined
    return
  }
  if (board.values[key] === undefined) {
    let count = 0
    for (const [_key] of pairs(board.values)) if (++count >= MAX_BOARD_KEYS) actionError("limit-exceeded", `board holds at most ${MAX_BOARD_KEYS} keys`)
  }
  board.values[key] = packData(value)
}

boardMethods.get = (_o: Val, _k: Val, key: Val) => {
  const value = boardOf(force()).values[keyOf(key)]
  return value === undefined ? undefined : copyValue(value)
}
boardMethods.set = (_o: Val, _k: Val, key: Val, value: Val) => store(keyOf(key), value)
boardMethods.delete = (_o: Val, _k: Val, key: Val) => store(keyOf(key), undefined)
boardMethods.keys = (_o: Val, _k: Val, prefix: Val) => {
  const start = prefix === undefined ? "" : text(prefix)
  const keys: string[] = []
  for (const [key] of pairs(boardOf(force()).values)) if (string.sub(key, 1, start.length) === start) keys.push(key)
  table.sort(keys)
  return programArray(keys)
}
boardMethods.increment = (_o: Val, _k: Val, key: Val, by: Val) => {
  const name = keyOf(key)
  const current = boardOf(force()).values[name] ?? 0
  if (type(current) !== "number") actionError("invalid-target", `board key ${name} is not a number`)
  const step = by === undefined ? 1 : by
  if (type(step) !== "number") actionError("invalid-target", "increment step must be a number")
  const next = (current as number) + (step as number)
  store(name, next)
  return next
}
boardMethods.compareAndSet = (_o: Val, _k: Val, key: Val, expected: Val, value: Val) => {
  const name = keyOf(key)
  if (!sameValue(boardOf(force()).values[name], expected)) return false
  store(name, value)
  return true
}
boardMethods.claim = (_o: Val, _k: Val, key: Val, ttl: Val) => claim(force(), keyOf(key), currentRobot().id, ticks(ttl, DEFAULT_CLAIM_SECONDS))
boardMethods.release = (_o: Val, _k: Val, key: Val) => release(force(), keyOf(key), currentRobot().id)

// ---------- tasks ----------

defineHostObject("tasks")
defineHostObject("task")

function taskValue(forceName: string, queue: string, item: TaskItem): Val {
  charge(1)
  return { __t: "host", __h: "task", __force: forceName, __queue: queue, __id: item.id, __data: copyValue(item.data) }
}
setTaskWrapper(taskValue)

hostGetters.task.data = (o: Val) => o.__data
hostMethods.task.done = (o: Val) => {
  finishTask(o.__force, o.__queue, o.__id, currentRobot().id)
}
hostMethods.task.fail = (o: Val) => {
  failTask(o.__force, o.__queue, o.__id, currentRobot().id)
}

hostMethods.tasks.push = (_o: Val, _k: Val, queue: Val, data: Val, options: Val) => {
  const priority = type(options) === "table" && type(options.priority) === "number" ? (options.priority as number) : 0
  pushTask(force(), keyOf(queue), packData(data), priority)
}
hostMethods.tasks.size = (_o: Val, _k: Val, queue: Val) => {
  let count = 0
  for (const item of queueOf(force(), keyOf(queue)).items) if (item.leasedBy === undefined) count++
  return count
}
hostMethods.tasks.next = (_o: Val, k: Val, queue: Val, options: Val) => {
  if (k !== undefined) return finishWaiting(k)
  const name = keyOf(queue)
  const forceName = force()
  const robotId = currentRobot().id
  const leaseTicks = ticks(type(options) === "table" ? options.lease : undefined, DEFAULT_LEASE_SECONDS)
  const item = lease(forceName, name, robotId, leaseTicks)
  if (item !== undefined) return $multi(taskValue(forceName, name, item))
  const timeout = type(options) === "table" ? options.timeout : undefined
  return startWaiting("tasks.next", (frame) => {
    frame.__taskQueue = name
    frame.__taskForce = forceName
    frame.lease = leaseTicks
    queueOf(forceName, name).waiters.push(robotId)
    if (timeout !== undefined) {
      frame.__poll = "taskTimeout"
      sleepUntil(robotId, game.tick + ticks(timeout, 0), frame)
    }
  })
}

registerPoll("taskTimeout", (record) => resume(record, undefined))
