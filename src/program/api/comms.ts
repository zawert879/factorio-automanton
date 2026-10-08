// Связь (9.1, 9.2): send, publish, subscribe, unsubscribe, receive, tryReceive, request, robot, inbox;
// сообщение — объект message (from, topic, data, sentAt, reply). Доставка, ящики и подписки — src/program/comms.ts.
import { LuaForce } from "factorio:runtime"
import { charge, defineHostObject, host, hostBlocking, hostGetters, hostMethods, Val } from "../../lang/runtime/core"
import { measure } from "../../lang/runtime"
import { RobotRecord } from "../../automaton/registry"
import { follow, INBOX_SIZE, Mail, matches, nextMailId, post, setMessageWrapper, takeFromInbox, unfollow } from "../comms"
import { actionError, actionErrorValue, currentRobot } from "../context"
import { robotHandle } from "../handles"
import { registerPoll, resume, sleepUntil } from "../scheduler"
import { copyValue } from "../values"
import { finishWaiting, startWaiting, text, ticks } from "./common"

/** Предел размера данных сообщения, единиц памяти (таблица — 1, элемент — 1/8). */
export const MAX_MESSAGE_UNITS = 2000
const MAX_TOPIC_BYTES = 200

/** Копия данных для отправки: простые данные и ссылки на объекты игры; не больше MAX_MESSAGE_UNITS. */
export function packData(data: Val): Val {
  const copy = copyValue(data)
  if (type(copy) === "table" && measure(copy, MAX_MESSAGE_UNITS + 1) > MAX_MESSAGE_UNITS) {
    actionError("limit-exceeded", `message data is larger than ${MAX_MESSAGE_UNITS} units`)
  }
  return copy
}

function topicOf(value: Val): string {
  const topic = text(value)
  if (topic.length > MAX_TOPIC_BYTES) actionError("limit-exceeded", "topic is too long")
  return topic
}

/** Машина своей команды по ссылке, id или имени (нет — undefined). */
export function findTeammate(value: Val): RobotRecord | undefined {
  const force = currentRobot().entity.force as LuaForce
  let record: RobotRecord | undefined
  if (type(value) === "table" && value.__t === "host" && value.__h === "robot") record = storage.robots.byId[value.__id]
  else if (type(value) === "number") record = storage.robots.byId[value as number]
  else if (type(value) === "string") {
    for (const [, candidate] of pairs(storage.robots.byId)) {
      if (candidate.name === value && candidate.entity.valid && candidate.entity.force === force) {
        record = candidate
        break
      }
    }
  }
  if (record === undefined || !record.entity.valid || record.entity.force !== force) return undefined
  return record
}

function recipient(value: Val): number {
  const record = findTeammate(value)
  if (record === undefined) actionError("invalid-target", `no robot ${tostring(type(value) === "table" ? value.__id : value)}`)
  return record.id
}

function newMail(topic: string, data: Val, extra?: Partial<Mail>): Mail {
  return { id: nextMailId(), from: currentRobot().id, topic, data, sentAt: game.tick, ...extra }
}

// ---------- Сообщение как значение программы ----------

defineHostObject("message")
hostGetters.message.from = (o: Val) => robotHandle((o.__mail as Mail).from)
hostGetters.message.topic = (o: Val) => (o.__mail as Mail).topic
// Данные письма общие у всех получателей publish: своя копия — только когда программа их читает
// (большинство писем при рассылке на сотни машин не читают — переполненный ящик их выбрасывает).
hostGetters.message.data = (o: Val) => {
  const mail = o.__mail as Mail
  if (!mail.shared) return mail.data
  o.__data ??= copyValue(mail.data)
  return o.__data
}
hostGetters.message.sentAt = (o: Val) => (o.__mail as Mail).sentAt
hostMethods.message.reply = (o: Val, _k: Val, data: Val) => {
  const mail = o.__mail as Mail
  // Ответ на request ждёт только отправитель; на обычное сообщение — обычное сообщение с той же темой.
  post(mail.from, newMail(mail.topic, packData(data), mail.request !== undefined ? { replyTo: mail.request } : undefined))
}

