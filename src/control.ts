// Runtime stage: события, команды, GUI.
// Данные, которые должны пережить сохранение, лежат в `storage` (тип — в storage.d.ts).
import { initActions, registerActions } from "./automaton/actions"
import { registerAppearance } from "./automaton/appearance"
import { initMining } from "./automaton/mining"
import "./automaton/handling"
import "./automaton/transfer"
import { initMovement, registerMovement } from "./automaton/movement"
import { registerPlacement } from "./automaton/placement"
import { adoptUnregisteredRobots, initRegistry, registerRegistryEvents } from "./automaton/registry"
import { registerDebugCommands } from "./debug/commands"
import { initDemoStorage, registerDemo } from "./demo"
import { onEvent } from "./events"
import { registerGuiEvents } from "./gui/common"
import { registerMachineWindow } from "./gui/machine"
import { registerProgramsWindow } from "./gui/programs"
import { registerAlerts } from "./program/alerts"
import { registerActionApi } from "./program/api"
import { registerProgramCommands } from "./program/commands"
import { forgetEntityHandle, initHandles } from "./program/handles"
import { initMachines, registerMachines } from "./program/machines"
import { initScheduler, registerScheduler } from "./program/scheduler"
import { initPrograms } from "./program/store"
import { initMarkers, registerMarkers } from "./world/markers"
import { registerNaming } from "./world/naming"
import { initZones, registerZones } from "./world/zones"

function initStorage(): void {
  initDemoStorage()
  initRegistry()
  initMovement()
  initActions()
  initMining()
  initPrograms()
  initMachines()
  initScheduler()
  initHandles()
  initMarkers()
  initZones()
}

script.on_init(() => initStorage())
script.on_configuration_changed(() => {
  initStorage()
  adoptUnregisteredRobots()
})

registerDemo()
registerPlacement()
registerRegistryEvents()
registerMovement()
registerAppearance()
registerActions()
registerDebugCommands()
registerMarkers()
registerZones()
registerNaming()
registerMachines()
registerScheduler()
registerActionApi()
registerProgramCommands()
registerAlerts()
registerGuiEvents()
registerMachineWindow()
registerProgramsWindow()
// Здание исчезло — его обёртка у программ остаётся (valid === false), но из общего списка уходит.
onEvent(defines.events.on_object_destroyed, (e) => {
  if (e.type === defines.target_type.entity) forgetEntityHandle(e.useful_id)
})

// Проверки, которые включаются только служебными модами (их создают скрипты в tools/test/):
// automaton-test — внутриигровые тесты (npm run test:game),
// automaton-desync-test — снимок состояния для проверки сохранения/загрузки (npm run test:desync),
// automaton-visual — сцена для снимков экрана (npm run shot),
// automaton-bench — бенчмарк языка в Lua Factorio (npm run bench:game).
// Имя модуля — через переменную: TSTL не ищет его заранее, а в zip мода папки test/ нет (package.ignore).
const testModule =
  script.active_mods["automaton-test"] !== undefined
    ? "test.runner"
    : script.active_mods["automaton-desync-test"] !== undefined
      ? "test.stateDump"
      : script.active_mods["automaton-visual"] !== undefined
        ? "test.visual"
        : script.active_mods["automaton-bench"] !== undefined
          ? "test.benchGame"
          : undefined
if (testModule !== undefined) {
  require(testModule)
}
