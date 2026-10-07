# Вариант 5. Как C#

- Классы и интерфейсы (`class Smelting : IJob`), наследование классов тоже есть (`class A : B`, `base`, `override`).
- Свойства (`{ get; init; }`, `=>`), первичные конструкторы `class Refuel(Entity depot, float min)`.
- LINQ-цепочки: `Where` / `OrderBy` / `Any` / `FirstOrDefault`, лямбды `x => x * 2`.
- `record` + `switch` с сопоставлением по образцу (`case Idle { Cycles: > 10 }`), nullable-типы `IJob?`.
- Без `async`/`await`: `MoveTo`, `Mine` и т.п. просто ждут завершения действия.
- Порядок объявлений не важен (в настоящем C# код верхнего уровня обязан идти первым).

```csharp
// Автоматон-снабженец: следит за своим топливом, копает руду и кормит печи.

interface IJob
{
    bool Ready { get; }
    void Run();
}

// Функция высшего порядка: возвращает замыкание-фильтр
static Func<Entity, bool> LowOn(Item item, int below) =>
    e => e.Count(item) < below;

class Smelting : IJob
{
    public Item Ore { get; init; }
    public Zone MineAt { get; init; }
    public List<Entity> Furnaces { get; init; }

    public bool Ready => Furnaces.Any(LowOn(Ore, 10));

    public void Run()
    {
        MoveTo(MineAt);
        Mine(Ore, 50);

        var hungry = Furnaces
            .Where(LowOn(Ore, 10))
            .OrderBy(f => Me.Distance(f));

        foreach (var f in hungry)
        {
            MoveTo(f);
            Put(f, Ore, 20);
        }
    }
}

class Refuel(Entity depot, float min) : IJob
{
    public bool Ready => Me.Fuel < min;

    public void Run()
    {
        MoveTo(depot);
        Take(depot, "coal", 10);
        Me.Refuel();
    }
}

abstract record State;
record Working(IJob Job) : State;
record Idle(int Cycles) : State;   // сколько циклов подряд без работы

var jobs = new List<IJob>
{
    new Refuel(Marker("coal-depot"), 0.2f),
    new Smelting
    {
        Ore = "iron-ore",
        MineAt = Zone("north-iron"),
        Furnaces = Find("stone-furnace", Zone("smelter")),
    },
};

var idle = 0;

while (true)
{
    IJob? job = jobs.FirstOrDefault(j => j.Ready);
    State state = job is not null ? new Working(job) : new Idle(idle + 1);

    switch (state)
    {
        case Working w:
            idle = 0;
            w.Job.Run();
            break;

        case Idle { Cycles: > 10 } i:
            Say($"Нечего делать уже {i.Cycles} циклов");
            break;

        case Idle i:
            idle = i.Cycles;
            Wait(5);
            break;
    }
}
```
