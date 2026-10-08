// Data stage, последний шаг (после всех модов): удаление ванили — по типам прототипов, поэтому задевает
// и такие же здания других модов (src/prototypes/removal.ts).
import { removeVanilla } from "./prototypes/removal"

removeVanilla()
