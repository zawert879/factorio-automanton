// Бенчмарк языка в Lua самой Factorio (npm run bench:game): замеры профайлером игры — в лог,
// строки «BENCH <нагрузка> | <вариант>: Duration: … ms». Запуск на первом тике: on_init занят модом.
import { runLangBench } from "./langBench"

script.on_nth_tick(1, () => {
  script.on_nth_tick(1, undefined)
  runLangBench((label, fn) => {
    const profiler = helpers.create_profiler()
    fn()
    profiler.stop()
    log(["", "BENCH ", label, ": ", profiler])
  })
})
