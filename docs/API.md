# Встроенная библиотека автоматонов

Черновик для обсуждения. Сигнатуры записаны как объявления TypeScript — из них потом получится
`automaton.d.ts` для VS Code. В квадратных скобках — исследование, которое открывает возможность;
без пометки — доступно с самого начала. Все примеры проходят `tsc --strict`.

## Общие правила

- **Объекты и их методы.** Действие пишется у того, над чем действуют: `furnace.insert("coal", 5)`,
  `chest.extract("iron-plate")`, `assembler.setRecipe("iron-gear-wheel")`, `helper.refuel()`. Своё — у `me`:
  `me.move(…)`, `me.mine(…)`, `me.say(…)`, системы машины — `me.energy`, `me.tank`, `me.weapon`. Связь — `radio`.
  Делает действие всегда эта машина: ей нужна досягаемость, тратятся её энергия и время.
- **Мгновенные функции и действия.** Чтение состояния, зрение, сообщения, рисование выполняются сразу.
  Действия (`me.move`, `me.mine`, `chest.extract`, `furnace.insert`, `me.weapon.attack`, …) занимают игровое
  время: программа ждёт, пока действие закончится. Одновременно у машины идёт одно действие.
- **Бесконечные циклы — норма.** `while (true)` — обычный главный цикл программы. У машины есть квант
  инструкций на тик (зависит от модели); исчерпала — программа ставится на паузу и со следующего тика
  продолжается с того же места. Это не ошибка и никого не блокирует. `wait`, `radio.receive` и действия
  квант не тратят, поэтому ждать через них выгоднее, чем крутиться вхолостую. Что сколько стоит и когда
  выполняется строка — раздел [«Время программы»](#время-программы).
- **Руки — как у персонажа.** Брать, класть, чинить, строить можно только в радиусе досягаемости
  `me.reach` (как у персонажа — 10 клеток); добывать руду, рубить деревья и разбивать скалы — стоя рядом
  (`me.mineReach`, 2.7 клетки);
  подбирать с земли — вплотную. Дальше — `ActionError("out-of-reach")`: подъехать нужно самому через `me.move`.
- **Глаза — только рядом.** Машина видит в радиусе зрения `me.vision`. Неизменное — id, имя, тип,
  позиция здания — читается всегда. Текущее состояние зданий (содержимое, статус, рецепт) и других
  машин (позиция, состояние, здоровье) — только в поле зрения, иначе `ActionError("out-of-sight")`.
  Проверить заранее — `inSight`. О дальнем узнают из сообщений тех, кто видит (например, оркестратора).
- **Связь — без ограничения дальности.** Сообщения, общая доска, очереди задач и табло работают
  на любом расстоянии.
- **Частичный результат — не ошибка.** `extract`, `insert`, `me.mine` возвращают, сколько реально перенесено.
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

**2. Ожидание.** Действия (`me.move`, `me.mine`, `chest.extract`, `furnace.insert`, …), `wait`, `waitUntil`,
`radio.receive`, `radio.request` —
точки, где программа ждёт: квант на это не тратится, машина не исполняется, пока ожидание не кончится.

**3. Долг.** Тяжёлый вызов библиотеки выполняется целиком, даже если стоит больше оставшегося кванта
(например, `radio.publish` тысяче подписчиков: все письма уходят в этом тике). Перерасход становится долгом:
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
| `radio.publish` | 1 за каждого подписчика, которому ушло письмо |
| Действия, `wait`, `radio.receive`, `radio.request` | 0 (машина ждёт) |

**На всех машин** в тике есть общий бюджет (настройка карты, по умолчанию 20 000 инструкций). Он
раздаётся готовым к работе машинам по кругу. Если машин много и все считают, часть получит ход тиком
позже — машины «думают» медленнее, а игра не тормозит. Ждущие машины бюджет не тратят.

**Что из этого следует.** Между двумя соседними строками могут пройти тики, если между ними цикл или
тяжёлый вызов, — а мир за это время меняется: другие машины забирают предметы, здания работают.
Поэтому результат действия проверяют, а не предполагают: `extract` возвращает, сколько реально взято, а если
брать нечего — `ActionError("not-enough-items")`. Сообщения доходят на следующем тике после отправки.

Пример на Mk1 (квант 50):

```
const coal = chest.count("coal")                        // A
radio.publish("склад", coal)                            // B: 120 подписчиков
for (const id of helpers) radio.send(id, "иди", coal)   // C: 100 помощников
chest.extract("coal", 10)                               // D
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
| [Вывод](#вывод) | `print`, `console.log`, `me.say`, `chat`, `alert` | сразу |
| [Своя машина](#своя-машина-me) | `me`: груз, энергия, здоровье, параметры программы, память, подпись; `Machine`, `Robot` | сразу |
| [Движение](#движение) | `me.move`, `me.canReach`, `me.follow`, `me.goHome` | сразу |
| [Предметы](#предметы) | `me.mine` (руда, деревья, скалы), `me.pickup`, `me.drop`; `extract` / `insert` у зданий, `insert` у машины | сразу |
| [Здания](#здания) | классы зданий (`Furnace`, `Chest`, …), состояние (в поле зрения), `repair`, `setRecipe`, `me.build`, `deconstruct`, `rotate`; постройка по чертежу — `Ghost`, `ghost.build` | сразу / [Наладка] / [Строительство] |
| [Жидкости](#жидкости) | `me.tank.pump`, `fill` / `drain` у зданий | [Жидкости] |
| [Энергия](#энергия) | `me.energy` (`level`, `refuel`, `charge`), `robot.refuel` | сразу / Mk2 |
| [Зрение](#зрение) | `scan.robots`, `scan.buildings`, `scan.ghosts`, `scan.marked`, `scan.items`, `scan.trees`, `scan.rocks`, `scan.resources`, `scan.enemies`, `scan.water`; `Tree`, `Rock` | сразу, радиус растёт исследованиями |
| [Карта](#карта) | метки, зоны, `zone.find`, `map.tag` | сразу |
| [Связь](#связь) | `radio` (`send`, `publish`, `subscribe`, `receive`, `request`, `inbox`), `robot` | [Радиосвязь] |
| [Доска и задачи](#доска-и-задачи) | `board` (общая память), `tasks` (очереди заданий) | [Радиосвязь] |
| [Табло](#табло) | `display`: пиксельный холст — линии, фигуры, текст, иконки, таблицы | [Табло] |
| [Бой](#бой) | `me.weapon` (`attack`, `guard`, `patrol`, `reload`) | [Боевые автоматоны] |
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
type Target = Position | Building | Machine | Marker | Zone | Tree | Rock | Ghost;

type Value =
  | null | boolean | number | string
  | Building | Machine | Position
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
| Здание, машина | `Furnace(stone-furnace #12 @ 10.5, 5.5)` — класс здания и имя, `Robot(АМ-7 #7)` (`me` — тоже; отправленный сообщением `me` приходит как `Robot`) |
| Метка, зона, табло | `Marker(склад)`, `Zone(плавильня)`, `Display(штаб)` |
| Груз, сообщение, задача | `Inventory { coal: 7 }`, `Message(Robot(АМ-3 #3), "тема": данные)`, `Task(работа #4: данные)` |
| Энергия, бак, оружие | `Energy(0.5)`, `Tank(water 100/1000)`, `Weapon(gun, firearm-magazine × 2)` |
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

interface Me {
  /**
   * Облачко с текстом над машиной на `seconds` секунд (по умолчанию 3). Видят все игроки. Было say.
   * @en A speech bubble with text above the machine for `seconds` seconds (3 by default). All players see it. Was say.
   */
  say(text: string, seconds?: number): void;
}

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
me.say(`Везу ${me.cargo.count()} предметов`, 5);
if (me.energy.level < 0.1) alert(`${me.name}: кончается топливо`);
```

## Своя машина (`me`)

```ts
declare const me: Me;

type Model =
  | "worker-mk1" | "worker-mk2" | "worker-mk3"
  | "combat-mk1" | "combat-mk2"
  | "flyer-mk1" | "flyer-mk2";

/**
 * Общее у машин: своей (me) и другой (Robot). Проверка — x instanceof Machine.
 * @en What all machines share: your own (me) and another one (Robot). Check with x instanceof Machine.
 */
declare abstract class Machine {
  protected constructor();
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
  readonly energy: { readonly level: number };   // 0..1 — топливо или заряд. Было fuel @en 0..1 — fuel or charge. Was fuel
  distance(to: Target): number;
}

/**
 * Другая машина своей команды: robot(), scan.robots(), msg.from. Создать нельзя — только найти.
 * @en Another machine of your team: robot(), scan.robots(), msg.from. It can't be created, only found.
 */
declare class Robot extends Machine {
  private constructor();
  /**
   * Переложить предметы из своего груза в её груз — «из рук в руки» (в радиусе me.reach). Было give.
   * @en Move items from your cargo into its cargo, hand to hand (within me.reach). Was give.
   */
  insert(item: Item, count?: number): number;
  /**
   * Mk1: заправить её топливом из своего груза; без item — лучшим, что есть. Было refuel(item, to).
   * @en Mk1: refuel it with fuel from your cargo; without item — the best there is. Was refuel(item, to).
   */
  refuel(item?: Item): void;
  /**
   * Починить ремкомплектами из своего груза. Было repair(robot).
   * @en Repair it with repair packs from your cargo. Was repair(robot).
   */
  repair(): void;
}

type RobotState =
  | "idle" | "moving" | "mining" | "transferring" | "pumping" | "building" | "fighting"
  | "waiting" | "thinking" | "no-fuel" | "stuck" | "error";

interface Me extends Machine {
  name: string;                        // можно переименовать себя из программы @en a program can rename its own machine
  label: string;                       // постоянная подпись над машиной (в отличие от me.say) @en a permanent label above the machine (unlike me.say)
  readonly cargo: Inventory;
  readonly energy: Energy;             // уровень, заправка, зарядка @en level, refueling, charging
  readonly tank: Tank | null;          // бак — только у рабочих моделей @en the tank — only on worker models
  readonly weapon: Weapon | null;      // оружие — только у боевых моделей @en the weapon — only on combat models
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
interface Me {
  /**
   * Доехать до цели. К машине — только если она в поле зрения (иначе спроси у неё позицию сообщением).
   * ActionError("no-path"), если пути нет. Было move.
   * @en Drive to the target. To a machine — only if it is within sight (otherwise ask it for its position with a message). ActionError("no-path") if there is no path. Was move.
   */
  move(to: Target, opts?: { radius?: number; timeout?: number }): void;
  /**
   * Есть ли путь до цели (спрашивает поиск пути, занимает несколько тиков). Было canReach.
   * @en Whether there is a path to the target (asks the pathfinder, takes a few ticks). Was canReach.
   */
  canReach(to: Target): boolean;
  /**
   * Ехать следом за целью, пока `until` не вернёт true. false — цель потеряна из виду. Было follow.
   * @en Follow the target until `until` returns true. false — the target was lost from sight. Was follow.
   */
  follow(target: Machine | Building, until: () => boolean): boolean;
  /**
   * Вернуться в me.home. Было goHome.
   * @en Return to me.home. Was goHome.
   */
  goHome(): void;
}
```

```ts
// Доехать до метки «склад», а если пути нет — вернуться домой
const depot = marker("склад");
if (me.canReach(depot)) me.move(depot, { radius: 2 });
else me.goHome();
```

## Предметы

```ts
interface Me {
  /**
   * Добыть предмет из ближайшего источника в me.mineReach: клетки месторождения, а если её нет — дерева или скалы
   * ("wood" — рубить деревья). Без count — пока не заполнится груз. Возвращает, сколько добыто. Было mine.
   * @en Mine an item from the nearest source within me.mineReach: a resource patch tile, or if there is none — a tree or a rock ("wood" — chop trees). Without count — until the cargo is full. Returns how much was mined. Was mine.
   */
  mine(item: Item, count?: number): number;
  /**
   * Срубить это дерево или разбить эту скалу целиком (в me.mineReach). Что не влезло в груз — на земле рядом.
   * Возвращает, сколько предметов попало в груз.
   * @en Chop down this tree or break this rock entirely (within me.mineReach). Whatever does not fit in the cargo stays on the ground nearby. Returns how many items went into the cargo.
   */
  mine(target: Tree | Rock): number;
  /**
   * Подобрать предметы с земли вплотную. Без item — всё подряд. Было pickup.
   * @en Pick up items lying right next to the machine. Without item — everything. Was pickup.
   */
  pickup(item?: Item, count?: number): number;
  /**
   * Выбросить предметы на землю. Было drop.
   * @en Drop items on the ground. Was drop.
   */
  drop(item: Item, count?: number): number;
}
```

```ts
// Накопать 20 угля и сложить в ближайший сундук
me.mine("coal", 20);
const chest = scan.buildings({ kind: Chest })[0];
me.move(chest);
chest.insert("coal");
```

```ts
// Нарубить дров: к ближайшему дереву, срубить, и так, пока не наберётся 40
while (me.cargo.count("wood") < 40) {
  const tree = scan.trees()[0];
  if (tree === undefined) break;
  me.move(tree, { radius: 2 });
  me.mine(tree);
}
```

Положить в здание и взять из него — методы здания: `chest.insert("coal", 5)`, `furnace.extract("iron-plate")`
(какие у какого класса — [«Классы зданий»](#классы-зданий)); передать другой машине «из рук в руки» —
`helper.insert("coal", 5)`. Всё — в радиусе `me.reach`, около полсекунды на действие; результат — сколько
перенесено (частично — не ошибка).

## Здания

```ts
type BuildingStatus =
  | "working" | "no-input" | "output-full" | "no-fuel" | "no-power"
  | "no-recipe" | "disabled" | "idle";

interface Me {
  /**
   * [Строительство] Поставить здание из груза. Было build.
   * @en [Construction] Place a building from the cargo. Was build.
   */
  build(item: Item, at: Position, direction?: Direction): Building;
}
```

```ts
// Печь у метки «печь»: забрать готовые плиты, без топлива — подложить угля
me.move(marker("печь"), { radius: 2 });
const furnace = scan.buildings({ kind: Furnace })[0];
furnace.extract("iron-plate");
if (furnace.status === "no-fuel") furnace.insert("coal", 5);
```

- Всё — в радиусе `me.reach` (иначе `out-of-reach`), около полсекунды на действие.
- `setRecipe` (у `Assembler`): рецепт должен быть открыт командой и подходить зданию, иначе `invalid-target`.
- `me.build`: место занято — `target-full`, предмета нет в грузе — `not-enough-items`. Машины программой не ставятся.
- `deconstruct`: только здания своей команды; содержимое здания тоже уходит в груз, не влезает — `cargo-full`.
  Деревья, камни и руда — это добыча (`me.mine`), а не разборка.

### Постройка по чертежу

Чертёж, который игрок положил на землю, — это призраки зданий и плитки (бетон, засыпка). Машина видит их
(`scan.ghosts()`) и строит из своего груза, как `me.build`, но здание встаёт таким, как в чертеже: с поворотом,
рецептом, настройками и проводами.

```ts
/**
 * Призрак — здание или плитка по чертежу, ещё не построенные. Призраки машин программам не видны: машины ставит игрок.
 * @en A ghost — a building or a tile from a blueprint, not built yet. Ghosts of machines are not visible to programs: machines are placed by players.
 */
declare class Ghost {
  private constructor();
  readonly id: number;
  readonly valid: boolean;             // false — построен или снят @en false — built or removed
  readonly inSight: boolean;
  readonly name: string;               // что встанет: "stone-furnace", плитка "concrete" @en what it becomes: "stone-furnace", the "concrete" tile
  readonly item: Item;                 // чем строить: "stone-furnace", "concrete" @en what to build it with: "stone-furnace", "concrete"
  readonly position: Position;
  readonly direction: Direction;
  /**
   * Что чертёж просит доставить в это здание после постройки: модули.
   * @en What the blueprint asks to deliver to this building once built: modules.
   */
  requests(): ItemStack[];
  /**
   * [Строительство] Построить из груза, как me.build: здание встаёт таким, как в чертеже. Плитка — null.
   * @en [Construction] Build it from the cargo, like me.build: the building comes out as in the blueprint. A tile gives null.
   */
  build(): Building | null;
}
```

```ts
// Построить всё, что видно по чертежу, из того, что есть в грузе
for (const ghost of scan.ghosts()) {
  if (me.cargo.count(ghost.item) === 0) continue;
  me.move(ghost, { radius: 3 });
  ghost.build();
}
```

- `ghost.build()`: призрака уже нет — `invalid-target`; предмета нет в грузе — `not-enough-items`; место занято
  (дерево, камень, машина, персонаж) — `target-full`. Всё — в радиусе `me.reach`, около полсекунды на здание
  или клетку плитки.
- Строительные дроны игрока строят те же призраки — кто первый. Модули, которые просит чертёж, сами не встают:
  запрос остаётся у здания (`building.requests()`), его выполняет `installModule` — см. «Модули».
- Готовая программа — пример «Строитель»: берёт предметы на складе и строит призраки у метки.

Снос — тоже по пометкам: что игрок пометил планировщиком сноса, машина видит в `scan.marked()`.

```ts
// Разобрать всё, что помечено к сносу рядом: здания — в груз, деревья и скалы — добыча
for (const target of scan.marked()) {
  me.move(target, { radius: 2 });
  if (target instanceof Tree || target instanceof Rock) me.mine(target);
  else target.deconstruct();
}
```

### Классы зданий

У каждого вида зданий свой класс — с тем, что у него есть: у печи — вход, выход и топливо, у сундука — содержимое,
у резервуара — жидкость. Действие — метод здания: `furnace.insert("coal", 5)`, `chest.extract("iron-plate")`,
`boiler.fill()`. Делает его эта машина: здание должно быть в радиусе `me.reach`, тратятся её энергия и время.
Найти здания класса — `zone("…").find(Furnace)`, `scan.buildings({ kind: Chest })`; проверить, что пришло
сообщением, — `x instanceof Furnace`. Создать здание через `new` нельзя.

```ts
/**
 * Класс зданий для поиска: Furnace, Chest, … (zone.find(Furnace), scan.buildings({ kind: Chest })).
 * @en A building class to search by: Furnace, Chest, … (zone.find(Furnace), scan.buildings({ kind: Chest })).
 */
type BuildingKind<T extends Building> = { prototype: T };

/**
 * Любое здание. Здания без своих методов (столбы, стены, лампы, комбинаторы, рельсы…) — просто Building.
 * @en Any building. Buildings without methods of their own (poles, walls, lamps, combinators, rails…) are just Building.
 */
declare class Building {
  protected constructor();
  // Всегда: @en Always:
  readonly id: number;
  readonly valid: boolean;
  readonly name: string;               // "stone-furnace"
  readonly type: string;               // "furnace" — тип прототипа Factorio @en "furnace" — the Factorio prototype type
  readonly position: Position;
  /**
   * Видно ли сейчас. Поля и методы ниже — только если видно, иначе ActionError("out-of-sight").
   * @en Whether it is visible now. The fields and methods below work only while it is visible, otherwise ActionError("out-of-sight").
   */
  readonly inSight: boolean;
  // Только в поле зрения: @en Only within sight:
  readonly status: BuildingStatus;
  readonly health: number;             // 0..1
  /**
   * Починить ремкомплектами из груза. Было repair.
   * @en Repair with repair packs from the cargo. Was repair.
   */
  repair(): void;
  /**
   * [Строительство] Повернуть. Было rotate.
   * @en [Construction] Rotate. Was rotate.
   */
  rotate(reverse?: boolean): void;
  /**
   * [Строительство] Разобрать в груз. Было deconstruct.
   * @en [Construction] Deconstruct into the cargo. Was deconstruct.
   */
  deconstruct(): void;
}

/**
 * Сундук: деревянный, железный, стальной, сундук хранения.
 * @en A chest: wooden, iron, steel, storage chest.
 */
declare class Chest extends Building {
  private constructor();
  inventory(): Inventory;
  count(item?: Item): number;
  /**
   * Положить из груза. Возвращает, сколько положено. Было put.
   * @en Put from the cargo. Returns how many were put. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять в груз. Возвращает, сколько взято. Было take.
   * @en Take into the cargo. Returns how many were taken. Was take.
   */
  extract(item: Item, count?: number): number;
}

/**
 * Печь: каменная, стальная, электрическая. Рецепт печь выбирает сама — по руде.
 * @en A furnace: stone, steel, electric. The furnace picks the recipe itself, by the ore.
 */
declare class Furnace extends Building {
  private constructor();
  readonly recipe: string | null;
  readonly progress: number;           // прогресс текущей плавки, 0..1 @en progress of the current smelting, 0..1
  input(): Inventory;
  output(): Inventory;
  fuel(): Inventory | null;            // у электрической — null @en null for an electric one
  count(item?: Item): number;          // во всех слотах @en in all slots
  /**
   * Положить: руду — во вход, топливо — в топливо. Было put.
   * @en Put: ore into the input, fuel into the fuel slot. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять из выхода (или из входа, если там этот предмет). Было take.
   * @en Take from the output (or from the input, if the item is there). Was take.
   */
  extract(item: Item, count?: number): number;
  /**
   * Модули в слотах.
   * @en Modules in the slots.
   */
  modules(): ItemStack[];
  /**
   * Что просит доставить чертёж: модули, которых ещё нет в слотах.
   * @en What the blueprint asks to deliver: modules not in the slots yet.
   */
  requests(): ItemStack[];
  /**
   * Поставить модули из груза — сначала в слоты, которые просит чертёж (запрос вычёркивается). Возвращает, сколько поставлено.
   * @en Install modules from the cargo — first into the slots the blueprint asks for (the request is crossed out). Returns how many were installed.
   */
  installModule(item: Item, count?: number): number;
  /**
   * Снять модули в груз, без item — все. Возвращает, сколько снято.
   * @en Remove modules into the cargo, without item — all of them. Returns how many were removed.
   */
  removeModule(item?: Item, count?: number): number;
}

/**
 * Сборщик: сборочные автоматы, химзавод, нефтезавод, центрифуга.
 * @en An assembler: assembling machines, chemical plant, oil refinery, centrifuge.
 */
declare class Assembler extends Building {
  private constructor();
  readonly recipe: string | null;
  readonly progress: number;           // 0..1
  input(): Inventory;
  output(): Inventory;
  count(item?: Item): number;
  /**
   * Положить из груза. Возвращает, сколько положено. Было put.
   * @en Put from the cargo. Returns how many were put. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять в груз. Возвращает, сколько взято. Было take.
   * @en Take into the cargo. Returns how many were taken. Was take.
   */
  extract(item: Item, count?: number): number;
  /**
   * [Наладка] Сменить рецепт; содержимое возвращается в груз машины. Было setRecipe.
   * @en [Configuration] Change the recipe; the contents go back to the machine's cargo. Was setRecipe.
   */
  setRecipe(recipe: string): void;
  /**
   * Жидкость в здании (без name — всего).
   * @en Fluid in the building (without name — all of it).
   */
  fluid(name?: Fluid): number;
  /**
   * [Жидкости] Залить из бака машины. Без amount — всё, что влезет. Было fill.
   * @en [Fluids] Fill from the machine's tank. Without amount — as much as fits. Was fill.
   */
  fill(amount?: number): number;
  /**
   * [Жидкости] Слить в бак машины. Было drain.
   * @en [Fluids] Drain into the machine's tank. Was drain.
   */
  drain(fluid: Fluid, amount?: number): number;
  /**
   * Модули в слотах.
   * @en Modules in the slots.
   */
  modules(): ItemStack[];
  /**
   * Что просит доставить чертёж: модули, которых ещё нет в слотах.
   * @en What the blueprint asks to deliver: modules not in the slots yet.
   */
  requests(): ItemStack[];
  /**
   * Поставить модули из груза — сначала в слоты, которые просит чертёж (запрос вычёркивается). Возвращает, сколько поставлено.
   * @en Install modules from the cargo — first into the slots the blueprint asks for (the request is crossed out). Returns how many were installed.
   */
  installModule(item: Item, count?: number): number;
  /**
   * Снять модули в груз, без item — все. Возвращает, сколько снято.
   * @en Remove modules into the cargo, without item — all of them. Returns how many were removed.
   */
  removeModule(item?: Item, count?: number): number;
}

/**
 * Ракетная шахта.
 * @en A rocket silo.
 */
declare class RocketSilo extends Building {
  private constructor();
  readonly recipe: string | null;
  readonly progress: number;           // 0..1 — постройка ракеты @en 0..1 — building the rocket
  input(): Inventory;
  output(): Inventory;
  count(item?: Item): number;
  /**
   * Положить из груза. Возвращает, сколько положено. Было put.
   * @en Put from the cargo. Returns how many were put. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять в груз. Возвращает, сколько взято. Было take.
   * @en Take into the cargo. Returns how many were taken. Was take.
   */
  extract(item: Item, count?: number): number;
  /**
   * Модули в слотах.
   * @en Modules in the slots.
   */
  modules(): ItemStack[];
  /**
   * Что просит доставить чертёж: модули, которых ещё нет в слотах.
   * @en What the blueprint asks to deliver: modules not in the slots yet.
   */
  requests(): ItemStack[];
  /**
   * Поставить модули из груза — сначала в слоты, которые просит чертёж (запрос вычёркивается). Возвращает, сколько поставлено.
   * @en Install modules from the cargo — first into the slots the blueprint asks for (the request is crossed out). Returns how many were installed.
   */
  installModule(item: Item, count?: number): number;
  /**
   * Снять модули в груз, без item — все. Возвращает, сколько снято.
   * @en Remove modules into the cargo, without item — all of them. Returns how many were removed.
   */
  removeModule(item?: Item, count?: number): number;
}

/**
 * Лаборатория.
 * @en A lab.
 */
declare class Lab extends Building {
  private constructor();
  input(): Inventory;
  count(item?: Item): number;
  /**
   * Положить колбы. Было put.
   * @en Put science packs. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять в груз. Возвращает, сколько взято. Было take.
   * @en Take into the cargo. Returns how many were taken. Was take.
   */
  extract(item: Item, count?: number): number;
  /**
   * Модули в слотах.
   * @en Modules in the slots.
   */
  modules(): ItemStack[];
  /**
   * Что просит доставить чертёж: модули, которых ещё нет в слотах.
   * @en What the blueprint asks to deliver: modules not in the slots yet.
   */
  requests(): ItemStack[];
  /**
   * Поставить модули из груза — сначала в слоты, которые просит чертёж (запрос вычёркивается). Возвращает, сколько поставлено.
   * @en Install modules from the cargo — first into the slots the blueprint asks for (the request is crossed out). Returns how many were installed.
   */
  installModule(item: Item, count?: number): number;
  /**
   * Снять модули в груз, без item — все. Возвращает, сколько снято.
   * @en Remove modules into the cargo, without item — all of them. Returns how many were removed.
   */
  removeModule(item?: Item, count?: number): number;
}

/**
 * Маяк: только слоты модулей, их действие — на здания вокруг.
 * @en A beacon: only module slots, their effect goes to the buildings around it.
 */
declare class Beacon extends Building {
  private constructor();
  /**
   * Модули в слотах.
   * @en Modules in the slots.
   */
  modules(): ItemStack[];
  /**
   * Что просит доставить чертёж: модули, которых ещё нет в слотах.
   * @en What the blueprint asks to deliver: modules not in the slots yet.
   */
  requests(): ItemStack[];
  /**
   * Поставить модули из груза — сначала в слоты, которые просит чертёж (запрос вычёркивается). Возвращает, сколько поставлено.
   * @en Install modules from the cargo — first into the slots the blueprint asks for (the request is crossed out). Returns how many were installed.
   */
  installModule(item: Item, count?: number): number;
  /**
   * Снять модули в груз, без item — все. Возвращает, сколько снято.
   * @en Remove modules into the cargo, without item — all of them. Returns how many were removed.
   */
  removeModule(item?: Item, count?: number): number;
}

/**
 * Котёл и теплообменник.
 * @en A boiler and a heat exchanger.
 */
declare class Boiler extends Building {
  private constructor();
  fuel(): Inventory | null;            // у теплообменника — null @en null for a heat exchanger
  count(item?: Item): number;
  /**
   * Положить топливо. Было put.
   * @en Put fuel. Was put.
   */
  insert(item: Item, count?: number): number;
  fluid(name?: Fluid): number;
  /**
   * [Жидкости] Залить воду из бака. Было fill.
   * @en [Fluids] Fill with water from the tank. Was fill.
   */
  fill(amount?: number): number;
  /**
   * [Жидкости] Слить пар в бак. Было drain.
   * @en [Fluids] Drain steam into the tank. Was drain.
   */
  drain(fluid: Fluid, amount?: number): number;
}

/**
 * Паровой двигатель и паровая турбина.
 * @en A steam engine and a steam turbine.
 */
declare class Generator extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  /**
   * [Жидкости] Залить пар из бака. Было fill.
   * @en [Fluids] Fill with steam from the tank. Was fill.
   */
  fill(amount?: number): number;
  /**
   * [Жидкости] Слить в бак машины. Было drain.
   * @en [Fluids] Drain into the machine's tank. Was drain.
   */
  drain(fluid: Fluid, amount?: number): number;
}

/**
 * Ядерный реактор.
 * @en A nuclear reactor.
 */
declare class Reactor extends Building {
  private constructor();
  fuel(): Inventory;
  count(item?: Item): number;
  /**
   * Положить топливные стержни. Было put.
   * @en Put fuel cells. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять отработанные стержни. Было take.
   * @en Take used-up fuel cells. Was take.
   */
  extract(item: Item, count?: number): number;
}

/**
 * Резервуар.
 * @en A storage tank.
 */
declare class StorageTank extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  /**
   * [Жидкости] Залить из бака машины. Без amount — всё, что влезет. Было fill.
   * @en [Fluids] Fill from the machine's tank. Without amount — as much as fits. Was fill.
   */
  fill(amount?: number): number;
  /**
   * [Жидкости] Слить в бак машины. Было drain.
   * @en [Fluids] Drain into the machine's tank. Was drain.
   */
  drain(fluid: Fluid, amount?: number): number;
}

/**
 * Труба, подземная труба, помпа.
 * @en A pipe, an underground pipe, a pump.
 */
declare class Pipe extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  /**
   * [Жидкости] Залить из бака машины. Без amount — всё, что влезет. Было fill.
   * @en [Fluids] Fill from the machine's tank. Without amount — as much as fits. Was fill.
   */
  fill(amount?: number): number;
  /**
   * [Жидкости] Слить в бак машины. Было drain.
   * @en [Fluids] Drain into the machine's tank. Was drain.
   */
  drain(fluid: Fluid, amount?: number): number;
}

