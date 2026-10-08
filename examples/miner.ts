// @program Шахтёр
// Добывает руду у месторождения и возит в сундук у метки.
// Как запустить:
//   1. Поставьте сундук, рядом с ним — метку автоматонов и назовите её «склад».
//   2. Поставьте машину у месторождения, откройте её окно и запустите программу «Шахтёр».
//   3. Параметры в окне машины (необязательно): {"ore": "iron-ore", "depot": "склад"}. По умолчанию — уголь.
// Пока везёт уголь, машина подкладывает его и себе в топливо.

const { ore, depot } = me.args<{ ore?: Item; depot?: string }>();
const item: Item = ore ?? "coal";
const depotName = depot ?? "склад";
me.label = `⛏ ${item}`;

/** Ближайшая клетка месторождения (машина должна стоять рядом с ним). */
function findField(): Position {
  const patch = scan.resources().find((p) => p.item === item);
  if (patch === undefined) {
    alert(`${me.name}: рядом нет месторождения ${item} — поставьте машину ближе`);
    exit();
  }
  return patch.nearest;
}

let field = findField();
while (true) {
  move(field);
  try {
    mine(item);
  } catch (e) {
    // Клетка выработана — ищем соседнюю.
    if (!(e instanceof ActionError) || e.code !== "no-resource") throw e;
    field = findField();
    continue;
  }
  if (me.fuel < 0.5 && me.cargo.count("coal") > 0) refuel("coal");

  move(marker(depotName), { radius: 2 });
  const chest = scan.entities({ type: ["container", "logistic-container"], radius: 4 })[0];
  if (chest === undefined) {
    alert(`${me.name}: у метки «${depotName}» нет сундука`);
    exit();
  }
  while (me.cargo.count(item) > 0) {
    try {
      put(chest, item);
    } catch (e) {
      if (!(e instanceof ActionError) || e.code !== "target-full") throw e;
      say("Сундук полон — жду", 10);
      wait(10);
    }
  }
}
