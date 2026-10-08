// Settings stage: объявление настроек мода (Настройки -> Моды).
// setting_type: "startup" (меняется только с перезапуском, доступна в data stage),
// "runtime-global" (общая для карты), "runtime-per-user" (у каждого игрока своя).
import { SettingsData } from "factorio:common"
import { BoolSettingDefinition, IntSettingDefinition, StringSettingDefinition } from "factorio:settings"

declare const data: SettingsData

data.extend([
  {
    type: "bool-setting",
    name: "automaton-show-greeting",
    setting_type: "runtime-per-user",
    default_value: true,
  } satisfies BoolSettingDefinition,
  {
    type: "int-setting",
    name: "automaton-instructions-per-tick",
    setting_type: "runtime-global",
    default_value: 20000,
    minimum_value: 100,
    maximum_value: 10000000,
  } satisfies IntSettingDefinition,
  {
    type: "string-setting",
    name: "automaton-publish-rights",
    setting_type: "runtime-global",
    default_value: "everyone",
    allowed_values: ["everyone", "admins"],
  } satisfies StringSettingDefinition,
])