/**
 * Турель с патронами: пулемётная, артиллерийская.
 * @en A turret with ammo: gun turret, artillery turret.
 */
declare class Turret extends Building {
  private constructor();
  ammo(): Inventory;
  count(item?: Item): number;
  /**
   * Зарядить патронами или снарядами из груза. Было put.
   * @en Load with ammo or shells from the cargo. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять в груз. Возвращает, сколько взято. Было take.
   * @en Take into the cargo. Returns how many were taken. Was take.
   */
  extract(item: Item, count?: number): number;
}

/**
 * Огнемётная турель.
 * @en A flamethrower turret.
 */
declare class FlameTurret extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  /**
   * [Жидкости] Залить нефть или топливо из бака. Было fill.
   * @en [Fluids] Fill with oil or fuel from the tank. Was fill.
   */
  fill(amount?: number): number;
}

/**
 * Грузовой вагон.
 * @en A cargo wagon.
 */
declare class CargoWagon extends Building {
  private constructor();
  inventory(): Inventory;
  count(item?: Item): number;
  /**
   * Положить из груза. Возвращает, сколько положено. Было put.
   * @en Put from the cargo. Returns how many were put. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять в груз. Возвращает, сколько взято. Было take.
   * @en Take into the cargo. Returns how many were taken. Was take.
   */
  extract(item: Item, count?: number): number;
}

