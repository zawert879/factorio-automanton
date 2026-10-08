// @program Водовоз
// Возит воду от берега к котлам: набирает полный бак и заливает в резервуар или котлы у метки.
// Как запустить:
//   1. Исследуйте «Жидкости для автоматонов» (открывается, когда скрафтите котёл).
//   2. У котлов поставьте метку «котельная». Лучше — резервуар рядом, соединённый с котлами трубами:
//      в котёл влезает всего 200 воды, в резервуар — 25 000.
//   3. Поставьте машину у воды и запустите «Водовоз». Параметры (необязательно): {"target": "котельная"}.
// Уголь на топливо машина берёт из сундука у той же метки, если он там есть.
// Один водовоз при 30 клетках пути кормит примерно один котёл (60 воды в секунду).

const { target } = me.args<{ target?: string }>();
const targetName = target ?? "котельная";
me.label = "вода";

// Где набирать воду: сухая точка у берега — там, где машина стоит при запуске (в саму воду не проехать).
let shore = me.position;
if (scan.water(me.mineReach) === null) {
  const water = scan.water();
  if (water === null) {
    alert(`${me.name}: рядом нет воды — поставьте машину у берега`);
    exit();
  }
  move(water, { radius: 2 });
  shore = me.position;
}

/** Залить бак в резервуары и котлы у метки; true — что-то залилось. */
function unload(): boolean {
  let poured = 0;
  for (const building of scan.entities({ type: ["storage-tank", "boiler"], radius: 8 })) {
    if (me.tank!.amount <= 0) break;
    try {
      poured += fill(building);
    } catch (e) {
      if (!(e instanceof ActionError) || e.code !== "target-full") throw e;
    }
  }
  return poured > 0;
}

/** Топливо — из сундука у метки. */
function refill(): void {
  if (me.fuel >= 0.3) return;
  const chest = scan.entities({ type: ["container", "logistic-container"], radius: 8 })[0];
  if (chest === undefined || chest.count("coal") === 0) {
    say("Мало топлива: положите уголь в сундук у метки", 10);
    return;
  }
  take(chest, "coal", 10);
  refuel("coal");
}

while (true) {
  move(shore, { radius: 2 });
  pump("water");
  move(marker(targetName), { radius: 2 });
  refill();
  if (scan.entities({ type: ["storage-tank", "boiler"], radius: 8 }).length === 0) {
    alert(`${me.name}: у метки «${targetName}» нет ни резервуара, ни котла`);
    exit();
  }
  // Всё полно — ждём у котельной, пока вода не уйдёт.
  while (!unload() && me.tank!.amount > 0) wait(5);
}
