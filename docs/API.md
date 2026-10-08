# Встроенная библиотека автоматонов

Черновик для обсуждения. Сигнатуры записаны как объявления TypeScript — из них потом получится
`automaton.d.ts` для VS Code. В квадратных скобках — исследование, которое открывает возможность;
без пометки — доступно с самого начала. Все примеры проходят `tsc --strict`.

## Общие правила

- **Мгновенные функции и действия.** Чтение состояния, зрение, сообщения, рисование выполняются сразу.
  Действия (`move`, `mine`, `take`, `put`, `attack`, …) занимают игровое время: программа ждёт,
  пока действие закончится. Одновременно у машины идёт одно действие.
- **Бесконечные циклы — норма.** `while (true)` — обычный главный цикл программы. У машины есть квант
  инструкций на тик (зависит от модели); исчерпала — программа ставится на паузу и со следующего тика
  продолжается с того же места. Это не ошибка и никого не блокирует. `wait`, `receive` и действия
  квант не тратят, поэтому ждать через них выгоднее, чем крутиться вхолостую.
- **Руки — как у персонажа.** Брать, класть, чинить, строить можно только в радиусе досягаемости
  `me.reach` (как у персонажа — 10 клеток); добывать — стоя у месторождения (`me.mineReach`, 2.7 клетки);
  подбирать с земли — вплотную. Дальше — `ActionError("out-of-reach")`: подъехать нужно самому через `move`.
- **Глаза — только рядом.** Машина видит в радиусе зрения `me.vision`. Неизменное — id, имя, тип,
  позиция здания — читается всегда. Текущее состояние зданий (содержимое, статус, рецепт) и других
  машин (позиция, состояние, здоровье) — только в поле зрения, иначе `ActionError("out-of-sight")`.
  Проверить заранее — `inSight`. О дальнем узнают из сообщений тех, кто видит (например, оркестратора).
- **Связь — без ограничения дальности.** Сообщения, общая доска, очереди задач и табло работают
  на любом расстоянии.
- **Частичный результат — не ошибка.** `take`, `put`, `mine` возвращают, сколько реально перенесено.
  Исключение бросается, только если действие невозможно.
- **Энергия.** Тратится на путь, действия, бой, зрение (зависит от радиуса), немного — на сообщения
  и рисование. Чтение своего состояния бесплатно.
- **Идентификация.** У каждой машины есть `id` — число, уникальное на карте, — и имя. Оба видны над
  машиной и не теряются, если машину подобрать и поставить снова (хранятся в предмете).
- **Данные между машинами копируются.** Сообщения, доска и задачи принимают только `Value`: числа,
  строки, логические значения, `null`, массивы, простые объекты, ссылки на здания и машины.
  Функции и экземпляры классов передать нельзя (`not-serializable`). Форму таких данных описывают
  через `type`, а не `interface`: так требует TypeScript, иначе тип не считается «простыми данными».
- **Детерминизм.** `Math.random()` у всех игроков выдаёт одно и то же (генератор с сидом от `id` машины).

## Обзор