/**
 * Вагон-цистерна.
 * @en A fluid wagon.
 */
declare class FluidWagon extends Building {
  private constructor();
  fluid(name?: Fluid): number;
  /**
   * [Жидкости] Залить из бака машины. Без amount — всё, что влезет. Было fill.
   * @en [Fluids] Fill from the machine's tank. Without amount — as much as fits. Was fill.
   */
  fill(amount?: number): number;
  /**
   * [Жидкости] Слить в бак машины. Было drain.
   * @en [Fluids] Drain into the machine's tank. Was drain.
   */
  drain(fluid: Fluid, amount?: number): number;
}

/**
 * Локомотив.
 * @en A locomotive.
 */
declare class Locomotive extends Building {
  private constructor();
  fuel(): Inventory;
  count(item?: Item): number;
  /**
   * Положить топливо. Было put.
   * @en Put fuel. Was put.
   */
  insert(item: Item, count?: number): number;
}

/**
 * Машина игрока: автомобиль, танк, паук.
 * @en A player vehicle: car, tank, spidertron.
 */
declare class Vehicle extends Building {
  private constructor();
  inventory(): Inventory;              // багажник @en the trunk
  fuel(): Inventory | null;            // у паука — null @en null for a spidertron
  count(item?: Item): number;
  /**
   * Положить из груза. Возвращает, сколько положено. Было put.
   * @en Put from the cargo. Returns how many were put. Was put.
   */
  insert(item: Item, count?: number): number;
  /**
   * Взять в груз. Возвращает, сколько взято. Было take.
   * @en Take into the cargo. Returns how many were taken. Was take.
   */
  extract(item: Item, count?: number): number;
}

