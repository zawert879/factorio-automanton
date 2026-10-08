// @program Добытчик
// Копает руду (или уголь) у месторождения и возит в сундук у метки. Топливо: уголь — свой,
// для остальной руды — из сундука у метки «уголь» (если такая есть).
// Параметры: {"ore": "iron-ore", "depot": "железная руда", "coal": "уголь"}.

import { chestAt, nearestField, refuelFrom } from "./lib/Помощники";

const args = me.args<{ ore?: Item; depot?: string; coal?: string }>();
const ore: Item = args.ore ?? "iron-ore";
const depot = args.depot ?? "склад";
const coalDepot = args.coal ?? "уголь";
me.label = `копаю ${ore}`;

const home = nearestField(ore);
while (true) {
  refuelFrom(coalDepot);
  move(home);
  try {
    mine(ore, 40);
  } catch (e) {
    if (!(e instanceof ActionError) || (e.code !== "no-resource" && e.code !== "cargo-full")) throw e;
  }
  refuelFrom(coalDepot);
  const chest = chestAt(depot);
  try {
    put(chest, ore);
  } catch (e) {
    if (!(e instanceof ActionError) || e.code !== "target-full") throw e;
    say("Сундук полон — жду", 10);
    wait(10);
  }
}
