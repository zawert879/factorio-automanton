# Вариант 2. Как Rust

- Почти настоящий Rust: `trait`, `impl`, `Option` / `Some` / `None`, `match`, `|x|` лямбды, точки с запятой.
- Без borrow checker и lifetimes, но `&self`, `.iter()`, `Vec<...>` и `fn main()` остаются.
- Ближе всего к реальному языку: можно учиться по докам Rust, но больше «шума» при наборе в игре.

```rust
// Автоматон-снабженец: следит за своим топливом, копает руду и кормит печи.

trait Job {
    fn ready(&self) -> bool;
    fn run(&self);
}

// Функция высшего порядка: возвращает замыкание-фильтр
fn low_on(item: Item, below: i32) -> impl Fn(&Entity) -> bool {
    move |e| e.count(item) < below
}

struct Smelting {
    ore: Item,
    mine_at: Zone,
    furnaces: Vec<Entity>,
}

impl Job for Smelting {
    fn ready(&self) -> bool {
        self.furnaces.iter().any(low_on(self.ore, 10))
    }

    fn run(&self) {
        move_to(self.mine_at);
        mine(self.ore, 50);

        let mut hungry: Vec<_> = self.furnaces
            .iter()
            .filter(low_on(self.ore, 10))
            .collect();
        hungry.sort_by_key(|f| me.distance(f));

        for f in hungry {
            move_to(f);
            put(f, self.ore, 20);
        }
    }
}

struct Refuel {
    depot: Entity,
    min: f32,
}

impl Job for Refuel {
    fn ready(&self) -> bool {
        me.fuel() < self.min
    }

    fn run(&self) {
        move_to(self.depot);
        take(self.depot, "coal", 10);
        me.refuel();
    }
}

enum State {
    Working(dyn Job),
    Idle(i32), // сколько циклов подряд без работы
}

fn main() {
    let jobs: Vec<dyn Job> = vec![
        Refuel { depot: marker("coal-depot"), min: 0.2 },
        Smelting {
            ore: "iron-ore",
            mine_at: zone("north-iron"),
            furnaces: find("stone-furnace", zone("smelter")),
        },
    ];

    let mut idle = 0;

    loop {
        let state = match jobs.iter().find(|j| j.ready()) {
            Some(job) => State::Working(job),
            None => State::Idle(idle + 1),
        };

        match state {
            State::Working(job) => {
                idle = 0;
                job.run();
            }
            State::Idle(n) if n > 10 => say(format!("Нечего делать уже {n} циклов")),
            State::Idle(n) => {
                idle = n;
                wait(5.0);
            }
        }
    }
}
```