/**
 * Станция зарядки машин Mk2+.
 * @en A charging station for Mk2+ machines.
 */
declare class ChargingStation extends Building {
  private constructor();
}
```

```ts
// Обойти печи зоны «плавильня»: забрать плиты, подложить уголь
for (const furnace of zone("плавильня").find(Furnace)) {
  me.move(furnace);
  for (const stack of furnace.output().items()) furnace.extract(stack.name, stack.count);
  if (furnace.status === "no-fuel") furnace.insert("coal", 5);
}
```

### Модули

Слоты модулей есть у сборщиков, электрических печей, лабораторий, ракетной шахты и маяков (`Beacon`). Машина ставит
модули из груза (`installModule`) и снимает в груз (`removeModule`) — как `insert` и `extract`: в радиусе `me.reach`,
около полсекунды. Чертёж, в котором здания с модулями, просит их доставить: `requests()` у здания (и у призрака)
показывает, чего не хватает; модуль от `installModule` встаёт в тот слот, который просит чертёж, и запрос
вычёркивается — строительные дроны второй раз его не понесут.

```ts
// Довезти модули, которые просит чертёж, всем сборщикам зоны «схемы»
for (const assembler of zone("схемы").find(Assembler)) {
  me.move(assembler, { radius: 3 });
  for (const request of assembler.requests()) {
    if (me.cargo.count(request.name) > 0) assembler.installModule(request.name, request.count);
  }
}
```

- `installModule`: не модуль или у здания нет слотов (каменная печь) — `invalid-target`; модуля нет в грузе —
  `not-enough-items`; слоты заняты — поставлено меньше (`target-full` в причине, не ошибка).
- `removeModule`: груз полон — `cargo-full`.

## Жидкости

```ts
/**
 * [Жидкости] Бак рабочей машины (me.tank; у других моделей — null).
 * @en [Fluids] A worker machine's tank (me.tank; null on other models).
 */
