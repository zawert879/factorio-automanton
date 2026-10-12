// @program Заправщик
// Возит уголь тем, кто попросил. Просьба — сообщение «топливо», в data — машина или здание.
// Машине Mk1 — в топливный слот, печи, котлу или локомотиву — в топливо; что это, выясняет instanceof.
// Параметры (необязательно): {"depot": "склад"} — метка у сундука с углём.

import { attempt, chestAt } from "./lib/Помощники";

const depot = me.args<{ depot?: string }>().depot ?? "склад";

while (true) {
  const msg = radio.receive("топливо");
  if (msg === null) continue;
  if (me.cargo.count("coal") < 10) attempt(() => chestAt(depot).extract("coal", 50), "уголь");

  const target = msg.data;
  if (target instanceof Robot) {
    me.move(target);
    target.refuel("coal");
  } else if (target instanceof Furnace || target instanceof Boiler || target instanceof Locomotive) {
    me.move(target);
    target.insert("coal", 10);
  } else {
    print(`не знаю, как заправить: ${JSON.stringify(target)}`);
  }
  msg.reply("готово");
}
