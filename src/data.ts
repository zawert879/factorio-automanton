// Data stage: прототипы (предметы, рецепты, здания, технологии).
// Порядок загрузки: data всех модов -> data-updates -> data-final-fixes.
// Новые прототипы добавляются через data.extend([...]), существующие правятся через data.raw.
import { PrototypeData } from "factorio:common"

declare const data: PrototypeData

export {}