interface Tank {
  readonly fluid: Fluid | null;        // null — бак пуст @en null — the tank is empty
  readonly amount: number;
  readonly capacity: number;           // Mk1 — 1000
  /**
   * Набрать в бак: воду — у берега (клетка воды в me.mineReach), нефть — стоя у месторождения.
   * Без amount — до полного бака. Возвращает, сколько набрано. Было pump.
   * @en Fill the tank: water at the shore (a water tile within me.mineReach), crude oil while standing at the patch. Without amount — until the tank is full. Returns how much was taken. Was pump.
   */
  pump(fluid: Fluid, amount?: number): number;
}
```

Залить из бака в здание и слить из здания в бак — методы здания: `boiler.fill()`, `tank.drain("water", 200)`
(у каких классов — [«Классы зданий»](#классы-зданий)); бак — у рабочих моделей, у других `me.tank === null`, а
`fill` / `drain` — `ActionError("no-tank")`.

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
  me.move(shore, { radius: 2 });
  me.tank!.pump("water");
  me.move(marker("котельная"), { radius: 2 });
  scan.buildings({ kind: StorageTank })[0].fill();
}
```

## Энергия

```ts
/**
 * Энергия своей машины (me.energy).
 * @en Your machine's energy (me.energy).
 */
interface Energy {
  readonly level: number;              // 0..1 — топливо или заряд. Было me.fuel @en 0..1 — fuel or charge. Was me.fuel
  /**
   * Mk1: переложить топливо из груза в топливный слот. Без item — лучшее, что есть. Было refuel.
   * @en Mk1: move fuel from the cargo into the fuel slot. Without item — the best available. Was refuel.
   */
  refuel(item?: Item): void;
  /**
   * Mk2+: доехать до станции (по умолчанию — ближайшей видимой) и зарядиться полностью. Было charge.
   * @en Mk2+: drive to a station (by default the nearest visible one) and charge fully. Was charge.
   */
  charge(station?: ChargingStation): void;
}
```