function messageValue(mail: Mail): Val {
  charge(1)
  return { __t: "host", __h: "message", __mail: mail }
}
setMessageWrapper(messageValue)

// ---------- Функции ----------

host.send = (to: Val, topic: Val, data: Val) => {
  post(recipient(to), newMail(topicOf(topic), packData(data)))
}

host.publish = (topic: Val, data: Val) => {
  const name = topicOf(topic)
  const me = currentRobot()
  const followers = storage.comms.followers[me.id]
  if (followers === undefined) return
  const force = me.entity.force_index
  const packed = packData(data)
  // Только подписанным на эту машину (на все её темы или на эту); данные — одна копия на всех.
  for (const [id, topics] of pairs(followers)) {
    if (!topics[""] && !topics[name]) continue
    const record = storage.robots.byId[id]
    if (record === undefined || !record.entity.valid || record.entity.force_index !== force) continue
    charge(1)
    post(id, newMail(name, packed, { shared: true }))
  }
}

/** Старые программы (до подписок на машину): понятная ошибка вместо «нет такой функции». */
host.broadcast = () => {
  actionError("invalid-target", "broadcast removed: publish(topic, data) reaches robots subscribed to you with subscribe(id, topic)")
}

host.subscribe = (robot: Val, topic: Val) => {
  const source = findTeammate(robot)
  if (source === undefined) {
    // Раньше подписывались на тему: subscribe("тема") — подсказать, что теперь на машину.
    actionError("invalid-target", `no robot ${tostring(type(robot) === "table" ? robot.__id : robot)} — subscribe(robot, topic?) subscribes to a robot`)
  }
  const me = currentRobot().id
  if (source.id === me) return
  follow(me, source.id, topic === undefined ? "" : topicOf(topic))
}

host.unsubscribe = (robot: Val, topic: Val) => {
  const source = findTeammate(robot)
  if (source !== undefined) unfollow(currentRobot().id, source.id, topic === undefined ? undefined : topicOf(topic))
}

host.tryReceive = (topic: Val) => {
  const mail = takeFromInbox(currentRobot().id, topic === undefined ? undefined : topicOf(topic))
  return mail === undefined ? undefined : messageValue(mail)
}

host.receive = (k: Val, topic: Val, timeout: Val) => {
  if (k !== undefined) return finishWaiting(k)
  const name = topic === undefined ? undefined : topicOf(topic)
  const mail = takeFromInbox(currentRobot().id, name)
  if (mail !== undefined) return $multi(messageValue(mail))
  const robotId = currentRobot().id
  return startWaiting("receive", (frame) => {
    frame.__receive = true
    frame.topic = name
    if (timeout !== undefined) {
      frame.__poll = "commsTimeout"
      sleepUntil(robotId, game.tick + ticks(timeout, 0), frame)
    }
  })
}
hostBlocking.receive = true

host.request = (k: Val, to: Val, topic: Val, data: Val, timeout: Val) => {
  if (k !== undefined) return finishWaiting(k)
  const target = recipient(to)
  const request = nextMailId()
  post(target, newMail(topicOf(topic), packData(data), { request }))
  const robotId = currentRobot().id
  return startWaiting("request", (frame) => {
    frame.__request = request
    if (timeout !== undefined) {
      frame.__poll = "commsTimeout"
      frame.__timeoutError = true
      sleepUntil(robotId, game.tick + ticks(timeout, 0), frame)
    }
  })
}
hostBlocking.request = true

// Таймаут: receive — null, request — ActionError("timeout").
registerPoll("commsTimeout", (record, frame) => {
  if (frame.__timeoutError) resume(record, undefined, actionErrorValue("timeout", "no reply"))
  else resume(record, undefined)
})

host.robot = (idOrName: Val) => {
  const record = findTeammate(idOrName)
  return record === undefined ? undefined : robotHandle(record.id)
}

defineHostObject("inbox")
hostGetters.inbox.count = () => {
  const id = currentRobot().id
  const box = storage.comms.inbox[id]
  let count = 0
  for (const mail of box ?? []) if (matches(mail, undefined)) count++
  return count
}
hostGetters.inbox.dropped = () => storage.comms.dropped[currentRobot().id] ?? 0
hostGetters.inbox.capacity = () => INBOX_SIZE
