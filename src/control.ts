// Runtime stage: события, команды, GUI.
// Данные, которые должны пережить сохранение, лежат в `storage` (тип — в storage.d.ts).
import { initDemoStorage, registerDemo } from "./demo"

script.on_init(() => initDemoStorage())
script.on_configuration_changed(() => initDemoStorage())

registerDemo()

// Внутриигровые тесты (npm run test:game): только при включённом служебном моде automaton-test.
// Имя модуля — через переменную: TSTL не ищет его заранее, а в zip мода тестов нет (package.ignore).
if (script.active_mods["automaton-test"] !== undefined) {
  const testRunner = "test.runner"
  require(testRunner)
}
