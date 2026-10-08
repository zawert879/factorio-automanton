// Общие обработчики событий: у мода на каждое событие один обработчик, а слушать нужно из разных модулей.
// Подписка — только при загрузке control (одинаково у всех игроков), не по ходу игры.
import { EventId } from "factorio:runtime"

const tickHandlers: Array<(this: void, tick: number) => void> = []

/** Вызывать handler каждый тик. */
export function onTick(handler: (this: void, tick: number) => void): void {
  tickHandlers.push(handler)
  if (tickHandlers.length === 1) {
    script.on_event(defines.events.on_tick, (event) => {
      for (const h of tickHandlers) h(event.tick)
    })
  }
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
