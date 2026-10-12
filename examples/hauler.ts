// @program Перевозчик
// Возит предметы по маршрутам: из сундуков у метки или из зданий в зоне — в здания зоны или сундук
// у метки. Так собирается любая цепочка: руда в печи, плиты в сборщики, наука в лаборатории.
// Параметры — список маршрутов, например:
//   {"routes": [
//     {"item": "iron-ore", "from": {"marker": "железная руда"}, "to": {"zone": "печи"}, "keep": 20},
//     {"item": "iron-plate", "from": {"zone": "печи"}, "to": {"marker": "железо"}}
//   ]}
// keep — сколько держать в каждом здании назначения (по умолчанию 20; в сундук без keep — всё),
// batch — сколько брать за раз.
// Топливо машина берёт в сундуке у метки «уголь» (параметр "coal").

import { attempt, nearMarker, refuelFrom } from "./lib/Помощники";

type Place = { marker?: string; zone?: string };
type Route = { item: Item; from: Place; to: Place; keep?: number; batch?: number };

const args = me.args<{ routes?: Route[]; coal?: string }>();
const routes = args.routes ?? [];
const coalDepot = args.coal ?? "уголь";
/** Откуда брать (у этих зданий есть extract) и куда класть (insert). */
const SOURCES: BuildingKind<Chest | Furnace | Assembler | Lab>[] = [Chest, Furnace, Assembler, Lab];
const TARGETS: BuildingKind<Chest | Furnace | Assembler | Lab | Boiler>[] = [Chest, Furnace, Assembler, Lab, Boiler];
me.label = "перевозчик";

if (routes.length === 0) {
  alert(`${me.name}: нет маршрутов — задайте параметр routes`);
  exit();
}

/** Здания места этих классов: ближайшее к метке или все в зоне. */
function buildingsOf<T extends Building>(place: Place, kinds: BuildingKind<T>[]): T[] {
  if (place.marker !== undefined) {
    const at = marker(place.marker);
    me.move(at, { radius: 2 });
    let best: T | null = null;
    let bestDistance = Infinity;
    for (const kind of kinds) {
      const building = nearMarker(at, kind);
      if (building === null) continue;
      const d = (building.position.x - at.position.x) ** 2 + (building.position.y - at.position.y) ** 2;
      if (d < bestDistance) {
        best = building;
        bestDistance = d;
      }
    }
    return best === null ? [] : [best];
  }
  if (place.zone !== undefined) {
    const area = zone(place.zone);
    const all: T[] = [];
    for (const kind of kinds) for (const b of area.find(kind)) all.push(b);
    return all;
  }
  return [];
}

function run(route: Route): void {
  const keep = route.keep ?? 20;
  const batch = route.batch ?? 50;
  // Зону назначения видно издалека: пустая — везти некуда.
  if (route.to.zone !== undefined && buildingsOf(route.to, TARGETS).length === 0) return;
  // Забрать.
  if (me.cargo.count(route.item) < batch) {
    for (const source of buildingsOf(route.from, SOURCES)) {
      me.move(source);
      attempt(() => source.extract(route.item, batch - me.cargo.count(route.item)));
      if (me.cargo.count(route.item) >= batch) break;
    }
  }
  if (me.cargo.count(route.item) === 0) return;
  // Развезти: в каждое здание — до keep штук (в сундук — всё).
  for (const target of buildingsOf(route.to, TARGETS)) {
    if (me.cargo.count(route.item) === 0) break;
    me.move(target);
    // В сундук — всё, что везём, если у маршрута не задан keep (иначе и сундук — до keep штук).
    const need = target instanceof Chest && route.keep === undefined ? me.cargo.count(route.item) : keep - target.count(route.item);
    if (need > 0) attempt(() => target.insert(route.item, Math.min(need, me.cargo.count(route.item))));
  }
}

while (true) {
  for (const route of routes) {
    refuelFrom(coalDepot);
    run(route);
  }
  wait(1);
}
