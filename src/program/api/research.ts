// Возможности API по исследованиям (8.4, таблица — docs/API.md, «Исследования»): функция без нужного
// исследования команды бросает ActionError("not-researched"). Обёртки ставятся поверх уже
// зарегистрированных функций, поэтому модуль подключается последним (src/program/api/index.ts).
import { LuaForce } from "factorio:runtime"
import { HOST_CLASSES } from "../../lang/hostClasses"
import { Fn, host, hostBlocking, hostGetters, hostMethods, Val } from "../../lang/runtime/core"
import { TECH } from "../../names"
import { actionError, currentRobot } from "../context"

/** Реализация в реестре host → технология: их вызывают radio.*, me.weapon.*, me.tank.pump, me.build; robot и display — глобальные. */
export const REQUIRED_RESEARCH: Record<string, string> = {
  send: TECH.radio,
  publish: TECH.radio,
  subscribe: TECH.radio,
  unsubscribe: TECH.radio,
  receive: TECH.radio,
  tryReceive: TECH.radio,
  request: TECH.radio,
  robot: TECH.radio,
  display: TECH.display,
  attack: TECH.combat1,
  guard: TECH.combat1,
  patrol: TECH.combat1,
  reload: TECH.combat1,
  pump: TECH.fluids,
  build: TECH.construction,
}

/** Методы объектов API → технология. */
const REQUIRED_METHODS: Record<string, Record<string, string>> = {
  scan: { enemies: TECH.sensors2 },
  weapon: { equip: TECH.gear, unequip: TECH.gear },
  armor: { equip: TECH.gear, unequip: TECH.gear },
  board: {
    get: TECH.radio,
    set: TECH.radio,
    delete: TECH.radio,
    keys: TECH.radio,
    increment: TECH.radio,
    compareAndSet: TECH.radio,
    claim: TECH.radio,
    release: TECH.radio,
  },
  tasks: { push: TECH.radio, next: TECH.radio, size: TECH.radio },
  signals: { read: TECH.circuits, readAll: TECH.circuits, write: TECH.circuits },
}

export function researched(tech: string): boolean {
  return (currentRobot().entity.force as LuaForce).technologies[tech]?.researched === true
}

export function requireResearch(what: string, tech: string): void {
  if (!researched(tech)) actionError("not-researched", `${what} needs the research ${tech}`)
}

/** Обернуть функцию API проверкой исследования (у блокирующих — только при первом вызове, не при продолжении). */
export function gate(name: string, tech: string): void {
  const original = host[name]
  if (original === undefined) return
  if (hostBlocking[name]) {
    host[name] = (k: Val, ...args: Val[]) => {
      if (k === undefined) requireResearch(name, tech)
      return original(k, ...args)
    }
  } else {
    host[name] = (...args: Val[]) => {
      requireResearch(name, tech)
      return original(...args)
    }
  }
}

for (const [name, tech] of pairs(REQUIRED_RESEARCH)) gate(name, tech)
for (const [object, methods] of pairs(REQUIRED_METHODS)) {
  for (const [method, tech] of pairs(methods)) {
    const original = hostMethods[object][method]
    // У блокирующих методов (tasks.next) второй аргумент — продолжение: проверка только при первом вызове.
    hostMethods[object][method] = (o: Val, k: Val, ...args: Val[]) => {
      if (k === undefined) requireResearch(`${object}.${method}`, tech)
      return original(o, k, ...args)
    }
  }
}

// Методы зданий (19.3) — в таблицах классов, где они свои (подклассы берут обёртку у родителя через __index).
const CLASS_METHOD_RESEARCH: Record<string, string> = {
  fill: TECH.fluids,
  drain: TECH.fluids,
  setRecipe: TECH.tuning,
  rotate: TECH.construction,
  deconstruct: TECH.construction,
  build: TECH.construction,
}
for (const [cls] of HOST_CLASSES) {
  const table = hostMethods[cls]
  for (const [method, tech] of pairs(CLASS_METHOD_RESEARCH)) {
    const original = rawget(table, method) as Fn | undefined
    if (original === undefined) continue
    rawset(table, method, (o: Val, k: Val, ...args: Val[]) => {
      if (k === undefined) requireResearch(method, tech)
      return original(o, k, ...args)
    })
  }
}

// Бак есть у всех моделей, но без «Жидкостей» он не подключён: me.tank === null.
const tankGetter = hostGetters.me.tank
hostGetters.me.tank = (...args: Val[]) => (researched(TECH.fluids) ? tankGetter(...args) : undefined)
