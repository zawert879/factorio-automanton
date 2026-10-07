# Вариант 4. Как Go

- `type ... struct`, методы с получателем `func (s Smelting) ...`.
- Интерфейсы реализуются неявно: есть нужные методы — значит реализует.
- Два возвращаемых значения `(значение, ok)` вместо `Option` / `null`.
- Минимум конструкций, но лямбды многословные (`func(e Entity) bool { ... }`), нет `enum` и `match`.

```go
// Автоматон-снабженец: следит за своим топливом, копает руду и кормит печи.

type Job interface {
    Ready() bool
    Run()
}

// Функция высшего порядка: возвращает замыкание-фильтр
func LowOn(item Item, below int) func(Entity) bool {
    return func(e Entity) bool {
        return e.Count(item) < below
    }
}

type Smelting struct {
    Ore      Item
    MineAt   Zone
    Furnaces []Entity
}

func (s Smelting) Ready() bool {
    return Any(s.Furnaces, LowOn(s.Ore, 10))
}

func (s Smelting) Run() {
    MoveTo(s.MineAt)
    Mine(s.Ore, 50)

    hungry := Filter(s.Furnaces, LowOn(s.Ore, 10))
    SortBy(hungry, func(f Entity) float {
        return Me.Distance(f)
    })
    for _, f := range hungry {
        MoveTo(f)
        Put(f, s.Ore, 20)
    }
}

type Refuel struct {
    Depot Entity
    Min   float
}

func (r Refuel) Ready() bool {
    return Me.Fuel() < r.Min
}

func (r Refuel) Run() {
    MoveTo(r.Depot)
    Take(r.Depot, "coal", 10)
    Me.Refuel()
}

func FindReady(jobs []Job) (Job, bool) {
    for _, j := range jobs {
        if j.Ready() {
            return j, true
        }
    }
    return nil, false
}

func main() {
    jobs := []Job{
        Refuel{Depot: Marker("coal-depot"), Min: 0.2},
        Smelting{
            Ore:      "iron-ore",
            MineAt:   Zone("north-iron"),
            Furnaces: Find("stone-furnace", Zone("smelter")),
        },
    }

    idle := 0 // сколько циклов подряд без работы

    for {
        if job, ok := FindReady(jobs); ok {
            idle = 0
            job.Run()
            continue
        }

        idle++
        if idle > 10 {
            Say(fmt.Sprintf("Нечего делать уже %d циклов", idle))
        } else {
            Wait(5)
        }
    }
}
```