```ts
// Mk1 подкладывает уголь из груза, Mk2 и выше — едут на зарядную станцию
if (me.energy.level < 0.2) {
  if (me.model === "worker-mk1") me.energy.refuel("coal");
  else me.energy.charge();
}
```

```ts
// Заправщик: объезжает машины Mk1 рядом и подливает уголь тем, у кого меньше трети бака
for (const robot of scan.robots()) {
  if (robot.model === "worker-mk1" && robot.energy.level < 0.3 && me.cargo.count("coal") > 0) {
    me.move(robot);
    robot.refuel("coal");
  }
}
```

Mk1 жжёт топливо из топливного слота; Mk2 и Mk3 работают от аккумулятора (10 и 25 МДж) и топливо
не принимают (`refuel` — `invalid-target`). Станция заряжает на 1 МВт, пока у неё есть энергия из сети;
с пустым аккумулятором машина до станции не доедет — её надо принести. `me.energy.level` — топливо или заряд
от 0 до 1; у другой машины — `robot.energy.level`.

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
   * Здания рядом. С kind — только этого класса и сразу с его методами: scan.buildings({ kind: Furnace }) → Furnace[].
   * @en Buildings nearby. With kind — only of that class and right away with its methods: scan.buildings({ kind: Furnace }) → Furnace[].
   */
  buildings<T extends Building = Building>(filter?: { kind?: BuildingKind<T>; name?: string | string[]; radius?: number }): T[];
  /**
   * Призраки зданий своей команды рядом — чертёж, положенный игроком. С name — только этих зданий.
   * @en Ghosts of your team's buildings nearby — a blueprint placed by a player. With name — only of those buildings.
   */
  ghosts(filter?: { name?: string | string[]; radius?: number }): Ghost[];
  /**
   * Помеченное к сносу рядом (планировщиком сноса): здания своей команды — разобрать deconstruct(), деревья и скалы — me.mine.
   * @en Things marked for deconstruction nearby (with a deconstruction planner): your team's buildings — deconstruct() them, trees and rocks — me.mine.
   */
  marked(radius?: number): (Building | Tree | Rock)[];
  /**
   * Предметы, лежащие на земле.
   * @en Items lying on the ground.
   */
  items(radius?: number): GroundItem[];
  /**
   * Деревья рядом. Рубит me.mine(tree) или me.mine("wood").
   * @en Trees nearby. Chop them with me.mine(tree) or me.mine("wood").
   */
  trees(radius?: number): Tree[];
  /**
   * Скалы рядом. Разбивает me.mine(rock): камень, у больших — и уголь.
   * @en Rocks nearby. Break them with me.mine(rock): stone, big ones also give coal.
   */
  rocks(radius?: number): Rock[];
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

/**
 * Дерево. Номера у дерева нет: два взгляда дают разные объекты, сравнивать — по месту.
 * @en A tree. A tree has no number: two scans give different objects, compare by position.
 */
declare class Tree {
  private constructor();
  readonly valid: boolean;             // false — срублено @en false — chopped down
  readonly inSight: boolean;
  readonly name: string;               // "tree-01", "dead-dry-hairy-tree", …
  readonly position: Position;
  readonly products: Item[];           // что даёт: ["wood"] @en what it gives: ["wood"]
}

/**
 * Скала. Номера у скалы нет: два взгляда дают разные объекты, сравнивать — по месту.
 * @en A rock. A rock has no number: two scans give different objects, compare by position.
 */
declare class Rock {
  private constructor();
  readonly valid: boolean;             // false — разбита @en false — broken
  readonly inSight: boolean;
  readonly name: string;               // "big-rock", "huge-rock", …
  readonly position: Position;
  readonly products: Item[];           // что даёт: ["stone"], ["stone", "coal"] @en what it gives: ["stone"], ["stone", "coal"]
}
interface ResourcePatch { item: Item; amount: number; tiles: number; center: Position; nearest: Position }

/**
 * Враг: кусака, плевака, гнездо, червь.
 * @en An enemy: biter, spitter, nest, worm.
 */
declare class Enemy {
  private constructor();
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
  me.goHome();
}
```

## Карта

Метки и зоны ставят игроки (метка — сущность с именем, зона — прямоугольник, выделенный
инструментом «Программатор»). Зоны «известны» всей команде, поэтому `zone.find` работает на любом
расстоянии — но возвращает здания, у которых без поля зрения доступно только неизменное.

```ts
declare function marker(name: string): Marker;     // ActionError("invalid-target"), если метки нет @en ActionError("invalid-target") if there is no such marker
declare function zone(name: string): Zone;

/**
 * Метка на карте (ставит игрок).
 * @en A marker on the map (placed by a player).
 */
declare class Marker {
  private constructor();
  readonly name: string;
  readonly position: Position;
}

/**
 * Зона — прямоугольник, выделенный «Программатором».
 * @en A zone — a rectangle selected with the "Programmer".
 */
