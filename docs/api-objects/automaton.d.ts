// ЧЕРНОВИК API объектами (этап 19) — для обсуждения, в игре пока прежний API.
// Решения: 1B (действие — метод цели), 2C (me.energy / me.tank / me.weapon, null без бака и оружия),
// 3A (классы и instanceof), 4C (класс на каждый вид зданий), 5A (связь — radio), 6C (старые имена не работают).
// Рядом — примеры на этом API (Рабочий, Печник, Оркестратор, lib/Помощники); проверка: npx tsc -p docs/api-objects.
// После согласования объявления переедут в docs/API.md (с английскими описаниями), папка будет удалена.

type Item = string;      // "iron-ore", "iron-plate", ...
type Fluid = string;     // "water", "crude-oil", ...
type Position = { x: number; y: number };
type Area = { from: Position; to: Position };
type Direction = "north" | "east" | "south" | "west";
/** Куда ехать, до чего мерить расстояние. */
type Target = Position | Building | Machine | Marker | Zone;

/** Что можно передать сообщением, положить на доску или в память. */
type Value =
  | null | boolean | number | string
  | Building | Machine | Position
  | Value[]
  | { [key: string]: Value };

interface ItemStack { name: Item; count: number }

// ═══════════════════════ Глобальные функции (11) ═══════════════════════

/** Строка в консоль машины (окно машины, последние 100 строк); значения — как console.log в Node. */
declare function print(...values: unknown[]): void;
declare const console: { log(...values: unknown[]): void };   // то же, что print

/** Сообщение в чат команды. Не чаще раза в 5 секунд с одной машины. */
declare function chat(text: string): void;

/** Оповещение игрокам команды: значок у миникарты, клик ведёт к машине. */
declare function alert(text: string): void;

declare function wait(seconds: number): void;

/** Ждать, пока cond не вернёт true (проверка раз в `every` секунд). По таймауту — false. */
declare function waitUntil(cond: () => boolean, opts?: { every?: number; timeout?: number }): boolean;

/** Завершить программу (машина встаёт в idle) / начать заново. */
declare function exit(): never;
declare function restart(): never;

/** Метка по имени. ActionError("invalid-target"), если метки нет. */
declare function marker(name: string): Marker;
/** Зона по имени (выделена «Программатором»). */
declare function zone(name: string): Zone;
/** Машина команды по id или имени; нет такой — null. */
declare function robot(idOrName: number | string): Robot | null;
/** Табло по имени. */
declare function display(name: string): Display;

// ═══════════════════════ Машины ═══════════════════════

type Model =
  | "worker-mk1" | "worker-mk2" | "worker-mk3"
  | "combat-mk1" | "combat-mk2"
  | "flyer-mk1" | "flyer-mk2";

type RobotState =
  | "idle" | "moving" | "mining" | "transferring" | "pumping" | "building" | "fighting"
  | "waiting" | "thinking" | "no-fuel" | "stuck" | "error";

/** Общее у машин: своей (me) и другой (Robot). */
declare abstract class Machine {
  protected constructor();
  // Всегда:
  readonly id: number;
  readonly name: string;
  readonly model: Model;
  readonly valid: boolean;             // false, если машину уничтожили или подобрали
  /** Видна ли сейчас. Поля ниже — только если видна, иначе ActionError("out-of-sight"). */
  readonly inSight: boolean;
  // Только в поле зрения:
  readonly position: Position;
  readonly state: RobotState;
  readonly program: string | null;     // имя программы из библиотеки
  readonly health: number;             // 0..1
  readonly energy: { readonly level: number };   // 0..1 — топливо или заряд
  distance(to: Target): number;
}

/** Другая машина своей команды: robot(), scan.robots(), msg.from. */
declare class Robot extends Machine {
  private constructor();
  /** Переложить предметы из своего груза в её груз — «из рук в руки» (в радиусе me.reach). Было give. */
  insert(item: Item, count?: number): number;
  /** Mk1: заправить её топливом из своего груза; без item — лучшим, что есть. Было refuel(item, to). */
  refuel(item?: Item): void;
  /** Починить ремкомплектами из своего груза. Было repair(robot). */
  repair(): void;
}

