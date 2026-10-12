// @program Строитель
// Строит по чертежу: берёт на складе то, что нужно призракам у метки, и ставит здания.
// Как запустить:
//   1. Положите чертёж (призраки зданий) и поставьте рядом метку автоматонов «стройка».
//   2. Поставьте сундук с предметами для построек, рядом с ним — метку «склад».
//   3. Запустите на машине программу «Строитель». Параметры (необязательно): {"site": "стройка", "depot": "склад"}.
// Нужно исследование «Строительство автоматонами». Машина видит призраки в радиусе зрения от метки «стройка».
// Общие функции — из библиотеки «lib/Помощники».

import { chestAt } from "./lib/Помощники";

const { site, depot } = me.args<{ site?: string; depot?: string }>();
const siteName = site ?? "стройка";
const depotName = depot ?? "склад";
me.label = "строю";

while (true) {
  me.move(marker(siteName), { radius: 3 });
  const ghosts = scan.ghosts();
  if (ghosts.length === 0) {
    me.say("Всё построено", 5);
    wait(10);
    continue;
  }
  // Сколько каких предметов нужно видимым призракам.
  const need = new Map<Item, number>();
  for (const ghost of ghosts) need.set(ghost.item, (need.get(ghost.item) ?? 0) + 1);

  const chest = chestAt(depotName);
  for (const [item, count] of need) {
    const missing = count - me.cargo.count(item);
    if (missing > 0 && chest.count(item) > 0) chest.extract(item, missing);
  }

  me.move(marker(siteName), { radius: 3 });
  let built = 0;
  for (const ghost of scan.ghosts()) {
    if (!ghost.valid || me.cargo.count(ghost.item) === 0) continue;
    me.move(ghost, { radius: 3 });
    try {
      ghost.build();
      built++;
    } catch (e) {
      // Призрак уже построили дроны или место занято (дерево, машина) — к следующему.
      if (!(e instanceof ActionError)) throw e;
    }
  }
  if (built === 0) {
    me.say(`Нечем строить: ${[...need.keys()].join(", ")}`, 10);
    wait(10);
  }
}