declare class Zone {
  private constructor();
  readonly name: string;
  readonly area: Area;
  readonly center: Position;
  contains(p: Position): boolean;
  /**
   * Здания класса в зоне (и, если задано, с этим именем): zone("плавильня").find(Furnace) → Furnace[].
   * @en Buildings of the class in the zone (and with this name, if given): zone("smelter").find(Furnace) → Furnace[].
   */
  find<T extends Building>(kind: BuildingKind<T>, name?: string | string[]): T[];
  /**
   * Здания в зоне с этим именем ("stone-furnace") или все.
   * @en Buildings in the zone with this name ("stone-furnace"), or all of them.
   */
  find(name?: string | string[]): Building[];
}

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
for (const furnace of zone("плавильня").find(Furnace)) print(furnace.status);
const patches = scan.resources();
if (patches.length > 0) map.tag(patches[0].center, `${patches[0].item}: ${patches[0].amount}`, patches[0].item);
```

## Связь

Все `[Радиосвязь]`. Дальность не ограничена. Сообщение приходит на следующем тике.
Входящий ящик — 64 сообщения; если переполнен, самые старые выбрасываются. Данные копируются при
отправке (у каждого получателя — своя копия), до 2 000 единиц памяти; функции и экземпляры классов
передать нельзя (`not-serializable`). Перезапуск программы очищает ящик и её подписки (подписки других
машин на неё остаются). `radio.send` машине, которой нет, — `invalid-target`; `reply` на обычное сообщение —
сообщение с той же темой. Адрес — машина, её id или имя; себя (`me`) — тоже можно.

**Рассылки всем нет.** Машина публикует обновления (`radio.publish`), а получают их только машины, которые
подписались именно на неё (`radio.subscribe(id)` — на все её темы, `radio.subscribe(id, "тема")` — на одну). Цена
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
   * Ответить отправителю (для radio.request).
   * @en Reply to the sender (for radio.request).
   */
  reply(data: Value): void;
}

/**
 * Ссылка на машину по id или имени (для radio.send, сравнения, me.move — если видна).
 * @en A reference to a machine by id or name (for radio.send, comparison, me.move — if it is visible).
 */
declare function robot(idOrName: number | string): Robot | null;

/**
 * [Радиосвязь] Сообщения между машинами — на любом расстоянии. Было send, receive, … и inbox.
 * @en [Radio] Messages between machines — at any distance. Was send, receive, … and inbox.
 */
declare const radio: {
  /**
   * Сообщение конкретной машине: по ссылке, id или имени.
   * @en A message to a specific machine: by reference, id or name.
   */
  send(to: Machine | number | string, topic: string, data?: Value): void;
  /**
   * Отправить и дождаться ответа. По таймауту — ActionError("timeout").
   * @en Send and wait for the reply. On timeout — ActionError("timeout").
   */
  request<T extends Value = Value>(to: Machine | number | string, topic: string, data?: Value, timeout?: number): T;
  /**
   * Ждать сообщение (необязательно — только по теме). По таймауту (секунды) — null.
   * @en Wait for a message (optionally only on a topic). On timeout (seconds) — null.
   */
  receive<T extends Value = Value>(topic?: string, timeout?: number): Message<T> | null;
  /**
   * Взять сообщение, если оно уже есть, не ожидая.
   * @en Take a message if one is already there, without waiting.
   */
  tryReceive<T extends Value = Value>(topic?: string): Message<T> | null;
  /**
   * Опубликовать обновление: получат машины, подписанные на эту (на все её темы или на эту тему).
   * @en Publish an update: machines subscribed to this one receive it (to all its topics or to this topic).
   */
  publish(topic: string, data?: Value): void;
  /**
   * Подписаться на публикации машины (по ссылке, id или имени): на все её темы или на одну.
   * @en Subscribe to a machine's publications (by reference, id or name): to all its topics or to one.
   */
  subscribe(robot: Machine | number | string, topic?: string): void;
  /**
   * Отписаться от машины: от темы или (без темы) совсем.
   * @en Unsubscribe from a machine: from a topic or (without a topic) entirely.
   */
  unsubscribe(robot: Machine | number | string, topic?: string): void;
  readonly inbox: { readonly count: number; readonly dropped: number };
};
```

```ts
// Машина далеко от склада спрашивает того, кто склад видит
const coal = radio.request<number>("кладовщик", "сколько", "coal", 10);
print(`На складе ${coal} угля`);

// «Кладовщик» стоит у сундука и отвечает
const chest = scan.buildings({ kind: Chest, name: "steel-chest" })[0];
while (true) {
  const msg = radio.receive<Item>("сколько");
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
  me.move(marker(task.data.to), { radius: 2 });
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
const chest = zone("склад").find(Chest, "wooden-chest")[0];
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
  readonly item: Item | null;            // поставленное оружие игрока; null — встроенное у модели @en the equipped player weapon; null — the model's built-in one
  readonly ammo: ItemStack | null;       // заряжено @en loaded
  readonly range: number;                // дальность, клеток @en range, in tiles
  /**
   * [Снаряжение] Поставить оружие игрока из груза: пистолет, пистолет-пулемёт, дробовик, боевой дробовик,
   * ракетомёт. Прежнее оружие и патроны, которые к новому не подходят, — в груз. Около секунды.
   * @en [Gear] Equip a player weapon from the cargo: pistol, submachine gun, shotgun, combat shotgun, rocket launcher. The previous weapon and ammo that does not fit the new one go to the cargo. About a second.
   */
  equip(weapon: Item): void;
  /**
   * [Снаряжение] Снять оружие в груз — вернётся встроенное у модели.
   * @en [Gear] Remove the weapon into the cargo — the model's built-in weapon comes back.
   */
  unequip(): void;
  /**
   * Зарядить патронами из груза. Без ammo — лучшими, что есть. Было reload.
   * @en Load ammo from the cargo. Without ammo — the best available. Was reload.
   */
  reload(ammo?: Item): void;
  /**
   * Подъехать на дальность выстрела и атаковать, пока цель не уничтожена, не пропала из виду
   * или не кончились патроны. true — цель уничтожена. Было attack.
   * @en Drive within firing range and attack until the target is destroyed, lost from sight or the ammo runs out. true — the target was destroyed. Was attack.
   */
  attack(target: Enemy | Building): boolean;
  /**
   * Стоять у точки и отбиваться от всех врагов в радиусе, пока until() не вернёт true. Было guard.
   * @en Stand at the point and fight off all enemies within the radius until until() returns true. Was guard.
   */
  guard(at: Target, opts?: { radius?: number; until?: () => boolean }): void;
  /**
   * Объезжать точки по кругу, атакуя встреченных врагов, пока until() не вернёт true. Было patrol.
   * @en Patrol the points in a loop, attacking enemies on the way, until until() returns true. Was patrol.
   */
  patrol(points: Target[], until?: () => boolean): void;
}
```

```ts
// Охрана: зарядить оружие и стоять у поста, пока не наступит ночь
const weapon = me.weapon!;
weapon.reload();
weapon.guard(marker("пост"), { radius: 15, until: () => time.isNight() });
```

- Боевой Mk1 — пулемёт (магазины: `firearm-magazine` 5 урона за выстрел, `piercing-rounds-magazine` 8,
  `uranium-rounds-magazine` 24), дальность 15, 350 здоровья; Mk2 — ракетомёт (`rocket` 200, `explosive-rocket` 300),
  дальность 24, 700 здоровья. Исследования урона игры действуют. Выстрел тратит один заряд из оружейного
  слота; без патронов машина стреляет вхолостую, а `attack` не начинается (`no-ammo`).