declare const me: Me;

/** Эта машина. */
interface Me extends Machine {
  name: string;                        // можно переименовать себя из программы
  label: string;                       // постоянная подпись над машиной (в отличие от say)
  readonly cargo: Inventory;
  readonly energy: Energy;
  readonly tank: Tank | null;          // бак — только у рабочих моделей
  readonly weapon: Weapon | null;      // оружие — только у боевых моделей
  readonly reach: number;              // досягаемость до зданий, клеток (как у персонажа)
  readonly mineReach: number;          // досягаемость до месторождения, клеток
  readonly vision: number;             // радиус зрения, клеток
  readonly home: Position | null;      // «дом», задаётся в окне машины
  /** Параметры программы, заданные в окне машины. Одна программа — разные настройки у разных машин. */
  args<T>(): T;
  /** Память, которая переживает перезапуск программы и подбор машины. */
  readonly memory: {
    get<T extends Value>(key: string): T | null;
    set(key: string, value: Value): void;
    delete(key: string): void;
  };

  /**
   * Доехать до цели. К машине — только если она в поле зрения (иначе спроси у неё позицию сообщением).
   * ActionError("no-path"), если пути нет.
   */
  move(to: Target, opts?: { radius?: number; timeout?: number }): void;
  /** Есть ли путь до цели (спрашивает поиск пути, занимает несколько тиков). */
  canReach(to: Target): boolean;
  /** Ехать следом за целью, пока `until` не вернёт true. false — цель потеряна из виду. */
  follow(target: Robot | Building, until: () => boolean): boolean;
  /** Вернуться в me.home. */
  goHome(): void;

  /** Добыть ресурс, стоя у месторождения. Без count — пока не заполнится груз. Возвращает, сколько добыто. */
  mine(item: Item, count?: number): number;
  /** Подобрать предметы с земли вплотную. Без item — всё подряд. */
  pickup(item?: Item, count?: number): number;
  /** Выбросить предметы на землю. */
  drop(item: Item, count?: number): number;
  /** [Строительство] Поставить здание из груза. */
  build(item: Item, at: Position, direction?: Direction): Building;

  /** Облачко с текстом над машиной на `seconds` секунд (по умолчанию 3). Видят все игроки. Было say. */
  say(text: string, seconds?: number): void;
}

/** Энергия машины. */
interface Energy {
  readonly level: number;              // 0..1 — топливо или заряд. Было me.fuel
  /** Mk1: переложить топливо из груза в топливный слот. Без item — лучшее, что есть. Было refuel. */
  refuel(item?: Item): void;
  /** Mk2+: доехать до станции (по умолчанию — ближайшей видимой) и зарядиться полностью. Было charge. */
  charge(station?: ChargingStation): void;
}

/** [Жидкости] Бак рабочей машины. */
interface Tank {
  readonly fluid: Fluid | null;        // null — бак пуст
  readonly amount: number;
  readonly capacity: number;           // Mk1 — 1000
  /**
   * Набрать в бак: воду — у берега (клетка воды в me.mineReach), нефть — стоя у месторождения.
   * Без amount — до полного бака. Возвращает, сколько набрано. Было pump.
   */
  pump(fluid: Fluid, amount?: number): number;
}

/** Оружие боевой машины. */
interface Weapon {
  readonly type: "gun" | "shotgun" | "rocket" | "flamethrower";
  readonly ammo: ItemStack | null;       // заряжено
  readonly range: number;                // дальность, клеток
  /** Зарядить патронами из груза. Без ammo — лучшими, что есть. Было reload. */
  reload(ammo?: Item): void;
  /**
   * Подъехать на дальность выстрела и атаковать, пока цель не уничтожена, не пропала из виду
   * или не кончились патроны. true — цель уничтожена. Было attack.
   */
  attack(target: Enemy | Building): boolean;
  /** Стоять у точки и отбиваться от всех врагов в радиусе, пока until() не вернёт true. Было guard. */
  guard(at: Target, opts?: { radius?: number; until?: () => boolean }): void;
  /** Объезжать точки по кругу, атакуя встреченных врагов, пока until() не вернёт true. Было patrol. */
  patrol(points: Target[], until?: () => boolean): void;
}

