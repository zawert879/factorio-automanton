// Связь между машинами (9.1): сообщения, подписки, запросы с ответом. Состояние — в storage.
// Рассылки «всем» нет: машина публикует (publish), получают те, кто подписан именно на неё (subscribe(id)) —
// цена публикации — число её подписчиков, а не всех машин (рассылка всем росла как N²).
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
  /** Данные общие для нескольких получателей (publish): копируются при чтении. */
  shared?: boolean
}

export interface CommsState {
  nextId: number
  /** at — тик доставки (следующий после отправки). */
  outbox: { to: number; mail: Mail; at: number }[]
  inbox: Record<number, Mail[] | undefined>
  dropped: Record<number, number | undefined>
  /** Подписчики: машина-источник → подписчик → темы ("" — все темы источника). */
  followers: Record<number, Record<number, Record<string, true | undefined> | undefined> | undefined>
  /** Обратный индекс: подписчик → источники (сброс подписок при перезапуске программы). */
  following: Record<number, Record<number, true | undefined> | undefined>
}

export const INBOX_SIZE = 64

export function initComms(): void {
  storage.comms ??= { nextId: 1, outbox: [], inbox: {}, dropped: {}, followers: {}, following: {} }
  storage.comms.followers ??= {}
  storage.comms.following ??= {}
  // До подписок на машину были подписки на темы (рассылка всем) — они больше ничего не значат.
  ;(storage.comms as { subscriptions?: unknown }).subscriptions = undefined
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

/** Подписать машину на публикации источника (topic "" — все темы). */
export function follow(subscriber: number, source: number, topic: string): void {
  const comms = storage.comms
  const topics = ((comms.followers[source] ??= {})[subscriber] ??= {})
  topics[topic] = true
  ;(comms.following[subscriber] ??= {})[source] = true
}

/** Отписать от источника: от темы или (topic undefined) совсем. */
export function unfollow(subscriber: number, source: number, topic?: string): void {
  const comms = storage.comms
  const followers = comms.followers[source]
  const topics = followers?.[subscriber]
  if (followers === undefined || topics === undefined) return
  if (topic !== undefined) {
    topics[topic] = undefined
    if (next(topics)[0] !== undefined) return
  }
  followers[subscriber] = undefined
  if (next(followers)[0] === undefined) comms.followers[source] = undefined
  const following = comms.following[subscriber]
  if (following !== undefined) {
    following[source] = undefined
    if (next(following)[0] === undefined) comms.following[subscriber] = undefined
  }
}

/** Снять все подписки машины (её собственные). */
function unfollowAll(subscriber: number): void {
  const sources: number[] = []
  for (const [source] of pairs(storage.comms.following[subscriber] ?? {})) sources.push(source)
  for (const source of sources) unfollow(subscriber, source)
}

/** Перезапуск программы: пустой ящик и без своих подписок (подписчики на машину остаются). */
function forget(robotId: number): void {
  const comms = storage.comms
  comms.inbox[robotId] = undefined
  comms.dropped[robotId] = undefined
  unfollowAll(robotId)
}

/** Машины нет (уничтожена или подобрана): и её подписки, и подписки на неё. */
function forgetRobot(robotId: number): void {
  forget(robotId)
  const subscribers: number[] = []
  for (const [subscriber] of pairs(storage.comms.followers[robotId] ?? {})) subscribers.push(subscriber)
  for (const subscriber of subscribers) unfollow(subscriber, robotId)
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
  // Новый запуск программы начинается с пустым ящиком и без своих подписок.
  onMachineReset((robotId) => forget(robotId))
  onRobotRemoved((robotId) => forgetRobot(robotId))
}
