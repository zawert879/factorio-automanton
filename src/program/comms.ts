// Связь между машинами (9.1): сообщения, подписки, запросы с ответом. Состояние — в storage.
// Отправленное лежит в «исходящих» и доставляется на следующем тике: если получатель ждёт такое
// сообщение (receive по теме, ответ на свой request) — оно сразу будит его, иначе ложится во входящий
// ящик (64 сообщения, при переполнении выбрасываются самые старые). Данные копируются при отправке
// (у каждого получателя своя копия), поэтому в storage — только простые данные и ссылки на объекты игры.
import { onRobotRemoved } from "../automaton/registry"
import { onTick } from "../events"
import { Val } from "../lang/runtime/core"
import { onMachineReset } from "./machines"
import { resume, waitingFrame } from "./scheduler"

export interface Mail {
  id: number
  /** id машины-отправителя. */
  from: number
  topic: string
  data: Val
  sentAt: number
  /** Это ответ на запрос с этим номером (reply). */
  replyTo?: number
  /** Это запрос: отправитель ждёт ответа с этим номером. */
  request?: number
}

export interface CommsState {
  nextId: number
  /** at — тик доставки (следующий после отправки). */
  outbox: { to: number; mail: Mail; at: number }[]
  inbox: Record<number, Mail[] | undefined>
  dropped: Record<number, number | undefined>
  /** Подписки на темы broadcast: машина → тема → да. */
  subscriptions: Record<number, Record<string, boolean | undefined> | undefined>
}

export const INBOX_SIZE = 64

export function initComms(): void {
  storage.comms ??= { nextId: 1, outbox: [], inbox: {}, dropped: {}, subscriptions: {} }
}

export function nextMailId(): number {
  return storage.comms.nextId++
}

/** Отправить (доставка — на следующем тике). Данные уже скопированы вызывающим. */
export function post(to: number, mail: Mail): void {
  storage.comms.outbox.push({ to, mail, at: game.tick + 1 })
}

/** Подходит ли сообщение ожиданию receive (тема не указана — любое, кроме ответов). */
export function matches(mail: Mail, topic: string | undefined): boolean {
  return mail.replyTo === undefined && (topic === undefined || mail.topic === topic)
}

/** Взять из ящика первое подходящее. */
export function takeFromInbox(robotId: number, topic: string | undefined): Mail | undefined {
  const box = storage.comms.inbox[robotId]
  if (box === undefined) return undefined
  for (let i = 0; i < box.length; i++) {
    if (matches(box[i], topic)) return box.splice(i, 1)[0]
  }
  return undefined
}

/** Как сообщение становится значением программы (задаёт api/comms.ts — там обёртки). */
let toProgram: (this: void, mail: Mail) => Val = (mail) => mail

export function setMessageWrapper(wrap: (this: void, mail: Mail) => Val): void {
  toProgram = wrap
}

function deliver(to: number, mail: Mail): void {
  const record = storage.machines[to]
  const robot = storage.robots.byId[to]
  if (record === undefined || robot === undefined || record.parked) return
  const frame = waitingFrame(to)
  if (mail.replyTo !== undefined) {
    // Ответ нужен только тому, кто ждёт именно его; опоздавший ответ выбрасывается.
    if (frame?.__request === mail.replyTo) resume(record, mail.data)
    return
  }
  if (frame?.__receive && matches(mail, frame.topic)) {
    resume(record, toProgram(mail))
    return
  }
  const box = (storage.comms.inbox[to] ??= [])
  box.push(mail)
  while (box.length > INBOX_SIZE) {
    box.shift()
    storage.comms.dropped[to] = (storage.comms.dropped[to] ?? 0) + 1
  }
}

/** Подписан ли робот на тему. */
export function subscribed(robotId: number, topic: string): boolean {
  return storage.comms.subscriptions[robotId]?.[topic] === true
}

function forget(robotId: number): void {
  const comms = storage.comms
  comms.inbox[robotId] = undefined
  comms.dropped[robotId] = undefined
  comms.subscriptions[robotId] = undefined
}

export function registerComms(): void {
  onTick((tick) => {
    const comms = storage.comms
    if (comms.outbox.length === 0) return
    const batch = comms.outbox
    comms.outbox = []
    for (const entry of batch) {
      if (entry.at <= tick) deliver(entry.to, entry.mail)
      else comms.outbox.push(entry)
    }
  })
  // Новый запуск программы начинается с пустым ящиком и без подписок.
  onMachineReset((robotId) => forget(robotId))
  onRobotRemoved((robotId) => forget(robotId))
}
