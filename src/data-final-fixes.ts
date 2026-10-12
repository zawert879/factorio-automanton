// Data stage, последний шаг (после всех модов): удаление ванили — по типам прототипов, поэтому задевает
// и такие же здания других модов (src/prototypes/removal.ts); слой столкновений машин — у всего, кроме ворот
// (src/prototypes/gates.ts), тоже после всех модов.
import { letAutomatonsThroughGates } from "./prototypes/gates"
import { removeVanilla } from "./prototypes/removal"

removeVanilla()
letAutomatonsThroughGates()
