// Подсказки игры (14.3): своя категория «Автоматоны» в окне советов (tips and tricks). Тексты — в локали
// ([tips-and-tricks-item-name], [tips-and-tricks-item-description]); первая подсказка открыта сразу.
import { PrototypeData } from "factorio:common"
import { TipsAndTricksItem, TipsAndTricksItemCategory } from "factorio:prototype"
import { WORKER_MK1 } from "../names"

declare const data: PrototypeData

const category: TipsAndTricksItemCategory = { type: "tips-and-tricks-item-category", name: "automaton", order: "0-[automaton]" }

const TIPS = ["automaton-intro", "automaton-programs", "automaton-markers", "automaton-vscode", "automaton-water", "automaton-team"]

const items: TipsAndTricksItem[] = TIPS.map((name, i) => ({
  type: "tips-and-tricks-item",
  name,
  category: "automaton",
  order: String.fromCharCode(97 + i),
  indent: i === 0 ? 0 : 1,
  is_title: i === 0,
  starting_status: i === 0 ? "unlocked" : "locked",
  // Остальные открываются, когда поставлена первая машина.
  trigger: i === 0 ? undefined : { type: "build-entity", entity: WORKER_MK1 },
  dependencies: i === 0 ? undefined : ["automaton-intro"],
}))

data.extend([category, ...items])
