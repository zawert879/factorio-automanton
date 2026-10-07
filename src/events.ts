// Общие обработчики событий: у мода на каждое событие один обработчик, а слушать нужно из разных модулей.
// Подписка — только при загрузке control (одинаково у всех игроков), не по ходу игры.

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