interface Inventory {
  count(item?: Item): number;          // без аргумента — всего предметов
  items(): ItemStack[];
  free(item?: Item): number;           // сколько ещё влезет (этого предмета)
  isEmpty(): boolean;
  isFull(): boolean;
}

// ═══════════════════════ Здания ═══════════════════════
// Все действия со зданием делает эта машина: нужна досягаемость me.reach, тратятся её энергия и время.
// Жидкость для fill / drain — из бака машины и в него (me.tank; нет бака — ActionError("no-tank")).

type BuildingStatus =
  | "working" | "no-input" | "output-full" | "no-fuel" | "no-power"
  | "no-recipe" | "disabled" | "idle";

/** Класс зданий для поиска: Furnace, Chest, … (zone.find(Furnace), scan.buildings({ kind: Chest })). */
type BuildingKind<T extends Building> = { prototype: T };

/** Любое здание. Здания без своих методов (столбы, стены, лампы, комбинаторы, рельсы…) — просто Building. */
declare class Building {
  protected constructor();
  // Всегда:
  readonly id: number;
  readonly valid: boolean;
  readonly name: string;               // "stone-furnace"
  readonly type: string;               // "furnace" — тип прототипа Factorio
  readonly position: Position;
  /** Видно ли сейчас. Поля и методы ниже — только если видно, иначе ActionError("out-of-sight"). */
  readonly inSight: boolean;
  // Только в поле зрения:
  readonly status: BuildingStatus;
  readonly health: number;             // 0..1
  /** Починить ремкомплектами из груза. */
  repair(): void;
  /** [Строительство] Повернуть. */
  rotate(reverse?: boolean): void;
  /** [Строительство] Разобрать в груз. */
  deconstruct(): void;
}

/** Сундук: деревянный, железный, стальной, сундук хранения. */
declare class Chest extends Building {
  private constructor();
  inventory(): Inventory;
  count(item?: Item): number;
  /** Положить из груза. Возвращает, сколько положено. Было put. */
  insert(item: Item, count?: number): number;
  /** Взять в груз. Возвращает, сколько взято. Было take. */
  extract(item: Item, count?: number): number;
}

/** Печь: каменная, стальная, электрическая. Рецепт печь выбирает сама — по руде. */
declare class Furnace extends Building {
  private constructor();
  readonly recipe: string | null;
  readonly progress: number;           // прогресс текущей плавки, 0..1
  input(): Inventory;
  output(): Inventory;
  fuel(): Inventory | null;            // у электрической — null
  count(item?: Item): number;          // во всех слотах
  /** Положить: руду — во вход, топливо — в топливо. */
  insert(item: Item, count?: number): number;
  /** Взять из выхода (или из входа, если там этот предмет). */
  extract(item: Item, count?: number): number;
}

/** Сборщик: сборочные автоматы, химзавод, нефтезавод, центрифуга. */
declare class Assembler extends Building {
  private constructor();
  readonly recipe: string | null;
  readonly progress: number;           // 0..1
  input(): Inventory;
  output(): Inventory;
  count(item?: Item): number;
  insert(item: Item, count?: number): number;
  extract(item: Item, count?: number): number;
  /** [Наладка] Сменить рецепт; содержимое возвращается в груз машины. */
  setRecipe(recipe: string): void;
  /** Жидкость в здании (без name — всего). */
  fluid(name?: Fluid): number;
  /** [Жидкости] Залить из бака машины. Без amount — всё, что влезет. Нет входа для жидкости — ActionError. */
  fill(amount?: number): number;
  /** [Жидкости] Слить в бак машины (продукты химзавода и нефтезавода). */
  drain(fluid: Fluid, amount?: number): number;
}

