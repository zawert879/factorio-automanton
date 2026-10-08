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

import { attempt, buildingAt, refuelFrom } from "./lib/Помощники";

type Place = { marker?: string; zone?: string };
type Route = { item: Item; from: Place; to: Place; keep?: number; batch?: number };

const args = me.args<{ routes?: Route[]; coal?: string }>();
const routes = args.routes ?? [];
const coalDepot = args.coal ?? "уголь";
const BUILDING_TYPES = ["container", "logistic-container", "furnace", "assembling-machine", "lab", "boiler"];
me.label = "перевозчик";

if (routes.length === 0) {
  alert(`${me.name}: нет маршрутов — задайте параметр routes`);
  exit();
}

/** Здания места: сундук у метки или все подходящие здания в зоне. */
function buildingsOf(place: Place): Entity[] {
  if (place.marker !== undefined) {
    const building = buildingAt(place.marker, BUILDING_TYPES);
    return building === null ? [] : [building];
  }
  if (place.zone !== undefined) {
    const area = zone(place.zone);
    const all: Entity[] = [];
    for (const type of BUILDING_TYPES) for (const b of find({ type }, area)) all.push(b);
    return all;
  }
  return [];
}

function run(route: Route): void {
  const keep = route.keep ?? 20;
  const batch = route.batch ?? 50;
  // Зону назначения видно издалека: пустая — везти некуда.
  if (route.to.zone !== undefined && buildingsOf(route.to).length === 0) return;
  // Забрать.
  if (me.cargo.count(route.item) < batch) {
    for (const source of buildingsOf(route.from)) {
      move(source);
      attempt(() => take(source, route.item, batch - me.cargo.count(route.item)));
      if (me.cargo.count(route.item) >= batch) break;
    }
  }
  if (me.cargo.count(route.item) === 0) return;
  // Развезти: в каждое здание — до keep штук (в сундук — всё).
  for (const target of buildingsOf(route.to)) {
    if (me.cargo.count(route.item) === 0) break;
    move(target);
    // В сундук — всё, что везём, если у маршрута не задан keep (иначе и сундук — до keep штук).
    const isChest = target.type === "container" || target.type === "logistic-container";
    const need = isChest && route.keep === undefined ? me.cargo.count(route.item) : keep - target.count(route.item);
    if (need > 0) attempt(() => put(target, route.item, Math.min(need, me.cargo.count(route.item))));
  }
}

while (true) {
  for (const route of routes) {
    refuelFrom(coalDepot);
    run(route);
  }
  wait(1);
}
