// Возможности API по исследованиям (8.4, таблица — docs/API.md, «Исследования»): функция без нужного
// исследования команды бросает ActionError("not-researched"). Обёртки ставятся поверх уже
// зарегистрированных функций, поэтому модуль подключается последним (src/program/api/index.ts).
import { LuaForce } from "factorio:runtime"
import { host, hostBlocking, hostGetters, hostMethods, Val } from "../../lang/runtime/core"
import { TECH } from "../../names"
import { actionError, currentRobot } from "../context"

/** Функция API → технология. Связь, табло, цепи и бой добавятся с их этапами (9, 10). */
export const REQUIRED_RESEARCH: Record<string, string> = {
  pump: TECH.fluids,
  fill: TECH.fluids,
  drain: TECH.fluids,
  setRecipe: TECH.tuning,
  build: TECH.construction,
  deconstruct: TECH.construction,
  rotate: TECH.construction,
}

/** Методы объектов API → технология. */
const REQUIRED_METHODS: Record<string, Record<string, string>> = {
  scan: { enemies: TECH.sensors2 },
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
    hostMethods[object][method] = (...args: Val[]) => {
      requireResearch(`${object}.${method}`, tech)
      return original(...args)
    }
  }
}

// Бак есть у всех моделей, но без «Жидкостей» он не подключён: me.tank === null.
const tankGetter = hostGetters.me.tank
hostGetters.me.tank = (...args: Val[]) => (researched(TECH.fluids) ? tankGetter(...args) : undefined)