- `[Снаряжение автоматонов]` — сменное оружие (`equip`): дальность и темп — как у оружия игрока (пистолет 15 клеток,
  пистолет-пулемёт 18 и выстрел раз в 6 тиков, дробовики 15, ракетомёт 36), патроны — к нему: магазины, дробь
  (`shotgun-shell` — 12 дробинок по 8 урона, `piercing-shotgun-shell` — 16; все дробинки — в цель), ракеты.
  Поставить и снять можно и в окне машины. Подобрали машину — оружие вернётся предметом.
- `me.weapon.ammo.count` — сколько магазинов в слоте (в каждом 10 зарядов).
- `attack` — `false`, если цель ушла из виду или кончились патроны; `guard` по умолчанию охраняет радиус
  «дальность + 5», `patrol` и `guard` проверяют `until` дважды в секунду.
- У рабочих и летающих моделей оружия нет: `me.weapon === null`. Программа для боевой машины проверяет это
  в начале (`if (me.weapon === null) exit()`) или пишет `me.weapon!`.

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
me.move(tank, { radius: 2 });
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
  me.goHome();
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
  | "out-of-reach"       // цель дальше досягаемости — сначала me.move @en the target is out of reach — me.move first
  | "out-of-sight"       // состояние цели не видно — подъехать или спросить того, кто видит @en the target's state is not visible — drive closer or ask someone who sees it
  | "invalid-target"     // цель уничтожена, не существует или не годится @en the target is destroyed, does not exist or does not fit
  | "no-fuel"            // кончилась энергия @en out of energy
  | "no-ammo"            // кончились патроны @en out of ammo
  | "no-tank"            // fill / drain / pump у машины без бака @en fill / drain / pump on a machine without a tank
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
  scan.buildings({ kind: Chest })[0].insert("coal");
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
| — (старт) | вывод, `me`, движение, предметы, классы и состояние зданий, `repair`, `refuel`, зрение (10 клеток), карта, время и мир |
| Радиосвязь | `radio`, `robot`, доска, задачи |
| Табло | сущность «Табло», `display` |
| Наладка | `setRecipe` у сборщика |
| Жидкости | `me.tank`, `pump`, `fill` / `drain` у зданий |
| Строительство | `me.build`, `deconstruct`, `rotate` |
| Цепи | `signals` |
| Сенсоры 1–3 | радиус зрения 16 / 24 / 32 клетки, `scan.enemies` (со 2-го уровня) |
| Автоматон Mk2 / Mk3 | новые рабочие модели, `me.energy.charge`, зарядная станция |
| Боевые автоматоны 1–2 | боевые модели, `me.weapon`: `attack`, `guard`, `patrol`, `reload` |
| Снаряжение автоматонов | слот оружия, `me.weapon.equip`, `unequip` |
| Летающие автоматоны 1–2 | летающие модели |
| Скорость, груз, добыча, процессор, память, баки 1–3 | +15% скорости, +50% слотов груза, +25% скорости добычи, +50% инструкций за тик, +50% памяти, +50% бака — за уровень |

Без нужного исследования функция или метод бросает `ActionError("not-researched")`; `me.tank` без «Жидкостей» — `null`.

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
type Order = { furnace: Furnace; ore: Item };
type Done = { furnaceId: number };

interface WorkerInfo { robot: Robot; name: string; status: string; busy: boolean }

const screen = display("штаб");
const workers = new Map<number, WorkerInfo>();
const assigned = new Set<number>();            // печи, на которые уже выдано задание

me.move(zone("плавильня"));
// Рабочие находят оркестратора по доске (рассылки всем нет).
board.set("оркестратор", me.id);

function handleMail(): void {
  for (let m = radio.tryReceive<string>("регистрация"); m !== null; m = radio.tryReceive<string>("регистрация")) {
    workers.set(m.from.id, { robot: m.from, name: m.data, status: "свободен", busy: false });
    m.reply("ok");
  }
  for (let m = radio.tryReceive<Done>("готово"); m !== null; m = radio.tryReceive<Done>("готово")) {
    assigned.delete(m.data.furnaceId);
    const w = workers.get(m.from.id);
    if (w !== undefined) {
      w.busy = false;
      w.status = "свободен";
    }
  }
}

function assignWork(): void {
  const hungry = scan.buildings({ kind: Furnace })
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
    radio.send(w.robot, "задание", order);
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
type Order = { furnace: Furnace; ore: Item };

function findBoss(): number {
  const near = scan.robots().find(r => r.program === "Оркестратор");
  if (near !== undefined) return near.id;
  // Далеко — по доске: оркестратор записал туда свой id.
  waitUntil(() => board.get<number>("оркестратор") !== null, { every: 5 });
  return board.get<number>("оркестратор")!;
}

const { field } = me.args<{ field: string }>();
const boss = findBoss();
radio.request(boss, "регистрация", me.name, 30);

while (true) {
  const msg = radio.receive<Order>("задание");
  if (msg === null) continue;

  const { furnace, ore } = msg.data;
  try {
    me.move(zone(field));
    me.mine(ore, 50);
    me.move(furnace);
    furnace.insert(ore);
  } catch (e) {
    me.say(`Не вышло: ${e instanceof ActionError ? e.code : "?"}`);
  } finally {
    radio.send(boss, "готово", { furnaceId: furnace.id });
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

for (let turn = 0; me.energy.level > 0.3; turn++) {
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
    me.move(pos);
  } catch {
    // препятствие или вода — просто следующий виток
  }
  if (turn % 2 === 1) step += 10;
}

me.goHome();
```

## Пример: патруль

```ts
// Программа «Патруль»: объезжает посты; кончаются патроны — едет в арсенал,
// сильно повреждён — зовёт ремонтника и ждёт дома.
const route = [marker("пост-1"), marker("пост-2"), marker("пост-3")];
const arsenal = zone("арсенал").find(Chest, "steel-chest")[0];
const weapon = me.weapon;
if (weapon === null) exit();                // программа для боевой машины
const ammoLeft = () => weapon.ammo?.count ?? 0;

while (true) {
  if (ammoLeft() < 20) {
    me.move(arsenal);
    arsenal.extract("firearm-magazine", 50);
    weapon.reload();
  }

  weapon.patrol(route, () => ammoLeft() < 20 || me.health < 0.4);

  if (me.health < 0.4) {
    radio.publish("нужен-ремонт", me.id);   // получат ремонтники, подписанные на эту машину
    me.goHome();
    waitUntil(() => me.health > 0.9, { every: 2 });
  }
}
```

## Решения по умолчанию — поправь, если не так

1. **Табло рисуется с любого расстояния**: считаю это связью, а не работой руками.
2. **`valid` у далёких зданий и машин читается всегда**: иначе программы обрастают проверками.
   Остальное состояние — только в поле зрения.
3. **`zone.find` работает на любом расстоянии**, но отдаёт только неизменное (позиции, имена);
   состояние — в поле зрения или через сообщения.
4. **Сигналы цепей** читаются и пишутся только у метки, как работа руками.