/** Ракетная шахта. */
declare class RocketSilo extends Building {
  private constructor();
  readonly recipe: string | null;
  readonly progress: number;           // 0..1 — постройка ракеты
  input(): Inventory;
  output(): Inventory;
  count(item?: Item): number;
  insert(item: Item, count?: number): number;
  extract(item: Item, count?: number): number;
}

/** Лаборатория. */
declare class Lab extends Building {
  private constructor();
  input(): Inventory;
  count(item?: Item): number;
  /** Положить колбы. */
  insert(item: Item, count?: number): number;
  extract(item: Item, count?: number): number;
}

/** Котёл и теплообменник. */
declare class Boiler extends Building {
  private constructor();
  fuel(): Inventory | null;            // у теплообменника — null
  count(item?: Item): number;
  /** Положить топливо. */
  insert(item: Item, count?: number): number;
  fluid(name?: Fluid): number;
  /** [Жидкости] Залить воду из бака. */
  fill(amount?: number): number;
  /** [Жидкости] Слить пар в бак. */
  drain(fluid: Fluid, amount?: number): number;
}

/** Паровой двигатель и паровая турбина. */
declare class Generator extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  /** [Жидкости] Залить пар из бака. */
  fill(amount?: number): number;
  drain(fluid: Fluid, amount?: number): number;
}

/** Ядерный реактор. */
declare class Reactor extends Building {
  private constructor();
  fuel(): Inventory;
  count(item?: Item): number;
  /** Положить топливные стержни. */
  insert(item: Item, count?: number): number;
  /** Взять отработанные стержни. */
  extract(item: Item, count?: number): number;
}

/** Резервуар. */
declare class StorageTank extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  fill(amount?: number): number;
  drain(fluid: Fluid, amount?: number): number;
}

/** Труба, подземная труба, помпа. */
declare class Pipe extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  fill(amount?: number): number;
  drain(fluid: Fluid, amount?: number): number;
}

/** Турель с патронами: пулемётная, артиллерийская. */
declare class Turret extends Building {
  private constructor();
  ammo(): Inventory;
  count(item?: Item): number;
  /** Зарядить патронами или снарядами из груза. */
  insert(item: Item, count?: number): number;
  extract(item: Item, count?: number): number;
}

/** Огнемётная турель. */
declare class FlameTurret extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  /** [Жидкости] Залить нефть или топливо из бака. */
  fill(amount?: number): number;
}

/** Грузовой вагон. */
declare class CargoWagon extends Building {
  private constructor();
  inventory(): Inventory;
  count(item?: Item): number;
  insert(item: Item, count?: number): number;
  extract(item: Item, count?: number): number;
}

/** Вагон-цистерна. */
declare class FluidWagon extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  fill(amount?: number): number;
  drain(fluid: Fluid, amount?: number): number;
}

/** Локомотив. */
declare class Locomotive extends Building {
  private constructor();
  fuel(): Inventory;
  count(item?: Item): number;
  /** Положить топливо. */
  insert(item: Item, count?: number): number;
}

/** Машина игрока: автомобиль, танк, паук. */
declare class Vehicle extends Building {
  private constructor();
  inventory(): Inventory;              // багажник
  fuel(): Inventory | null;            // у паука — null
  count(item?: Item): number;
  insert(item: Item, count?: number): number;
  extract(item: Item, count?: number): number;
}

/** Станция зарядки машин Mk2+ (me.energy.charge). */
declare class ChargingStation extends Building {
  private constructor();
}

// ═══════════════════════ Зрение, метки, зоны ═══════════════════════

declare const scan: {
  /** Машины своей команды рядом. */
  robots(radius?: number): Robot[];
  /**
   * Здания рядом. С kind — только этого класса и сразу с его методами: scan.buildings({ kind: Furnace }) → Furnace[].
   * Было scan.entities({ type: "furnace" }).
   */
  buildings<T extends Building = Building>(filter?: { kind?: BuildingKind<T>; name?: string | string[]; radius?: number }): T[];
  /** Предметы, лежащие на земле. */
  items(radius?: number): GroundItem[];
  /** Месторождения рядом, сгруппированные по ресурсу. */
  resources(radius?: number): ResourcePatch[];
  /** [Сенсоры] Враги: кусаки, плеваки, гнёзда, черви. */
  enemies(radius?: number): Enemy[];
  /** Ближайшая вода. */
  water(radius?: number): Position | null;
};

