// @program Печник
// Обслуживает печи в зоне: подкладывает руду и уголь из сундука у одной метки, плиты отвозит
// в сундук у другой.
// Как запустить:
//   1. Выделите печи «Программатором» (ярлык на панели) и назовите зону «плавильня».
//   2. Метка «склад» — у сундука с рудой и углём (туда же возит «Шахтёр»), метка «плиты» — у пустого сундука.
//   3. Параметры (необязательно): {"ore": "iron-ore", "zone": "плавильня", "from": "склад", "to": "плиты"}.

import { attempt, chestAt } from "./lib/Помощники";

const args = me.args<{ ore?: Item; zone?: string; from?: string; to?: string }>();
const ore: Item = args.ore ?? "iron-ore";
const area = zone(args.zone ?? "плавильня");
const from = args.from ?? "склад";
const to = args.to ?? "плиты";
const ORE_PER_FURNACE = 10;
const COAL_PER_FURNACE = 2;

while (true) {
  const furnaces = find({ type: "furnace" }, area);
  if (furnaces.length === 0) {
    alert(`${me.name}: в зоне «${area.name}» нет печей`);
    exit();
  }

  // Загрузиться на все печи сразу (то, что не влезло в печи в прошлый раз, уже в грузе).
  const source = chestAt(from);
  if (me.fuel < 0.5) {
    // refuel перекладывает в топливо весь уголь из груза — поэтому до того, как брать уголь для печей.
    attempt(() => take(source, "coal", 5), "топливо");
    if (me.cargo.count("coal") > 0) refuel("coal");
  }
  const needOre = ORE_PER_FURNACE * furnaces.length - me.cargo.count(ore);
  const needCoal = COAL_PER_FURNACE * furnaces.length - me.cargo.count("coal");
  if (needOre > 0) attempt(() => take(source, ore, needOre), "руда");
  if (needCoal > 0) attempt(() => take(source, "coal", needCoal), "уголь");

  // Обойти печи: забрать готовое, подложить уголь и руду.
  for (const furnace of furnaces) {
    move(furnace);
    for (const stack of furnace.output()?.items() ?? []) attempt(() => take(furnace, stack.name, stack.count), "плиты");
    if (me.cargo.count("coal") > 0) attempt(() => put(furnace, "coal", COAL_PER_FURNACE), "уголь в печь");
    if (me.cargo.count(ore) > 0) attempt(() => put(furnace, ore, ORE_PER_FURNACE), "руда в печь");
  }

  // Отвезти плиты (всё, кроме руды и угля).
  const plates = me.cargo.items().filter((s) => s.name !== ore && s.name !== "coal");
  if (plates.length > 0) {
    const target = chestAt(to);
    for (const stack of plates) attempt(() => put(target, stack.name, stack.count), "плиты в сундук");
  } else {
    wait(5);
  }
}
