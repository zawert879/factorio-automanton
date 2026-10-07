// Runtime stage: события, команды, GUI.
// Данные, которые должны пережить сохранение, лежат в `storage` (тип — в storage.d.ts).
import { initMovement, registerMovement } from "./automaton/movement"
import { registerPlacement } from "./automaton/placement"
import { adoptUnregisteredRobots, initRegistry, registerRegistryEvents } from "./automaton/registry"
import { registerDebugCommands } from "./debug/commands"
import { initDemoStorage, registerDemo } from "./demo"

script.on_init(() => {
  initDemoStorage()
  initRegistry()
  initMovement()
})
script.on_configuration_changed(() => {
  initDemoStorage()
  initRegistry()
  initMovement()
  adoptUnregisteredRobots()
})

registerDemo()
registerPlacement()
registerRegistryEvents()
registerMovement()
registerDebugCommands()

// Проверки, которые включаются только служебными модами (их создают скрипты в tools/test/):
// automaton-test — внутриигровые тесты (npm run test:game),
// automaton-desync-test — снимок состояния для проверки сохранения/загрузки (npm run test:desync).
// Имя модуля — через переменную: TSTL не ищет его заранее, а в zip мода папки test/ нет (package.ignore).
const testModule =
  script.active_mods["automaton-test"] !== undefined
    ? "test.runner"
    : script.active_mods["automaton-desync-test"] !== undefined
      ? "test.stateDump"
      : undefined
if (testModule !== undefined) {
  require(testModule)
}