interface GroundItem { item: Item; count: number; position: Position }
interface ResourcePatch { item: Item; amount: number; tiles: number; center: Position; nearest: Position }

/** Враг: кусака, плевака, гнездо, червь. */
declare class Enemy {
  private constructor();
  readonly id: number;
  readonly valid: boolean;
  readonly inSight: boolean;
  readonly name: string;
  readonly position: Position;
  readonly health: number;             // 0..1
}

/** Метка на карте (ставится игроком). */
declare class Marker {
  private constructor();
  readonly name: string;
  readonly position: Position;
}

/** Зона — прямоугольник, выделенный «Программатором». */
declare class Zone {
  private constructor();
  readonly name: string;
  readonly area: Area;
  readonly center: Position;
  contains(p: Position): boolean;
  /** Здания класса в зоне (и, если задано, с этим именем): zone("плавильня").find(Furnace) → Furnace[]. Было find. */
  find<T extends Building>(kind: BuildingKind<T>, name?: string | string[]): T[];
  /** Здания в зоне с этим именем ("stone-furnace") или все. */
  find(name?: string | string[]): Building[];
}

declare const map: {
  /** Метка на карте для игроков (например, найденное месторождение). */
  tag(at: Position, text: string, icon?: Item): void;
  untag(at: Position): void;
};

// ═══════════════════════ Связь ═══════════════════════

interface Message<T extends Value = Value> {
  readonly from: Robot;                // ссылка на отправителя; его позиция — только в поле зрения
  readonly topic: string;
  readonly data: T;
  readonly sentAt: number;             // тик отправки
  /** Ответить отправителю (для request). */
  reply(data: Value): void;
}

/** [Радиосвязь] Сообщения между машинами — на любом расстоянии. Было send, receive, … и inbox. */
declare const radio: {
  /** Сообщение конкретной машине: по ссылке, id или имени. */
  send(to: Robot | number | string, topic: string, data?: Value): void;
  /** Отправить и дождаться ответа. По таймауту — ActionError("timeout"). */
  request<T extends Value = Value>(to: Robot | number | string, topic: string, data?: Value, timeout?: number): T;
  /** Ждать сообщение (необязательно — только по теме). По таймауту (секунды) — null. */
  receive<T extends Value = Value>(topic?: string, timeout?: number): Message<T> | null;
  /** Взять сообщение, если оно уже есть, не ожидая. */
  tryReceive<T extends Value = Value>(topic?: string): Message<T> | null;
  /** Опубликовать обновление: получат машины, подписанные на эту (на все её темы или на эту тему). */
  publish(topic: string, data?: Value): void;
  /** Подписаться на публикации машины (по ссылке, id или имени): на все её темы или на одну. */
  subscribe(robot: Robot | number | string, topic?: string): void;
  /** Отписаться от машины: от темы или (без темы) совсем. */
  unsubscribe(robot: Robot | number | string, topic?: string): void;
  readonly inbox: { readonly count: number; readonly dropped: number };
};

declare const board: {
  get<T extends Value>(key: string): T | null;
  set(key: string, value: Value): void;
  delete(key: string): void;
  keys(prefix?: string): string[];
  /** Атомарно прибавить, вернуть новое значение. */
  increment(key: string, by?: number): number;
  /** Атомарно заменить, только если сейчас там expected. */
  compareAndSet(key: string, expected: Value, value: Value): boolean;
  /** Захватить ключ на ttl секунд. true — захватила эта машина. */
  claim(key: string, ttl?: number): boolean;
  release(key: string): void;
};

