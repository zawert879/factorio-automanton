// Runtime stage: события, команды, GUI.
// Данные, которые должны пережить сохранение, лежат в `storage` (тип — в storage.d.ts).
import { initDemoStorage, registerDemo } from "./demo"

script.on_init(() => initDemoStorage())
script.on_configuration_changed(() => initDemoStorage())

registerDemo()
