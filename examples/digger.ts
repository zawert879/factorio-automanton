// @program Добытчик
// Копает руду (или уголь) у месторождения и возит в сундук у метки. Топливо: уголь — свой,
// для остальной руды — из сундука у метки «уголь» (если такая есть).
// Параметры: {"ore": "iron-ore", "depot": "железная руда", "coal": "уголь"}.

const args = me.args<{ ore?: Item; depot?: string; coal?: string }>();
const ore: Item = args.ore ?? "iron-ore";
const depot = args.depot ?? "склад";
const coalDepot = args.coal ?? "уголь";
me.label = `копаю ${ore}`;

/** Ближайшая клетка месторождения. */
function field(): Position {
  const patch = scan.resources().find((p) => p.item === ore);
  if (patch === undefined) {
    alert(`${me.name}: рядом нет месторождения ${ore}`);
    exit();
  }
  return patch.nearest;
}

/** Здание у метки: ближайшее к самой метке (машина останавливается в паре клеток от неё — с любой стороны). */
function nearMarker(at: Marker, types: string[]): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Infinity;
  for (const e of scan.entities({ type: types, radius: 6 })) {
    const d = (e.position.x - at.position.x) ** 2 + (e.position.y - at.position.y) ** 2;
    if (d < bestDistance) {
      best = e;
      bestDistance = d;
    }
  }
  return best;
}

/** Сундук у метки (ищется, стоя у метки). */
function chestAt(name: string): Entity | null {
  const at = marker(name);
  move(at, { radius: 2 });
  return nearMarker(at, ["container", "logistic-container"]);
}

/** Заправиться: своим углём или со склада угля. */
function refill(): void {
  if (me.fuel >= 0.3) return;
  if (me.cargo.count("coal") === 0 && ore !== "coal") {
    const chest = chestAt(coalDepot);
    if (chest !== null && chest.count("coal") > 0) take(chest, "coal", 10);
  }
  if (me.cargo.count("coal") > 0) refuel("coal");
}

const home = field();
while (true) {
  refill();
  move(home);
  try {
    mine(ore, 40);
  } catch (e) {
    if (!(e instanceof ActionError) || (e.code !== "no-resource" && e.code !== "cargo-full")) throw e;
  }
  refill();
  const chest = chestAt(depot);
  if (chest === null) {
    alert(`${me.name}: у метки «${depot}» нет сундука`);
    exit();
  }
  try {
    put(chest, ore);
  } catch (e) {
    if (!(e instanceof ActionError) || e.code !== "target-full") throw e;
    say("Сундук полон — жду", 10);
    wait(10);
  }
}
