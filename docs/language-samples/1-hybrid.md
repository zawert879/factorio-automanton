# Вариант 1. Гибрид (рекомендую)

- Структура как в Rust: `struct` + `impl`, `match`, всё — выражение (последняя строка блока = результат).
- Лямбды как в TS: `x => x * 2`.
- Без точек с запятой, без `&self`, владения и lifetimes.
- `T?` — «может не быть» (вместо `Option<T>`), `if let` для распаковки.
- Игровой сахар: `5s` (секунды).

```rust
// Автоматон-снабженец: следит за своим топливом, копает руду и кормит печи.

interface Job {
  fn ready(self) -> bool
  fn run(self)
}

// Функция высшего порядка: возвращает замыкание-фильтр
fn low_on(item: Item, below: int) -> (Entity) -> bool {
  e => e.count(item) < below
}

struct Smelting {
  ore: Item
  mine_at: Zone
  furnaces: [Entity]
}

impl Job for Smelting {
  fn ready(self) -> bool {
    self.furnaces.any(low_on(self.ore, 10))
  }

  fn run(self) {
    move(self.mine_at)
    mine(self.ore, 50)

    self.furnaces
      .filter(low_on(self.ore, 10))
      .sort_by(f => me.distance(f))
      .each(f => {
        move(f)
        put(f, self.ore, 20)
      })
  }
}

struct Refuel {
  depot: Entity
  min: float
}

impl Job for Refuel {
  fn ready(self) -> bool { me.fuel < self.min }

  fn run(self) {
    move(self.depot)
    take(self.depot, "coal", 10)
    me.refuel()
  }
}

enum State {
  Working(Job)
  Idle(int)        // сколько циклов подряд без работы
}

let jobs: [Job] = [
  Refuel { depot: marker("coal-depot"), min: 0.2 },
  Smelting {
    ore: "iron-ore",
    mine_at: zone("north-iron"),
    furnaces: find("stone-furnace", zone("smelter")),
  },
]

let mut idle = 0

loop {
  let state = if let job = jobs.find(j => j.ready()) {
    State.Working(job)
  } else {
    State.Idle(idle + 1)
  }

  match state {
    Working(job) => { idle = 0; job.run() }
    Idle(n) if n > 10 => say("Нечего делать уже {n} циклов")
    Idle(n) => { idle = n; wait(5s) }
  }
}
```