declare const tasks: {
  push(queue: string, data: Value, opts?: { priority?: number }): void;
  /** Ждать задачу (блокирует). По таймауту — null. */
  next<T extends Value>(queue: string, opts?: { timeout?: number; lease?: number }): Task<T> | null;
  size(queue: string): number;
};

interface Task<T extends Value> {
  readonly data: T;
  done(): void;
  fail(reason?: string): void;           // вернуть в очередь
}

// ═══════════════════════ Табло, сигналы, время, мир (без изменений) ═══════════════════════

interface Display {
  readonly width: number;
  readonly height: number;
  clear(color?: Color): void;
  pixel(x: number, y: number, color: Color): void;
  rect(x: number, y: number, width: number, height: number, style?: ShapeStyle): void;
  line(x1: number, y1: number, x2: number, y2: number, style?: ShapeStyle): void;
  circle(x: number, y: number, radius: number, style?: ShapeStyle): void;
  /** size — высота строки в пикселях (по умолчанию 8). */
  text(x: number, y: number, text: string, style?: { color?: Color; size?: number; align?: "left" | "center" | "right" }): void;
  measureText(text: string, size?: number): number;
  icon(x: number, y: number, item: Item, size?: number): void;
  /** Полоска заполнения, value — 0..1. */
  bar(x: number, y: number, width: number, height: number, value: number, color?: Color): void;
  /** Таблица из строк ячеек; с header первая строка выделяется. Возвращает занятый размер. */
  table(x: number, y: number, rows: Cell[][], opts?: { header?: boolean; size?: number; columnWidths?: number[] }): { width: number; height: number };
  /** Всё нарисованное внутри frame появляется разом, без мерцания. */
  frame(draw: () => void): void;
}

type ShapeStyle = { color?: Color; fill?: boolean; width?: number };

type Color =
  | "black" | "white" | "gray" | "red" | "orange" | "yellow" | "green" | "blue" | "purple"
  | { r: number; g: number; b: number };

type Cell = string | number | { text: string; color?: Color; icon?: Item };

declare const signals: {
  read(at: Marker, signal: string): number;
  readAll(at: Marker): Record<string, number>;
  /** Метка выдаёт эти сигналы в сеть, пока их не перезапишут. */
  write(at: Marker, values: Record<string, number>): void;
};

declare const time: {
  readonly tick: number;
  readonly seconds: number;            // с начала игры
  readonly daytime: number;            // 0..1
  isNight(): boolean;
};

declare const world: {
  recipe(name: string): { ingredients: ItemStack[]; products: ItemStack[]; seconds: number } | null;
  item(name: Item): { stackSize: number; fuelValue: number } | null;
  research: {
    readonly current: string | null;
    readonly progress: number;         // 0..1
    isDone(tech: string): boolean;
  };
  stats: {
    /** Сколько предмета команда произвела / потратила за период. */
    produced(item: Item, period?: "1m" | "10m" | "1h"): number;
    consumed(item: Item, period?: "1m" | "10m" | "1h"): number;
  };
};

declare class ActionError extends Error {
  readonly code: ErrorCode;
}

type ErrorCode =
  | "no-path"            // пути нет
  | "stuck"              // путь есть, но проехать не дают (застряла)
  | "out-of-reach"       // цель дальше досягаемости — сначала me.move
  | "out-of-sight"       // состояние цели не видно — подъехать или спросить того, кто видит
  | "invalid-target"     // цель уничтожена, не существует или не умеет этого
  | "no-fuel"            // кончилась энергия
  | "no-ammo"            // кончились патроны
  | "no-tank"            // fill / drain у машины без бака
  | "cargo-full"         // груз полон
  | "not-enough-items"   // в грузе нет столько предметов
  | "target-full"        // в здание больше не влезает
  | "no-resource"        // рядом нет такого месторождения
  | "cancelled"          // действие прервали (новый приказ, остановка программы)
  | "not-researched"     // функция ещё не открыта
  | "timeout"            // истёк таймаут
  | "not-serializable"   // попытка передать функцию или экземпляр класса
  | "limit-exceeded";    // превышен лимит (стек, память, размер сообщения, примитивы табло)
