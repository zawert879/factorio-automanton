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
  квант не тратят, поэтому ждать через них выгоднее, чем крутиться вхолостую. Что сколько стоит и когда
  выполняется строка — раздел [«Время программы»](#время-программы).
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


## Время программы

Программа не выполняется «мгновенно целиком»: у машины на каждый тик есть **квант** — сколько
инструкций она может выполнить. Время программы складывается из трёх вещей.

**1. Квант.** Рабочий Mk1 — 50 инструкций за тик, Mk2 — 100, Mk3 — 200; боевые Mk1 / Mk2 — 50 / 100,
летающие — 100; исследование «Процессор» увеличивает квант. Кончился квант — программа встаёт на паузу
в ближайшей точке остановки (виток цикла, вход в функцию) и со следующего тика продолжает с того же места.
Это не ошибка.

**2. Ожидание.** Действия (`move`, `mine`, `take`, `put`, …), `wait`, `waitUntil`, `receive`, `request` —
точки, где программа ждёт: квант на это не тратится, машина не исполняется, пока ожидание не кончится.

**3. Долг.** Тяжёлый вызов библиотеки выполняется целиком, даже если стоит больше оставшегося кванта
(например, `publish` тысяче подписчиков: все письма уходят в этом тике). Перерасход становится долгом:
следующие тики машина пропускает, по кванту за тик, пока не отработает. В среднем машина всё равно
делает не больше кванта работы за тик.

**Что сколько стоит:**

| Что | Цена в инструкциях кванта |
|---|---|
| Виток любого цикла (`while`, `for`, `for…of`, `do…while`) | 1 |
| Вызов функции, в которой есть цикл, действие или вызов такой же функции | 1 |
| Короткая функция (без циклов и действий) и обычные выражения | 0 |
| `forEach` / `map` / `filter` / `find` / `some` / `every` / `reduce` с короткой лямбдой; `Map` / `Set` `forEach` | 1 за элемент, сразу (может дать долг) |
| Те же методы с лямбдой, в которой действие или цикл | 1 за элемент, с паузами, как цикл |
| `sort` | 1 на 8 элементов |
| `shift` | 1 на 64 элемента массива |
| `Array.from(…, f)` | 1 за элемент |
| `JSON.stringify` / `JSON.parse` | 1 за объект и массив / 1 на 256 символов текста |
| `publish` | 1 за каждого подписчика, которому ушло письмо |
| Действия, `wait`, `receive`, `request` | 0 (машина ждёт) |

**На всех машин** в тике есть общий бюджет (настройка карты, по умолчанию 20 000 инструкций). Он
раздаётся готовым к работе машинам по кругу. Если машин много и все считают, часть получит ход тиком
позже — машины «думают» медленнее, а игра не тормозит. Ждущие машины бюджет не тратят.

**Что из этого следует.** Между двумя соседними строками могут пройти тики, если между ними цикл или
тяжёлый вызов, — а мир за это время меняется: другие машины забирают предметы, здания работают.
Поэтому результат действия проверяют, а не предполагают: `take` возвращает, сколько реально взято, а если
брать нечего — `ActionError("not-enough-items")`. Сообщения доходят на следующем тике после отправки.

Пример на Mk1 (квант 50):

```
const coal = chest.count("coal")            // A
publish("склад", coal)                       // B: 120 подписчиков
for (const id of helpers) send(id, "иди", coal)   // C: 100 помощников
take(chest, "coal", 10)                      // D
```

| Тик | Программа | Получатели |
|---|---|---|
| 1 | A и B: 120 писем уходят сразу, перерасход ~70 — долг | |
| 2 | долг (пропуск) | 120 подписчиков получили письмо |
| 3 | долг (пропуск) | |
| 4 | C: 50 витков | |
| 5 | C: ещё 50 витков, начинается D | 50 помощников получили |
| 6 | D идёт (действие) | ещё 50 помощников |

От A до D — около 4 тиков (меньше десятой доли секунды), и уголь в сундуке за это время мог измениться.

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
| [Связь](#связь) | `send`, `publish`, `subscribe`, `receive`, `request`, `robot` | [Радиосвязь] |
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

`print` и `console.log` печатают значения как `console.log` в Node: строка — как есть, остальное —
с содержимым. Многострочный текст (например, `JSON.stringify(x, null, 2)`) — построчно.

| Значение | В консоли |
|---|---|
| Массив, объект | `[1, "a", [2, 3]]`, `{ ore: "coal", count: 5 }` (ключи — по алфавиту) |
| Экземпляр класса | `Route { from: "склад", keep: 20 }` (свой `toString` — его текст) |
| `Map`, `Set` | `Map(2) { "a" => 1, "b" => 2 }`, `Set(2) { 1, 2 }` |
| Ошибка | `ActionError: no path (no-path)` |
| Здание, машина | `Entity(stone-furnace #12 @ 10.5, 5.5)`, `Robot(АМ-7 #7)` (`me` — тоже) |
| Метка, зона, табло | `Marker(склад)`, `Zone(плавильня)`, `Display(штаб)` |
| Груз, сообщение, задача | `Inventory { coal: 7 }`, `Message(Robot(АМ-3 #3), "тема": данные)`, `Task(работа #4: данные)` |
| Функция, класс, цикл | `[Function]`, `[class Route]`, `[Circular]` |

Глубже 4 уровней — кратко (`[Array(5)]`, `{…}`), в массиве и объекте — первые 30 элементов (`…+70`).
`String(x)` и шаблонные строки — как в JavaScript (`[object Object]`, `1,2,3`).

```ts
/**
 * Строка в консоль машины (окно машины, последние 100 строк); значения — как console.log в Node.
 * @en One line to the machine console (machine window, last 100 lines); values are shown like console.log in Node.
 */
declare function print(...values: unknown[]): void;
declare const console: { log(...values: unknown[]): void };   // то же, что print @en same as print

/**
 * Облачко с текстом над машиной на `seconds` секунд (по умолчанию 3). Видят все игроки.
 * @en A speech bubble with text above the machine for `seconds` seconds (3 by default). All players see it.
 */
declare function say(text: string, seconds?: number): void;

/**
 * Сообщение в чат команды. Не чаще раза в 5 секунд с одной машины.
 * @en A message to the team chat. At most once every 5 seconds per machine.
 */
declare function chat(text: string): void;

/**
 * Оповещение игрокам команды: значок у миникарты, клик ведёт к машине.
 * @en An alert for the team's players: an icon near the minimap, a click leads to the machine.
 */
declare function alert(text: string): void;
```

```ts
// Что везёт машина — в консоль, игрокам — облачко над ней
print("груз:", me.cargo.items());
say(`Везу ${me.cargo.count()} предметов`, 5);
if (me.fuel < 0.1) alert(`${me.name}: кончается топливо`);
```

## Своя машина (`me`)

```ts
declare const me: Me;

type Model =
  | "worker-mk1" | "worker-mk2" | "worker-mk3"
  | "combat-mk1" | "combat-mk2"
  | "flyer-mk1" | "flyer-mk2";

interface Robot {
  // Всегда: @en Always:
  readonly id: number;
  readonly name: string;
  readonly model: Model;
  readonly valid: boolean;             // false, если машину уничтожили или подобрали @en false if the machine was destroyed or picked up
  /**
   * Видна ли сейчас. Поля ниже — только если видна, иначе ActionError("out-of-sight").
   * @en Whether it is visible now. The fields below work only while it is visible, otherwise ActionError("out-of-sight").
   */
  readonly inSight: boolean;
  // Только в поле зрения: @en Only within sight:
  readonly position: Position;
  readonly state: RobotState;
  readonly program: string | null;     // имя программы из библиотеки @en name of the program from the library
  readonly health: number;             // 0..1
  distance(to: Target): number;
}

type RobotState =
  | "idle" | "moving" | "mining" | "transferring" | "pumping" | "building" | "fighting"
  | "waiting" | "thinking" | "no-fuel" | "stuck" | "error";

interface Me extends Robot {
  name: string;                        // можно переименовать себя из программы @en a program can rename its own machine
  label: string;                       // постоянная подпись над машиной (в отличие от say) @en a permanent label above the machine (unlike say)
  readonly cargo: Inventory;
  readonly fuel: number;               // 0..1 — топливо или заряд @en 0..1 — fuel or charge
  readonly tank: FluidTank | null;     // бак, если есть у модели @en the tank, if the model has one
  readonly weapon: Weapon | null;      // оружие, если модель боевая @en the weapon, if it is a combat model
  readonly reach: number;              // досягаемость до зданий, клеток (как у персонажа) @en reach to buildings, in tiles (like a character's)
  readonly mineReach: number;          // досягаемость до месторождения, клеток @en reach to resource patches, in tiles
  readonly vision: number;             // радиус зрения, клеток @en vision radius, in tiles
  readonly home: Position | null;      // «дом», задаётся в окне машины @en "home", set in the machine window
  /**
   * Параметры программы, заданные в окне машины. Одна программа — разные настройки у разных машин.
   * @en Program parameters set in the machine window. One program, different settings on different machines.
   */
  args<T>(): T;
  /**
   * Память, которая переживает перезапуск программы и подбор машины.
   * @en Memory that survives a program restart and picking the machine up.
   */
  readonly memory: {
    get<T extends Value>(key: string): T | null;
    set(key: string, value: Value): void;
    delete(key: string): void;
  };
}

interface Inventory {
  count(item?: Item): number;          // без аргумента — всего предметов @en without an argument — all items
  items(): ItemStack[];
  free(item?: Item): number;           // сколько ещё влезет (этого предмета) @en how much more fits (of this item)
  isEmpty(): boolean;
  isFull(): boolean;
}
```

```ts
// Одна программа «Шахтёр» на всех машинах, у каждой свои параметры в окне машины
const { ore, field } = me.args<{ ore: Item; field: string }>();
me.label = `копаю ${ore}`;
```

## Движение

```ts
/**
 * Доехать до цели. К машине — только если она в поле зрения (иначе спроси у неё позицию сообщением).
 * ActionError("no-path"), если пути нет.
 * @en Drive to the target. To a machine — only if it is within sight (otherwise ask it for its position with a message). ActionError("no-path") if there is no path.
 */
declare function move(to: Target, opts?: { radius?: number; timeout?: number }): void;

/**
 * Есть ли путь до цели (спрашивает поиск пути, занимает несколько тиков).
 * @en Whether there is a path to the target (asks the pathfinder, takes a few ticks).
 */
declare function canReach(to: Target): boolean;

/**
 * Ехать следом за целью, пока `until` не вернёт true. false — цель потеряна из виду.
 * @en Follow the target until `until` returns true. false — the target was lost from sight.
 */
declare function follow(target: Robot | Entity, until: () => boolean): boolean;

/**
 * Вернуться в me.home.
 * @en Return to me.home.
 */
declare function goHome(): void;
```

```ts
// Доехать до метки «склад», а если пути нет — вернуться домой
const depot = marker("склад");
if (canReach(depot)) move(depot, { radius: 2 });
else goHome();
```

## Предметы

```ts
/**
 * Добыть ресурс, стоя у месторождения. Без count — пока не заполнится груз. Возвращает, сколько добыто.
 * @en Mine a resource while standing at the patch. Without count — until the cargo is full. Returns how much was mined.
 */
declare function mine(item: Item, count?: number): number;

/**
 * Взять из здания в радиусе me.reach: выход печи и сборщика, сундук, вагон.
 * @en Take from a building within me.reach: furnace and assembler output, chest, wagon.
 */
declare function take(from: Entity, item: Item, count?: number): number;

/**
 * Положить в здание в радиусе me.reach — в нужный слот: вход печи и сборщика, топливо котла, патроны турели, наука лаборатории.
 * @en Put into a building within me.reach, into the right slot: furnace and assembler input, boiler fuel, turret ammo, lab science packs.
 */
declare function put(into: Entity, item: Item, count?: number): number;

/**
 * Подобрать предметы с земли вплотную. Без item — всё подряд.
 * @en Pick up items lying right next to the machine. Without item — everything.
 */
declare function pickup(item?: Item, count?: number): number;

/**
 * Выбросить предметы на землю.
 * @en Drop items on the ground.
 */
declare function drop(item: Item, count?: number): number;

/**
 * Передать предметы другой машине в радиусе me.reach — «из рук в руки», без сундука.
 * @en Hand items to another machine within me.reach, without a chest.
 */
declare function give(to: Robot, item: Item, count?: number): number;
```

```ts
// Накопать 20 угля и сложить в ближайший сундук
mine("coal", 20);
const chest = scan.entities({ type: "container" })[0];
move(chest);
put(chest, "coal");
```

## Здания

```ts
interface Entity {
  // Всегда: @en Always:
  readonly id: number;
  readonly valid: boolean;
  readonly name: string;               // "stone-furnace"
  readonly type: string;               // "furnace"
  readonly position: Position;
  /**
   * Видно ли сейчас. Поля и методы ниже — только если видно, иначе ActionError("out-of-sight").
   * @en Whether it is visible now. The fields and methods below work only while it is visible, otherwise ActionError("out-of-sight").
   */
  readonly inSight: boolean;
  // Только в поле зрения: @en Only within sight:
  readonly status: EntityStatus;
  readonly health: number;             // 0..1
  readonly recipe: string | null;      // у сборщиков и печей @en for assemblers and furnaces
  readonly progress: number;           // прогресс текущего крафта, 0..1 @en progress of the current craft, 0..1
  count(item: Item): number;           // во всех инвентарях здания @en in all of the building's inventories
  input(): Inventory | null;
  output(): Inventory | null;
  fuel(): Inventory | null;
  fluid(name?: Fluid): number;
}

type EntityStatus =
  | "working" | "no-input" | "output-full" | "no-fuel" | "no-power"
  | "no-recipe" | "disabled" | "idle";

/**
 * Починить здание или машину ремкомплектами из груза (в радиусе me.reach).
 * @en Repair a building or a machine with repair packs from the cargo (within me.reach).
 */
declare function repair(target: Entity | Robot): void;

/**
 * [Наладка] Сменить рецепт сборщика; содержимое здания возвращается в груз.
 * @en [Configuration] Change an assembler's recipe; the building's contents go back to the cargo.
 */
declare function setRecipe(machine: Entity, recipe: string): void;

/**
 * [Строительство] Поставить здание из груза.
 * @en [Construction] Place a building from the cargo.
 */
declare function build(item: Item, at: Position, direction?: Direction): Entity;

/**
 * [Строительство] Разобрать здание в груз.
 * @en [Construction] Deconstruct a building into the cargo.
 */
declare function deconstruct(target: Entity): void;

/**
 * [Строительство] Повернуть здание.
 * @en [Construction] Rotate a building.
 */
declare function rotate(target: Entity, reverse?: boolean): void;
```

```ts
// Печь у метки «печь»: забрать готовые плиты, без топлива — подложить угля
move(marker("печь"), { radius: 2 });
const furnace = scan.entities({ type: "furnace" })[0];
take(furnace, "iron-plate");
if (furnace.status === "no-fuel") put(furnace, "coal", 5);
```

- Всё — в радиусе `me.reach` (иначе `out-of-reach`), около полсекунды на действие.
- `setRecipe`: только сборщики; рецепт должен быть открыт командой и подходить зданию, иначе `invalid-target`.
- `build`: место занято — `target-full`, предмета нет в грузе — `not-enough-items`. Машины программой не ставятся.
- `deconstruct`: только здания своей команды; содержимое здания тоже уходит в груз, не влезает — `cargo-full`.
  Деревья, камни и руда — это добыча (`mine`), а не разборка.

## Жидкости

```ts
interface FluidTank {
  readonly fluid: Fluid | null;        // null — бак пуст @en null — the tank is empty
  readonly amount: number;
  readonly capacity: number;           // Mk1 — 1000
}

/**
 * [Жидкости] Набрать в бак: воду — у берега (клетка воды в me.mineReach), нефть — стоя у месторождения.
 * Без amount — до полного бака. Возвращает, сколько набрано.
 * @en [Fluids] Fill the tank: water at the shore (a water tile within me.mineReach), crude oil while standing at the patch. Without amount — until the tank is full. Returns how much was taken.
 */
declare function pump(fluid: Fluid, amount?: number): number;

/**
 * [Жидкости] Залить из бака в здание в радиусе me.reach (котёл, резервуар, завод). Без amount — всё, что влезет.
 * @en [Fluids] Pour from the tank into a building within me.reach (boiler, storage tank, refinery). Without amount — as much as fits.
 */
declare function fill(into: Entity, amount?: number): number;

/**
 * [Жидкости] Слить из здания в бак (пар из котла, продукты нефтезавода).
 * @en [Fluids] Drain from a building into the tank (steam from a boiler, refinery products).
 */
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
/**
 * Mk1: переложить топливо из груза в топливный слот. Без item — лучшее, что есть.
 * @en Mk1: move fuel from the cargo into the fuel slot. Without item — the best available.
 */
declare function refuel(item?: Item): void;

/**
 * Mk2+: доехать до станции (по умолчанию — ближайшей видимой) и зарядиться полностью.
 * @en Mk2+: drive to a station (by default the nearest visible one) and charge fully.
 */
declare function charge(station?: Entity): void;
```

```ts
// Mk1 подкладывает уголь из груза, Mk2 и выше — едут на зарядную станцию
if (me.fuel < 0.2) {
  if (me.model === "worker-mk1") refuel("coal");
  else charge();
}
```

Mk1 жжёт топливо из топливного слота; Mk2 и Mk3 работают от аккумулятора (10 и 25 МДж) и топливо
не принимают (`refuel` — `invalid-target`). Станция заряжает на 1 МВт, пока у неё есть энергия из сети;
с пустым аккумулятором машина до станции не доедет — её надо принести. `me.fuel` — заряд от 0 до 1.

## Зрение

Результаты — только в радиусе `me.vision` (Mk1 — 10 клеток), отсортированы от ближнего к дальнему.
Чем больше радиус, тем дороже по энергии.

```ts
declare const scan: {
  /**
   * Машины своей команды рядом.
   * @en Machines of your team nearby.
   */
  robots(radius?: number): Robot[];
  /**
   * Здания рядом, с фильтром по имени или типу.
   * @en Buildings nearby, filtered by name or type.
   */
  entities(filter?: { name?: string | string[]; type?: string | string[]; radius?: number }): Entity[];
  /**
   * Предметы, лежащие на земле.
   * @en Items lying on the ground.
   */
  items(radius?: number): GroundItem[];
  /**
   * Месторождения рядом, сгруппированные по ресурсу.
   * @en Resource patches nearby, grouped by resource.
   */
  resources(radius?: number): ResourcePatch[];
  /**
   * [Сенсоры] Враги: кусаки, плеваки, гнёзда, черви.
   * @en [Sensors] Enemies: biters, spitters, nests, worms.
   */
  enemies(radius?: number): Enemy[];
  /**
   * Ближайшая вода.
   * @en The nearest water.
   */
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
declare function marker(name: string): Marker;     // ActionError("invalid-target"), если метки нет @en ActionError("invalid-target") if there is no such marker
declare function zone(name: string): Zone;

interface Marker { readonly name: string; readonly position: Position }
interface Zone {
  readonly name: string;
  readonly area: Area;
  readonly center: Position;
  contains(p: Position): boolean;
}

/**
 * Здания в зоне: по имени ("stone-furnace") или по типу ({ type: "furnace" }).
 * @en Buildings in the zone: by name ("stone-furnace") or by type ({ type: "furnace" }).
 */
declare function find(what: string | { type: string }, where: Zone): Entity[];

declare const map: {
  /**
   * Метка на карте для игроков (например, найденное месторождение).
   * @en A map tag for players (for example, a patch that was found).
   */
  tag(at: Position, text: string, icon?: Item): void;
  untag(at: Position): void;
};
```

```ts
// Все печи зоны «плавильня»; найденное месторождение — метка на карте для игроков
for (const furnace of find("stone-furnace", zone("плавильня"))) print(furnace.status);
const patches = scan.resources();
if (patches.length > 0) map.tag(patches[0].center, `${patches[0].item}: ${patches[0].amount}`, patches[0].item);
```

## Связь

Все `[Радиосвязь]`. Дальность не ограничена. Сообщение приходит на следующем тике.
Входящий ящик — 64 сообщения; если переполнен, самые старые выбрасываются. Данные копируются при
отправке (у каждого получателя — своя копия), до 2 000 единиц памяти; функции и экземпляры классов
передать нельзя (`not-serializable`). Перезапуск программы очищает ящик и её подписки (подписки других
машин на неё остаются). `send` машине, которой нет, — `invalid-target`; `reply` на обычное сообщение —
сообщение с той же темой.

**Рассылки всем нет.** Машина публикует обновления (`publish`), а получают их только машины, которые
подписались именно на неё (`subscribe(id)` — на все её темы, `subscribe(id, "тема")` — на одну). Цена
публикации — число её подписчиков, а не всех машин: рассылка всем на тысячах машин съедала бы весь тик.
Найти нужную машину — по доске (`board.set("оркестратор", me.id)` у неё, `board.get` у остальных) или
зрением (`scan.robots()`).

```ts
interface Message<T extends Value = Value> {
  readonly from: Robot;                // ссылка на отправителя; его позиция — только в поле зрения @en a reference to the sender; its position only within sight
  readonly topic: string;
  readonly data: T;
  readonly sentAt: number;             // тик отправки @en the tick it was sent
  /**
   * Ответить отправителю (для request).
   * @en Reply to the sender (for request).
   */
  reply(data: Value): void;
}

/**
 * Сообщение конкретной машине: по ссылке, id или имени.
 * @en A message to a specific machine: by reference, id or name.
 */
declare function send(to: Robot | number | string, topic: string, data?: Value): void;

/**
 * Опубликовать обновление: получат машины, подписанные на эту (на все её темы или на эту тему).
 * @en Publish an update: machines subscribed to this one receive it (to all its topics or to this topic).
 */
declare function publish(topic: string, data?: Value): void;
/**
 * Подписаться на публикации машины (по ссылке, id или имени): на все её темы или на одну.
 * @en Subscribe to a machine's publications (by reference, id or name): to all its topics or to one.
 */
declare function subscribe(robot: Robot | number | string, topic?: string): void;
/**
 * Отписаться от машины: от темы или (без темы) совсем.
 * @en Unsubscribe from a machine: from a topic or (without a topic) entirely.
 */
declare function unsubscribe(robot: Robot | number | string, topic?: string): void;

/**
 * Ждать сообщение (необязательно — только по теме). По таймауту (секунды) — null.
 * @en Wait for a message (optionally only on a topic). On timeout (seconds) — null.
 */
declare function receive<T extends Value = Value>(topic?: string, timeout?: number): Message<T> | null;

/**
 * Взять сообщение, если оно уже есть, не ожидая.
 * @en Take a message if one is already there, without waiting.
 */
declare function tryReceive<T extends Value = Value>(topic?: string): Message<T> | null;

/**
 * Отправить и дождаться ответа. По таймауту — ActionError("timeout").
 * @en Send and wait for the reply. On timeout — ActionError("timeout").
 */
declare function request<T extends Value = Value>(
  to: Robot | number | string, topic: string, data?: Value, timeout?: number,
): T;

/**
 * Ссылка на машину по id или имени (для send, сравнения, move — если видна).
 * @en A reference to a machine by id or name (for send, comparison, move — if it is visible).
 */
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
  /**
   * Атомарно прибавить, вернуть новое значение.
   * @en Atomically add and return the new value.
   */
  increment(key: string, by?: number): number;
  /**
   * Атомарно заменить, только если сейчас там expected.
   * @en Atomically replace, only if the current value is expected.
   */
  compareAndSet(key: string, expected: Value, value: Value): boolean;
  /**
   * Захватить ключ на ttl секунд. true — захватила эта машина.
   * @en Take the key for ttl seconds. true — this machine got it.
   */
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
  /**
   * Ждать задачу (блокирует). По таймауту — null.
   * @en Wait for a task (blocks). On timeout — null.
   */
  next<T extends Value>(queue: string, opts?: { timeout?: number; lease?: number }): Task<T> | null;
  size(queue: string): number;
};

interface Task<T extends Value> {
  readonly data: T;
  done(): void;
  fail(reason?: string): void;           // вернуть в очередь @en return it to the queue
}
```

```ts
// Учёт на доске, работа — из очереди «доставка»
board.increment("уголь", 20);
tasks.push("доставка", { item: "coal", to: "котельная" });
const task = tasks.next<{ item: Item; to: string }>("доставка", { timeout: 30 });
if (task !== null) {
  move(marker(task.data.to), { radius: 2 });
  task.done();
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
  /**
   * size — высота строки в пикселях (по умолчанию 8).
   * @en size — line height in pixels (8 by default).
   */
  text(x: number, y: number, text: string, style?: { color?: Color; size?: number; align?: "left" | "center" | "right" }): void;
  measureText(text: string, size?: number): number;
  icon(x: number, y: number, item: Item, size?: number): void;
  /**
   * Полоска заполнения, value — 0..1.
   * @en A fill bar, value is 0..1.
   */
  bar(x: number, y: number, width: number, height: number, value: number, color?: Color): void;
  /**
   * Таблица из строк ячеек; с header первая строка выделяется. Возвращает занятый размер.
   * @en A table from rows of cells; with header the first row is highlighted. Returns the size it took.
   */
  table(x: number, y: number, rows: Cell[][], opts?: { header?: boolean; size?: number; columnWidths?: number[] }): { width: number; height: number };
  /**
   * Всё нарисованное внутри frame появляется разом, без мерцания.
   * @en Everything drawn inside frame appears at once, without flicker.
   */
  frame(draw: () => void): void;
}

type ShapeStyle = { color?: Color; fill?: boolean; width?: number };

type Color =
  | "black" | "white" | "gray" | "red" | "orange" | "yellow" | "green" | "blue" | "purple"
  | { r: number; g: number; b: number };

type Cell = string | number | { text: string; color?: Color; icon?: Item };
```

```ts
// Табло «склад»: заголовок и полоска — сколько угля в сундуке зоны «склад»
const screen = display("склад");
const chest = find("wooden-chest", zone("склад"))[0];
screen.frame(() => {
  screen.clear("black");
  screen.text(4, 4, "Склад", { color: "yellow" });
  screen.bar(4, 20, screen.width - 8, 6, chest.count("coal") / 1600, "green");
});
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
  readonly ammo: ItemStack | null;       // заряжено @en loaded
  readonly range: number;                // дальность, клеток @en range, in tiles
}

/**
 * Подъехать на дальность выстрела и атаковать, пока цель не уничтожена, не пропала из виду
 * или не кончились патроны. true — цель уничтожена.
 * @en Drive within firing range and attack until the target is destroyed, lost from sight or the ammo runs out. true — the target was destroyed.
 */
declare function attack(target: Enemy | Entity): boolean;

/**
 * Стоять у точки и отбиваться от всех врагов в радиусе, пока until() не вернёт true.
 * @en Stand at the point and fight off all enemies within the radius until until() returns true.
 */
declare function guard(at: Target, opts?: { radius?: number; until?: () => boolean }): void;

/**
 * Объезжать точки по кругу, атакуя встреченных врагов, пока until() не вернёт true.
 * @en Patrol the points in a loop, attacking enemies on the way, until until() returns true.
 */
declare function patrol(points: Target[], until?: () => boolean): void;

/**
 * Зарядить оружие патронами из груза. Без ammo — лучшими, что есть.
 * @en Load the weapon with ammo from the cargo. Without ammo — the best available.
 */
declare function reload(ammo?: Item): void;
```

```ts
// Охрана: зарядить оружие и стоять у поста, пока не наступит ночь
reload();
guard(marker("пост"), { radius: 15, until: () => time.isNight() });
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
  /**
   * Метка выдаёт эти сигналы в сеть, пока их не перезапишут.
   * @en The marker sends these signals to the circuit network until they are overwritten.
   */
  write(at: Marker, values: Record<string, number>): void;
};
```

```ts
// Сигнальная метка «бак»: воды меньше 1000 — выставить в сеть сигнал P
const tank = marker("бак");
move(tank, { radius: 2 });
if (signals.read(tank, "water") < 1000) signals.write(tank, { "signal-P": 1 });
```

## Время и мир

```ts
declare function wait(seconds: number): void;

/**
 * Ждать, пока cond не вернёт true (проверка раз в `every` секунд). По таймауту — false.
 * @en Wait until cond returns true (checked every `every` seconds). On timeout — false.
 */
declare function waitUntil(cond: () => boolean, opts?: { every?: number; timeout?: number }): boolean;

/**
 * Завершить программу (машина встаёт в idle) / начать заново.
 * @en End the program (the machine goes idle) / start it over.
 */
declare function exit(): never;
declare function restart(): never;

declare const time: {
  readonly tick: number;
  readonly seconds: number;            // с начала игры @en since the start of the game
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
    /**
     * Сколько предмета команда произвела / потратила за период.
     * @en How much of an item the team produced / consumed over the period.
     */
    produced(item: Item, period?: "1m" | "10m" | "1h"): number;
    consumed(item: Item, period?: "1m" | "10m" | "1h"): number;
  };
};
```

```ts
// Ночью — домой и ждать утра; рецепт — из справочника игры
if (time.isNight()) {
  goHome();
  waitUntil(() => !time.isNight(), { every: 10 });
}
const gear = world.recipe("iron-gear-wheel");
if (gear !== null) print("шестерня из:", gear.ingredients);
```

## Ошибки

```ts
declare class ActionError extends Error {
  readonly code: ErrorCode;
}

type ErrorCode =
  | "no-path"            // пути нет @en no path
  | "stuck"              // путь есть, но проехать не дают (застряла) @en there is a path, but the way is blocked (stuck)
  | "out-of-reach"       // цель дальше досягаемости — сначала move @en the target is out of reach — move first
  | "out-of-sight"       // состояние цели не видно — подъехать или спросить того, кто видит @en the target's state is not visible — drive closer or ask someone who sees it
  | "invalid-target"     // цель уничтожена или не существует @en the target is destroyed or does not exist
  | "no-fuel"            // кончилась энергия @en out of energy
  | "no-ammo"            // кончились патроны @en out of ammo
  | "cargo-full"         // груз полон @en the cargo is full
  | "not-enough-items"   // в грузе нет столько предметов @en not enough items in the cargo
  | "target-full"        // в здание больше не влезает @en the building can't take any more
  | "no-resource"        // рядом нет такого месторождения @en no such resource patch nearby
  | "cancelled"          // действие прервали (новый приказ, остановка программы) @en the action was interrupted (a new order, the program stopped)
  | "not-researched"     // функция ещё не открыта @en the function is not researched yet
  | "timeout"            // истёк таймаут @en the timeout expired
  | "not-serializable"   // попытка передать функцию или экземпляр класса @en tried to pass a function or a class instance
  | "limit-exceeded";    // превышен лимит (стек, память, размер сообщения, примитивы табло) @en a limit was exceeded (stack, memory, message size, display primitives)
```

```ts
// Сундук полон — подождать, остальные ошибки — дальше (машина остановится с текстом ошибки)
try {
  put(scan.entities({ type: "container" })[0], "coal");
} catch (e) {
  if (e instanceof ActionError && e.code === "target-full") wait(5);
  else throw e;
}
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
// Рабочие находят оркестратора по доске (рассылки всем нет).
board.set("оркестратор", me.id);

function handleMail(): void {
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
  // Далеко — по доске: оркестратор записал туда свой id.
  waitUntil(() => board.get<number>("оркестратор") !== null, { every: 5 });
  return board.get<number>("оркестратор")!;
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
    publish("нужен-ремонт", me.id);   // получат ремонтники, подписанные на эту машину
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
