// Settings stage: объявление настроек мода (Настройки -> Моды).
// setting_type: "startup" (меняется только с перезапуском, доступна в data stage),
// "runtime-global" (общая для карты), "runtime-per-user" (у каждого игрока своя).
import { SettingsData } from "factorio:common"
import { BoolSettingDefinition } from "factorio:settings"

declare const data: SettingsData

data.extend([
  {
    type: "bool-setting",
    name: "automaton-show-greeting",
    setting_type: "runtime-per-user",
    default_value: true,
  } satisfies BoolSettingDefinition,
])
