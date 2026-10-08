# Вариант 3. Как TypeScript

- Классы с наследованием: `abstract class`, `extends`, `super`, `this`, `new`.
- Стрелочные функции `x => x * 2`, методы массивов `filter` / `sort` / `find`.
- `null` вместо `Option`, union-типы (`Job | null`).
- Самый привычный синтаксис, если писал на JS/TS.

```ts
// Автоматон-снабженец: следит за своим топливом, копает руду и кормит печи.

abstract class Job {
  constructor(readonly name: string) {}

  abstract ready(): boolean;
  abstract run(): void;

  toString(): string {
    return `Job(${this.name})`;
  }
}

// Функция высшего порядка: возвращает замыкание-фильтр
const lowOn = (item: Item, below: number) =>
  (e: Entity) => e.count(item) < below;

class Smelting extends Job {
  constructor(
    readonly ore: Item,
    readonly mineAt: Zone,
    readonly furnaces: Entity[],
  ) {
    super("smelting");
  }

  ready(): boolean {
    return this.furnaces.some(lowOn(this.ore, 10));
  }

  run(): void {
    move(this.mineAt);
    mine(this.ore, 50);

    this.furnaces
      .filter(lowOn(this.ore, 10))
      .sort((a, b) => me.distance(a) - me.distance(b))
      .forEach(f => {
        move(f);
        put(f, this.ore, 20);
      });
  }
}

class Refuel extends Job {
  constructor(readonly depot: Entity, readonly min: number) {
    super("refuel");
  }

  ready(): boolean {
    return me.fuel < this.min;
  }

  run(): void {
    move(this.depot);
    take(this.depot, "coal", 10);
    refuel();
  }
}

type State =
  | { kind: "working"; job: Job }
  | { kind: "idle"; cycles: number }; // сколько циклов подряд без работы

const jobs: Job[] = [
  new Refuel(find("steel-chest", zone("coal-depot"))[0], 0.2),
  new Smelting(
    "iron-ore",
    zone("north-iron"),
    find("stone-furnace", zone("smelter")),
  ),
];

let idle = 0;

while (true) {
  const job = jobs.find(j => j.ready());
  const state: State = job
    ? { kind: "working", job }
    : { kind: "idle", cycles: idle + 1 };

  switch (state.kind) {
    case "working":
      idle = 0;
      state.job.run();
      break;
    case "idle":
      idle = state.cycles;
      if (idle > 10) say(`Нечего делать уже ${idle} циклов`);
      else wait(5);
      break;
  }
}
```
