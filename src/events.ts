// Общие обработчики событий: у мода на каждое событие один обработчик, а слушать нужно из разных модулей.
// Подписка — только при загрузке control (одинаково у всех игроков), не по ходу игры.
import { EventId, LuaProfiler } from "factorio:runtime"

const tickHandlers: Array<(this: void, tick: number) => void> = []
const tickNames: string[] = []

/** Профилирование обработчиков тика (бенчмарки): накопленное время по имени обработчика. */
let profiling: Map<string, LuaProfiler> | undefined

/** Вызывать handler каждый тик. */
export function onTick(handler: (this: void, tick: number) => void): void {
  tickHandlers.push(handler)
  // Имя для профилирования — файл и строка обработчика.
  const info = debug.getinfo(handler, "S")
  tickNames.push(info === undefined ? "tick" : `${info.short_src}:${info.linedefined}`)
  if (tickHandlers.length === 1) {
    script.on_event(defines.events.on_tick, (event) => {
      if (profiling !== undefined) return profiledTick(event.tick, profiling)
      for (const h of tickHandlers) h(event.tick)
    })
  }
}

function profiledTick(tick: number, totals: Map<string, LuaProfiler>): void {
  tickHandlers.forEach((h, i) => {
    const name = tickNames[i]
    const profiler = game.create_profiler()
    h(tick)
    profiler.stop()
    let total = totals.get(name)
    if (total === undefined) {
      total = game.create_profiler(true)
      totals.set(name, total)
    }
    total.add(profiler)
  })
}

/** Включить профилирование обработчиков тика; вернуть накопленное (для лога). */
export function startTickProfiling(): Map<string, LuaProfiler> {
  profiling = new Map()
  return profiling
}

const eventHandlers = new LuaMap<EventId<any>, Array<(this: void, data: any) => void>>()

/**
 * Подписаться на событие. Второй script.on_event на то же событие заменил бы первый, поэтому все
 * модули подписываются через эту функцию (без фильтров — проверка внутри обработчика).
 */
export function onEvent<T extends object>(event: EventId<T>, handler: (this: void, data: T) => void): void {
  let list = eventHandlers.get(event)
  if (list === undefined) {
    const handlers: Array<(this: void, data: any) => void> = []
    list = handlers
    eventHandlers.set(event, handlers)
    script.on_event(event, (data: any) => {
      for (const h of handlers) h(data)
    })
  }
  list.push(handler)
}