| Раздел | Что внутри | Доступ |
|---|---|---|
| [Вывод](#вывод) | `print`, `console.log`, `say`, `chat`, `alert` | сразу |
| [Своя машина](#своя-машина-me) | `me`: груз, топливо, здоровье, параметры программы, память, подпись | сразу |
| [Движение](#движение) | `move`, `canReach`, `follow`, `goHome` | сразу |
| [Предметы](#предметы) | `mine`, `take`, `put`, `pickup`, `drop`, `give` | сразу |
| [Здания](#здания) | состояние (в поле зрения), `repair` / `setRecipe` / `build`, `deconstruct`, `rotate` | сразу / [Наладка] / [Строительство] |
| [Жидкости](#жидкости) | `pump`, `fill`, `drain` | [Жидкости] |
| [Энергия](#энергия) | `refuel`, `charge` | сразу / Mk2 |
| [Зрение](#зрение) | `scan.robots`, `scan.entities`, `scan.items`, `scan.resources`, `scan.enemies`, `scan.water` | сразу, радиус растёт исследованиями |
| [Карта](#карта) | метки, зоны, `find`, `map.tag` | сразу |
| [Связь](#связь) | `send`, `broadcast`, `receive`, `request`, `robot` | [Радиосвязь] |
| [Доска и задачи](#доска-и-задачи) | `board` (общая память), `tasks` (очереди заданий) | [Радиосвязь] |
| [Табло](#табло) | `display`: пиксельный холст — линии, фигуры, текст, иконки, таблицы | [Табло] |
| [Бой](#бой) | `attack`, `guard`, `patrol`, `reload`, `me.weapon` | [Боевые автоматоны] |
| [Сигналы](#сигналы) | чтение и запись сигналов цепей | [Цепи] |
| [Время и мир](#время-и-мир) | `wait`, `waitUntil`, `time`, `world` (рецепты, исследования, статистика) | сразу |
| [Ошибки](#ошибки) | `ActionError`, коды | сразу |

## Базовые типы

```ts
type Item = string;      // "iron-ore", "iron-plate", ...
type Fluid = string;     // "water", "crude-oil", ...
type Position = { x: number; y: number };
type Area = { from: Position; to: Position };
type Direction = "north" | "east" | "south" | "west";
type Target = Position | Entity | Robot | Marker | Zone;

type Value =
  | null | boolean | number | string
  | Entity | Robot | Position
  | Value[]
  | { [key: string]: Value };

interface ItemStack { name: Item; count: number }
```

## Вывод

```ts
/** Строка в консоль машины (окно машины, последние 100 строк). Объекты печатаются как JSON. */
declare function print(...values: unknown[]): void;
declare const console: { log(...values: unknown[]): void };   // то же, что print

/** Облачко с текстом над машиной на `seconds` секунд (по умолчанию 3). Видят все игроки. */
declare function say(text: string, seconds?: number): void;

/** Сообщение в чат команды. Не чаще раза в 5 секунд с одной машины. */
declare function chat(text: string): void;

/** Оповещение игрокам команды: значок у миникарты, клик ведёт к машине. */
declare function alert(text: string): void;
```

## Своя машина (`me`)

```ts
declare const me: Me;

type Model =
  | "worker-mk1" | "worker-mk2" | "worker-mk3"
  | "combat-mk1" | "combat-mk2"
  | "flyer-mk1" | "flyer-mk2";

interface Robot {
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
  distance(to: Target): number;
}

type RobotState =
  | "idle" | "moving" | "mining" | "transferring" | "pumping" | "building" | "fighting"
  | "waiting" | "thinking" | "no-fuel" | "stuck" | "error";

interface Me extends Robot {
  name: string;                        // можно переименовать себя из программы
  label: string;                       // постоянная подпись над машиной (в отличие от say)
  readonly cargo: Inventory;
  readonly fuel: number;               // 0..1 — топливо или заряд
  readonly tank: FluidTank | null;     // бак, если есть у модели
  readonly weapon: Weapon | null;      // оружие, если модель боевая
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
}

interface Inventory {
  count(item?: Item): number;          // без аргумента — всего предметов
  items(): ItemStack[];
  free(item?: Item): number;           // сколько ещё влезет (этого предмета)
  isEmpty(): boolean;
  isFull(): boolean;
}
```

```ts
// Одна программа «Шахтёр» на всех машинах, у каждой свои параметры в окне машины
const { ore, field } = me.args<{ ore: Item; field: string }>();
me.label = `⛏ ${ore}`;
```

## Движение

```ts
/**
 * Доехать до цели. К машине — только если она в поле зрения (иначе спроси у неё позицию сообщением).
 * ActionError("no-path"), если пути нет.
 */
declare function move(to: Target, opts?: { radius?: number; timeout?: number }): void;

/** Есть ли путь до цели (спрашивает поиск пути, занимает несколько тиков). */
declare function canReach(to: Target): boolean;

/** Ехать следом за целью, пока `until` не вернёт true. false — цель потеряна из виду. */
declare function follow(target: Robot | Entity, until: () => boolean): boolean;

/** Вернуться в me.home. */
declare function goHome(): void;
```

## Предметы

```ts
/** Добыть ресурс, стоя у месторождения. Без count — пока не заполнится груз. Возвращает, сколько добыто. */
declare function mine(item: Item, count?: number): number;

/** Взять из здания в радиусе me.reach: выход печи и сборщика, сундук, вагон. */
declare function take(from: Entity, item: Item, count?: number): number;

/** Положить в здание в радиусе me.reach — в нужный слот: вход печи и сборщика, топливо котла, патроны турели, наука лаборатории. */
declare function put(into: Entity, item: Item, count?: number): number;

/** Подобрать предметы с земли вплотную. Без item — всё подряд. */
declare function pickup(item?: Item, count?: number): number;

/** Выбросить предметы на землю. */
declare function drop(item: Item, count?: number): number;

/** Передать предметы другой машине в радиусе me.reach — «из рук в руки», без сундука. */
declare function give(to: Robot, item: Item, count?: number): number;
```

## Здания

```ts
interface Entity {
  // Всегда:
  readonly id: number;
  readonly valid: boolean;
  readonly name: string;               // "stone-furnace"
  readonly type: string;               // "furnace"
  readonly position: Position;
  /** Видно ли сейчас. Поля и методы ниже — только если видно, иначе ActionError("out-of-sight"). */
  readonly inSight: boolean;
  // Только в поле зрения:
  readonly status: EntityStatus;
  readonly health: number;             // 0..1
  readonly recipe: string | null;      // у сборщиков и печей
  readonly progress: number;           // прогресс текущего крафта, 0..1
  count(item: Item): number;           // во всех инвентарях здания
  input(): Inventory | null;
  output(): Inventory | null;
  fuel(): Inventory | null;
  fluid(name?: Fluid): number;
}

type EntityStatus =
  | "working" | "no-input" | "output-full" | "no-fuel" | "no-power"
  | "no-recipe" | "disabled" | "idle";

/** Починить здание или машину ремкомплектами из груза (в радиусе me.reach). */
declare function repair(target: Entity | Robot): void;

/** [Наладка] Сменить рецепт сборщика; содержимое здания возвращается в груз. */
declare function setRecipe(machine: Entity, recipe: string): void;

/** [Строительство] Поставить здание из груза. */
declare function build(item: Item, at: Position, direction?: Direction): Entity;

/** [Строительство] Разобрать здание в груз. */
declare function deconstruct(target: Entity): void;

/** [Строительство] Повернуть здание. */
declare function rotate(target: Entity, reverse?: boolean): void;
```

- Всё — в радиусе `me.reach` (иначе `out-of-reach`), около полсекунды на действие.
- `setRecipe`: только сборщики; рецепт должен быть открыт командой и подходить зданию, иначе `invalid-target`.
- `build`: место занято — `target-full`, предмета нет в грузе — `not-enough-items`. Машины программой не ставятся.
- `deconstruct`: только здания своей команды; содержимое здания тоже уходит в груз, не влезает — `cargo-full`.
  Деревья, камни и руда — это добыча (`mine`), а не разборка.

## Жидкости

```ts
interface FluidTank {
  readonly fluid: Fluid | null;        // null — бак пуст
  readonly amount: number;
  readonly capacity: number;           // Mk1 — 1000
}

/**
 * [Жидкости] Набрать в бак: воду — у берега (клетка воды в me.mineReach), нефть — стоя у месторождения.
 * Без amount — до полного бака. Возвращает, сколько набрано.
 */
declare function pump(fluid: Fluid, amount?: number): number;

/** [Жидкости] Залить из бака в здание в радиусе me.reach (котёл, резервуар, завод). Без amount — всё, что влезет. */
declare function fill(into: Entity, amount?: number): number;

/** [Жидкости] Слить из здания в бак (пар из котла, продукты нефтезавода). */
declare function drain(from: Entity, fluid: Fluid, amount?: number): number;
```

- Бак держит одну жидкость; температура сохраняется (пар из котла остаётся горячим).
- Вода — 500 ед/с, перелив в здание и из здания — 500 ед/с. Нефть — как нефтевышкой: раз в секунду
  10 × выработка месторождения (запас / 300 000); каждый цикл снижает запас, выработка падает до 20%.
- Уран добывается, только если в баке серная кислота: 1 кислоты на единицу руды.
- Ошибки — как у предметов (бак — это «груз»): бак полон или в нём другая жидкость — `cargo-full`,
  в баке или здании нет нужного — `not-enough-items`, здание не принимает — `target-full`,
  рядом нечего качать — `no-resource`.

```ts
// Водовоз: от берега к резервуару у котлов
const shore = scan.water()!;
while (true) {
  move(shore, { radius: 2 });
  pump("water");
  move(marker("котельная"), { radius: 2 });
  fill(scan.entities({ name: "storage-tank" })[0]);
}
```

## Энергия

```ts
/** Mk1: переложить топливо из груза в топливный слот. Без item — лучшее, что есть. */
declare function refuel(item?: Item): void;

/** Mk2+: доехать до станции (по умолчанию — ближайшей видимой) и зарядиться полностью. */
declare function charge(station?: Entity): void;
```

Mk1 жжёт топливо из топливного слота; Mk2 и Mk3 работают от аккумулятора (10 и 25 МДж) и топливо
не принимают (`refuel` — `invalid-target`). Станция заряжает на 1 МВт, пока у неё есть энергия из сети;
с пустым аккумулятором машина до станции не доедет — её надо принести. `me.fuel` — заряд от 0 до 1.

## Зрение

Результаты — только в радиусе `me.vision` (Mk1 — 10 клеток), отсортированы от ближнего к дальнему.
Чем больше радиус, тем дороже по энергии.

```ts
declare const scan: {
  /** Машины своей команды рядом. */
  robots(radius?: number): Robot[];
  /** Здания рядом, с фильтром по имени или типу. */
  entities(filter?: { name?: string | string[]; type?: string | string[]; radius?: number }): Entity[];
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
interface Enemy {
  readonly id: number;
  readonly valid: boolean;
  readonly inSight: boolean;
  readonly name: string;
  readonly position: Position;
  readonly health: number;             // 0..1
}
```

```ts
// Увидел врагов — бросаем работу, едем домой, предупреждаем игроков
if (scan.enemies().length > 0) {
  alert(`Враги у машины ${me.name}!`);
  goHome();
}
```

## Карта

Метки и зоны ставят игроки (метка — сущность с именем, зона — прямоугольник, выделенный
инструментом «Программатор»). Зоны «известны» всей команде, поэтому `find` работает на любом
расстоянии — но возвращает здания, у которых без поля зрения доступно только неизменное.

```ts
declare function marker(name: string): Marker;     // ActionError("invalid-target"), если метки нет
declare function zone(name: string): Zone;

interface Marker { readonly name: string; readonly position: Position }
interface Zone {
  readonly name: string;
  readonly area: Area;
  readonly center: Position;
  contains(p: Position): boolean;
}

/** Здания в зоне: по имени ("stone-furnace") или по типу ({ type: "furnace" }). */
declare function find(what: string | { type: string }, where: Zone): Entity[];

declare const map: {
  /** Метка на карте для игроков (например, найденное месторождение). */
  tag(at: Position, text: string, icon?: Item): void;
  untag(at: Position): void;
};
```

## Связь

Все `[Радиосвязь]`. Дальность не ограничена. Сообщение приходит на следующем тике.
Входящий ящик — 64 сообщения; если переполнен, самые старые выбрасываются. Данные копируются при
отправке (у каждого получателя — своя копия), до 2 000 единиц памяти; функции и экземпляры классов
передать нельзя (`not-serializable`). Перезапуск программы очищает ящик и подписки. `send` машине,
которой нет, — `invalid-target`; `reply` на обычное сообщение — сообщение с той же темой.

```ts
interface Message<T extends Value = Value> {
  readonly from: Robot;                // ссылка на отправителя; его позиция — только в поле зрения
  readonly topic: string;
  readonly data: T;
  readonly sentAt: number;             // тик отправки
  /** Ответить отправителю (для request). */
  reply(data: Value): void;
}

/** Сообщение конкретной машине: по ссылке, id или имени. */
declare function send(to: Robot | number | string, topic: string, data?: Value): void;

/** Сообщение всем машинам команды, подписанным на тему. */
declare function broadcast(topic: string, data?: Value): void;
declare function subscribe(topic: string): void;
declare function unsubscribe(topic: string): void;

/** Ждать сообщение (необязательно — только по теме). По таймауту (секунды) — null. */
declare function receive<T extends Value = Value>(topic?: string, timeout?: number): Message<T> | null;

/** Взять сообщение, если оно уже есть, не ожидая. */
declare function tryReceive<T extends Value = Value>(topic?: string): Message<T> | null;

/** Отправить и дождаться ответа. По таймауту — ActionError("timeout"). */
declare function request<T extends Value = Value>(
  to: Robot | number | string, topic: string, data?: Value, timeout?: number,
): T;

/** Ссылка на машину по id или имени (для send, сравнения, move — если видна). */
declare function robot(idOrName: number | string): Robot | null;

declare const inbox: { readonly count: number; readonly dropped: number };
```

```ts
// Машина далеко от склада спрашивает того, кто склад видит
const coal = request<number>("кладовщик", "сколько", "coal", 10);
print(`На складе ${coal} угля`);

// «Кладовщик» стоит у сундука и отвечает
const chest = scan.entities({ name: "steel-chest" })[0];
while (true) {
  const msg = receive<Item>("сколько");
  if (msg !== null) msg.reply(chest.count(msg.data));
}
```

## Доска и задачи

Все `[Радиосвязь]`.

**Доска** — общая память команды «ключ → значение». Каждая операция атомарна, но пара
`get` + `set` — нет: между ними может вклиниться другая машина. Для «захватить, если свободно» есть
`claim` и `compareAndSet`.

```ts
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
```

**Задачи** — очереди заданий: диспетчер кладёт, рабочие забирают. Взятая задача «арендуется»:
если машина не вызвала `done` или `fail` за `lease` секунд (уничтожена, застряла), задача
возвращается в очередь.

```ts
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
```

## Табло

`[Табло]` открывает сущность «Табло»: малое — 3×2 клетки, 96×64 пикселя; большое — 6×4 клетки,
192×128 пикселей. Игрок ставит табло и даёт ему имя, программы рисуют на нём с любого расстояния.
Координаты — в пикселях от левого верхнего угла. Текст моноширинный, поэтому его ширину можно
посчитать заранее (`measureText`).

```ts
declare function display(name: string): Display;

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
```

**Ограничения.** До 2 000 примитивов на табло; соседние пиксели одного цвета в строке склеиваются в один
примитив. Кадр (`frame`) — не чаще 10 раз в секунду (чаще — показывается последний, когда подойдёт время);
рисуются только изменившиеся примитивы. Табло называют при установке; переименовать — `/am-name` под курсором.
Фигуры по умолчанию — контуром (`fill: true` — залитые); значки рисуются под фигурами и текстом.

## Бой

`[Боевые автоматоны]` открывает боевые модели. Бой ведёт движок игры, поэтому он дешёвый:
программа только решает, куда ехать и с кем драться. Патроны расходуются из оружейного слота.

```ts
interface Weapon {
  readonly type: "gun" | "shotgun" | "rocket" | "flamethrower";
  readonly ammo: ItemStack | null;       // заряжено
  readonly range: number;                // дальность, клеток
}

/**
 * Подъехать на дальность выстрела и атаковать, пока цель не уничтожена, не пропала из виду
 * или не кончились патроны. true — цель уничтожена.
 */
declare function attack(target: Enemy | Entity): boolean;

/** Стоять у точки и отбиваться от всех врагов в радиусе, пока until() не вернёт true. */
declare function guard(at: Target, opts?: { radius?: number; until?: () => boolean }): void;

/** Объезжать точки по кругу, атакуя встреченных врагов, пока until() не вернёт true. */
declare function patrol(points: Target[], until?: () => boolean): void;

/** Зарядить оружие патронами из груза. Без ammo — лучшими, что есть. */
declare function reload(ammo?: Item): void;
```

- Боевой Mk1 — пулемёт (магазины: `firearm-magazine` 5 урона за выстрел, `piercing-rounds-magazine` 8,
  `uranium-rounds-magazine` 24), дальность 15, 350 здоровья; Mk2 — ракетомёт (`rocket` 200, `explosive-rocket` 300),
  дальность 24, 700 здоровья. Исследования урона игры действуют. Выстрел тратит один заряд из оружейного
  слота; без патронов машина стреляет вхолостую, а `attack` не начинается (`no-ammo`).
- `me.weapon.ammo.count` — сколько магазинов в слоте (в каждом 10 зарядов).
- `attack` — `false`, если цель ушла из виду или кончились патроны; `guard` по умолчанию охраняет радиус
  «дальность + 5», `patrol` и `guard` проверяют `until` дважды в секунду.
- У рабочих моделей оружия нет: `attack`, `guard`, `patrol`, `reload` — `invalid-target`.

## Сигналы

`[Цепи]`. «Сигнальная метка» (открывается «Цепями») — метка, которую можно подключить проводами:
машины читают сигналы сети и выставляют свои. Обычную метку провода не берут — `invalid-target`.
Читать и писать — только стоя у метки (в радиусе `me.reach`). Читается вся сеть (красный и зелёный
провода вместе), включая то, что выставила сама метка. Сигнал — имя предмета, жидкости или
виртуального сигнала (`"signal-A"`).

```ts
declare const signals: {
  read(at: Marker, signal: string): number;
  readAll(at: Marker): Record<string, number>;
  /** Метка выдаёт эти сигналы в сеть, пока их не перезапишут. */
  write(at: Marker, values: Record<string, number>): void;
};
```

## Время и мир

```ts
declare function wait(seconds: number): void;

/** Ждать, пока cond не вернёт true (проверка раз в `every` секунд). По таймауту — false. */
declare function waitUntil(cond: () => boolean, opts?: { every?: number; timeout?: number }): boolean;

/** Завершить программу (машина встаёт в idle) / начать заново. */
declare function exit(): never;
declare function restart(): never;

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
```

## Ошибки

```ts
declare class ActionError extends Error {
  readonly code: ErrorCode;
}

type ErrorCode =
  | "no-path"            // пути нет
  | "stuck"              // путь есть, но проехать не дают (застряла)
  | "out-of-reach"       // цель дальше досягаемости — сначала move
  | "out-of-sight"       // состояние цели не видно — подъехать или спросить того, кто видит
  | "invalid-target"     // цель уничтожена или не существует
  | "no-fuel"            // кончилась энергия
  | "no-ammo"            // кончились патроны
  | "cargo-full"         // груз полон
  | "not-enough-items"   // в грузе нет столько предметов
  | "target-full"        // в здание больше не влезает
  | "no-resource"        // рядом нет такого месторождения
  | "cancelled"          // действие прервали (новый приказ, остановка программы)
  | "not-researched"     // функция ещё не открыта
  | "timeout"            // истёк таймаут
  | "not-serializable"   // попытка передать функцию или экземпляр класса
  | "limit-exceeded";    // превышен лимит (стек, память, размер сообщения, примитивы табло)
```

## Модели машин

Числа черновые, уточняются на этапе баланса. Досягаемость у всех — как у персонажа.
Наземные машины ездят с поиском пути и сталкиваются со зданиями и друг с другом; летающие летят
по прямой и ни с чем не сталкиваются, зато не добывают и не возят жидкости.

| | Рабочий Mk1 | Рабочий Mk2 | Рабочий Mk3 | Боевой Mk1 | Боевой Mk2 | Летающий Mk1 | Летающий Mk2 |
|---|---|---|---|---|---|---|---|
| Энергия | топливо | аккумулятор | аккумулятор | топливо | аккумулятор | аккумулятор | аккумулятор |
| Груз, слотов | 10 | 20 | 40 | 4 | 8 | 2 | 4 |
| Бак | — | 1 000 | 5 000 | — | — | — | — |
| Досягаемость: здания / месторождение | 10 / 2.7 | 10 / 2.7 | 10 / 2.7 | 10 / — | 10 / — | 10 / — | 10 / — |
| Зрение, клеток | 10 | 20 | 32 | 24 | 32 | 16 | 24 |
| Оружие | — | — | — | пулемёт | ракеты или огнемёт | — | — |
| Инструкций за тик | 50 | 200 | 1 000 | 100 | 400 | 100 | 400 |

## Исследования

| Исследование | Открывает |
|---|---|
| — (старт) | вывод, `me`, движение, предметы, состояние зданий, `repair`, `refuel`, зрение (10 клеток), карта, время и мир |
| Радиосвязь | сообщения, `robot`, доска, задачи |
| Табло | сущность «Табло», `display` |
| Наладка | `setRecipe` |
| Жидкости | бак, `pump`, `fill`, `drain` |
| Строительство | `build`, `deconstruct`, `rotate` |
| Цепи | `signals` |
| Сенсоры 1–3 | радиус зрения 16 / 24 / 32 клетки, `scan.enemies` (со 2-го уровня) |
| Автоматон Mk2 / Mk3 | новые рабочие модели, `charge`, зарядная станция |
| Боевые автоматоны 1–2 | боевые модели, `attack`, `guard`, `patrol`, `reload` |
| Летающие автоматоны 1–2 | летающие модели |
| Скорость, груз, добыча, процессор, память, баки 1–3 | +15% скорости, +50% слотов груза, +25% скорости добычи, +50% инструкций за тик, +50% памяти, +50% бака — за уровень |

Без нужного исследования функция бросает `ActionError("not-researched")`; `me.tank` без «Жидкостей» — `null`.

| Модель | Скорость, клеток/с | Груз | Бак | Инструкций за тик | Энергия |
|---|---|---|---|---|---|
| Рабочий Mk1 | 6 | 10 | 1000 | 50 | топливо |
| Рабочий Mk2 | 8.4 | 20 | 2000 | 100 | аккумулятор 10 МДж |
| Рабочий Mk3 | 10.8 | 30 | 4000 | 200 | аккумулятор 25 МДж |
| Боевой Mk1 | 7.2 | 5 | — | 50 | топливо |
| Боевой Mk2 | 7.8 | 5 | — | 100 | топливо |

## Пример: оркестратор, рабочие и табло занятости

Рабочий после запуска ищет оркестратора (сначала вокруг, потом по радио), регистрируется у него
и выполняет задания. Оркестратор стоит в плавильне, поэтому видит печи; рабочим он сообщает,
какую печь кормить — сами они печь издалека не видят.

```ts
// Программа «Оркестратор»
type Order = { furnace: Entity; ore: Item };
type Done = { furnaceId: number };

interface WorkerInfo { robot: Robot; name: string; status: string; busy: boolean }

const screen = display("штаб");
const workers = new Map<number, WorkerInfo>();
const assigned = new Set<number>();            // печи, на которые уже выдано задание

move(zone("плавильня"));
subscribe("ищу-оркестратора");

function handleMail(): void {
  for (let m = tryReceive("ищу-оркестратора"); m !== null; m = tryReceive("ищу-оркестратора")) {
    send(m.from, "оркестратор", me.id);
  }
  for (let m = tryReceive<string>("регистрация"); m !== null; m = tryReceive<string>("регистрация")) {
    workers.set(m.from.id, { robot: m.from, name: m.data, status: "свободен", busy: false });
    m.reply("ok");
  }
  for (let m = tryReceive<Done>("готово"); m !== null; m = tryReceive<Done>("готово")) {
    assigned.delete(m.data.furnaceId);
    const w = workers.get(m.from.id);
    if (w !== undefined) {
      w.busy = false;
      w.status = "свободен";
    }
  }
}

function assignWork(): void {
  const hungry = scan.entities({ name: "stone-furnace" })
    .filter(f => f.count("iron-ore") < 10 && !assigned.has(f.id));
  let next = 0;
  for (const w of workers.values()) {
    if (next >= hungry.length) break;
    if (w.busy) continue;
    const furnace = hungry[next++];
    assigned.add(furnace.id);
    w.busy = true;
    w.status = `руда → печь #${furnace.id}`;
    const order: Order = { furnace, ore: "iron-ore" };
    send(w.robot, "задание", order);
  }
}

function draw(): void {
  const list = [...workers.values()];
  const busy = list.filter(w => w.busy).length;
  const rows: Cell[][] = list.map(w => [
    w.name,
    { text: w.status, color: w.busy ? "yellow" : "green" },
  ]);

  screen.frame(() => {
    screen.clear("black");
    screen.text(4, 4, "Занятость роботов", { color: "yellow", size: 12 });
    screen.table(4, 20, [["Робот", "Задача"], ...rows], { header: true });
    screen.bar(4, screen.height - 10, screen.width - 8, 6, list.length === 0 ? 0 : busy / list.length, "green");
  });
}

while (true) {
  handleMail();
  assignWork();
  draw();
  wait(1);
}
```

```ts
// Программа «Рабочий»
type Order = { furnace: Entity; ore: Item };

function findBoss(): number {
  const near = scan.robots().find(r => r.program === "Оркестратор");
  if (near !== undefined) return near.id;
  while (true) {
    broadcast("ищу-оркестратора");
    const answer = receive<number>("оркестратор", 10);
    if (answer !== null) return answer.data;
  }
}

const { field } = me.args<{ field: string }>();
const boss = findBoss();
request(boss, "регистрация", me.name, 30);

while (true) {
  const msg = receive<Order>("задание");
  if (msg === null) continue;

  const { furnace, ore } = msg.data;
  try {
    move(zone(field));
    mine(ore, 50);
    move(furnace);
    put(furnace, ore);
  } catch (e) {
    say(`Не вышло: ${e instanceof ActionError ? e.code : "?"}`);
  } finally {
    send(boss, "готово", { furnaceId: furnace.id });
  }
}
```

## Пример: разведчик

```ts
// Программа «Разведчик»: едет по расширяющейся спирали, отмечает месторождения на карте.
const seen = new Set<string>();
const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
let pos = me.position;
let step = 10;

for (let turn = 0; me.fuel > 0.3; turn++) {
  for (const patch of scan.resources()) {
    const key = `${patch.item}:${Math.floor(patch.center.x / 32)}:${Math.floor(patch.center.y / 32)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    map.tag(patch.center, `${patch.item}: ${patch.amount}`, patch.item);
    chat(`Нашёл ${patch.item}, запас ${patch.amount}`);
  }

  const [dx, dy] = dirs[turn % 4];
  pos = { x: pos.x + dx * step, y: pos.y + dy * step };
  try {
    move(pos);
  } catch {
    // препятствие или вода — просто следующий виток
  }
  if (turn % 2 === 1) step += 10;
}

goHome();
```

## Пример: патруль

```ts
// Программа «Патруль»: объезжает посты; кончаются патроны — едет в арсенал,
// сильно повреждён — зовёт ремонтника и ждёт дома.
const route = [marker("пост-1"), marker("пост-2"), marker("пост-3")];
const arsenal = find("steel-chest", zone("арсенал"))[0];
const ammoLeft = () => me.weapon?.ammo?.count ?? 0;

while (true) {
  if (ammoLeft() < 20) {
    move(arsenal);
    take(arsenal, "firearm-magazine", 50);
    reload();
  }

  patrol(route, () => ammoLeft() < 20 || me.health < 0.4);

  if (me.health < 0.4) {
    broadcast("нужен-ремонт", me.id);
    goHome();
    waitUntil(() => me.health > 0.9, { every: 2 });
  }
}
```

## Решения по умолчанию — поправь, если не так

1. **Табло рисуется с любого расстояния**: считаю это связью, а не работой руками.
2. **`valid` у далёких зданий и машин читается всегда**: иначе программы обрастают проверками.
   Остальное состояние — только в поле зрения.
3. **`find` в зонах работает на любом расстоянии**, но отдаёт только неизменное (позиции, имена);
   состояние — в поле зрения или через сообщения.
4. **Сигналы цепей** читаются и пишутся только у метки, как работа руками.
