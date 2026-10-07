// Проверка сохранения/загрузки посреди работы (npm run test:desync): на тике DUMP_TICK
// записывает полный снимок storage в script-output/automaton-state.txt.
// Подключается из control.ts, только когда включён служебный мод automaton-desync-test.

const DUMP_TICK = 600 // как в tools/test/desync.mjs

script.on_nth_tick(DUMP_TICK, (event) => {
  if (event.tick !== DUMP_TICK) return
  const snapshot = serpent.block(storage, { sortkeys: true, comment: false })
  helpers.write_file("automaton-state.txt", `tick ${event.tick}\n${snapshot}\n`, false)
})

export {}
