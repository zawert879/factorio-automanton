// @program lib/Помощники
// Общие функции программ-примеров — пример своей библиотеки. Подключение из программы в корне:
//   import { chestAt, nearestField } from "./lib/Помощники";
// из программы в папке (например, «Добыча/Шахтёр») — "../lib/Помощники".
// Здесь только объявления (export function, export const) — это библиотека: на машине её не запустить,
// её импортируют другие программы. Измените её — программы, которые её импортируют, пересоберутся.

/** Типы сундуков. */
export const CHESTS = ["container", "logistic-container"];

/**
 * Здание у метки: ближайшее к самой метке (машина останавливается в паре клеток от неё — с любой стороны).
 * Ищется вокруг машины — вызывать, стоя у метки.
 */
export function nearMarker(at: Marker, types: string[] = CHESTS): Entity | null {
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

/** Доехать до метки и найти здание рядом с ней (по умолчанию — сундук); нет — null. */
export function buildingAt(name: string, types: string[] = CHESTS): Entity | null {
  const at = marker(name);
  move(at, { radius: 2 });
  return nearMarker(at, types);
}

/** Доехать до метки и найти сундук рядом с ней; нет — сообщить команде и остановить программу. */
export function chestAt(name: string): Entity {
  const chest = buildingAt(name);
  if (chest === null) {
    alert(`${me.name}: у метки «${name}» нет сундука`);
    exit();
  }
  return chest;
}

/** Ближайшая клетка месторождения (машина должна стоять рядом с ним); нет — сообщить и остановить программу. */
export function nearestField(ore: Item): Position {
  const patch = scan.resources().find((p) => p.item === ore);
  if (patch === undefined) {
    alert(`${me.name}: рядом нет месторождения ${ore} — поставьте машину ближе`);
    exit();
  }
  return patch.nearest;
}

/**
 * Действие, которое может не выйти — пусто, полно, — тогда 0, и работа идёт дальше
 * (с подписью what — причина в консоль машины). Остальные ошибки не глушатся.
 */
export function attempt(action: () => number, what?: string): number {
  try {
    return action();
  } catch (e) {
    if (e instanceof ActionError && (e.code === "not-enough-items" || e.code === "target-full" || e.code === "cargo-full")) {
      if (what !== undefined) print(`${what}: ${e.code}`);
      return 0;
    }
    throw e;
  }
}

/**
 * Заправиться, если топлива меньше min: углём из груза, а если его нет — со склада угля у метки depot.
 * refuel перекладывает в топливо весь уголь груза: если уголь нужен ещё для чего-то, заправляйтесь до того, как его брать.
 */
export function refuelFrom(depot: string, min = 0.3): void {
  if (me.fuel >= min) return;
  if (me.cargo.count("coal") === 0) {
    const chest = buildingAt(depot);
    if (chest !== null) attempt(() => take(chest, "coal", 10));
  }
  if (me.cargo.count("coal") > 0) refuel("coal");
}
