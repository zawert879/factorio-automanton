// Runtime stage: события, команды, GUI.
// Данные, которые должны пережить сохранение, лежат в `storage` (тип — в storage.d.ts).
import { initActions, registerActions } from "./automaton/actions"
import { registerAppearance } from "./automaton/appearance"
import { initMining } from "./automaton/mining"
import "./automaton/handling"
import "./automaton/transfer"
import "./automaton/fluids"
import "./automaton/charging"
import "./automaton/construction"
import { registerCombat } from "./automaton/combat"
import { initFlight, registerFlight } from "./automaton/flight"
import { initMovement, registerMovement } from "./automaton/movement"
import { registerModels } from "./automaton/models"
import { registerBlueprints } from "./automaton/blueprints"
import { registerPlacement } from "./automaton/placement"
import { adoptUnregisteredRobots, initRegistry, registerRegistryEvents } from "./automaton/registry"
import { registerDebugCommands } from "./debug/commands"
import { initSchema, migrate } from "./migrations"
import { initDemoStorage, registerDemo } from "./demo"
import { onEvent } from "./events"
import { closeModWindows, registerGuiEvents } from "./gui/common"
import { registerFleetWindow } from "./gui/fleet"
import { registerHelpWindow } from "./gui/help"
import { registerMachineWindow } from "./gui/machine"
import { registerProgramsWindow } from "./gui/programs"
import { registerPicker } from "./gui/picker"
import { registerAssignTools } from "./gui/assignTools"
import { registerAlerts } from "./program/alerts"
import { registerActionApi } from "./program/api"
import { registerProgramCommands } from "./program/commands"
import { initSync, registerSync } from "./program/sync"
import { forgetEntityHandle, initHandles } from "./program/handles"
import { initMachines, registerMachines } from "./program/machines"
import { initScheduler, registerScheduler } from "./program/scheduler"
import { initPrograms } from "./program/store"
import { initComms, registerComms } from "./program/comms"
import { initBoard, registerBoard } from "./program/board"
import { registerCache } from "./program/cache"
import { initMarkers, registerMarkers } from "./world/markers"
import { initDisplays, registerDisplays } from "./world/displays"
import { initStart } from "./world/start"
import { registerNaming } from "./world/naming"
import { initZones, registerZones } from "./world/zones"

function initStorage(): void {
  initDemoStorage()
  // Имя карты — до любых публикаций: публикация выгружает файлы в папку карты.
  initSync()
  initRegistry()
  initMovement()
  initFlight()
  initActions()
  initMining()
  initPrograms()
  initMachines()
  initScheduler()
  initHandles()
  initMarkers()
  initDisplays()
  initZones()
  initComms()
  initBoard()
  initStart()
}

script.on_init(() => {
  initStorage()
  initSchema()
})
script.on_configuration_changed(() => {
  initStorage()
  migrate()
  closeModWindows()
  adoptUnregisteredRobots()
})

registerDemo()
registerPlacement()
registerBlueprints()
registerModels()
registerCombat()
registerFlight()
registerRegistryEvents()
registerMovement()
registerAppearance()
registerActions()
registerDebugCommands()
registerMarkers()
registerDisplays()
registerZones()
registerNaming()
registerMachines()
registerScheduler()
registerActionApi()
registerProgramCommands()
registerSync()
registerAlerts()
registerGuiEvents()
registerMachineWindow()
registerProgramsWindow()
registerHelpWindow()
registerFleetWindow()
registerPicker()
registerAssignTools()
registerComms()
registerBoard()
registerCache()
// Здание исчезло — его обёртка у программ остаётся (valid === false), но из общего списка уходит.
onEvent(defines.events.on_object_destroyed, (e) => {
  if (e.type === defines.target_type.entity) forgetEntityHandle(e.useful_id)
})

// Проверки, которые включаются только служебными модами (их создают скрипты в tools/test/):
// automaton-test — внутриигровые тесты (npm run test:game),
// automaton-desync-test — снимок состояния для проверки сохранения/загрузки (npm run test:desync),
// automaton-visual — сцена для снимков экрана (npm run shot),
// automaton-bench — бенчмарк языка в Lua Factorio (npm run bench:game),
// automaton-bench-flyers — нагрузочный тест летающих (npm run bench:flyers),
// automaton-bench-machines — стресс-тест машин с программами (npm run bench:machines),
// automaton-build-science — сохранение с демо-фабрикой науки (npm run demo:science),
// automaton-record — анимации для документации (npm run docs:record).
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
          : script.active_mods["automaton-bench-flyers"] !== undefined
            ? "test.flyersBench"
            : script.active_mods["automaton-bench-machines"] !== undefined
              ? "test.machinesBench"
              : script.active_mods["automaton-build-science"] !== undefined
                ? "test.scienceBuild"
                : script.active_mods["automaton-record"] !== undefined
                  ? "test.record"
                  : undefined
if (testModule !== undefined) {
  require(testModule)
}
