# Словарь имён

Имена, которые пишут программы: здания для поиска (`zone("плавильня").find("stone-furnace")`, `scan.buildings({ name: … })`), предметы (`chest.extract("iron-plate")`, `me.mine("coal")`) и жидкости (`me.tank.pump("water")`). Factorio 2.0, только base, мод Automaton 0.9.0 — то, что мод убрал из игры, здесь не показано. В игре тот же словарь — справка F1, раздел «Имена» (там и имена других модов); VS Code подсказывает имена при наборе. Страница создаётся командой `npm run names`.

## Здания

По классам программ: `zone(…).find(Furnace)` находит все здания класса, `find("stone-furnace")` — по имени.

### Chest

| Здание | Имя |
|---|---|
| Деревянный сундук | `wooden-chest` |
| Железный сундук | `iron-chest` |
| Стальной сундук | `steel-chest` |

### Furnace

| Здание | Имя |
|---|---|
| Каменная печь | `stone-furnace` |
| Стальная печь | `steel-furnace` |
| Электрическая печь | `electric-furnace` |

### Assembler

| Здание | Имя |
|---|---|
| Сборочный автомат 1 | `assembling-machine-1` |
| Сборочный автомат 2 | `assembling-machine-2` |
| Сборочный автомат 3 | `assembling-machine-3` |
| Нефтеперерабатывающий завод | `oil-refinery` |
| Химический завод | `chemical-plant` |
| Центрифуга | `centrifuge` |

### RocketSilo

| Здание | Имя |
|---|---|
| Ракетная шахта | `rocket-silo` |

### Lab

| Здание | Имя |
|---|---|
| Лаборатория | `lab` |

### Beacon

| Здание | Имя |
|---|---|
| Маяк | `beacon` |

### Boiler

| Здание | Имя |
|---|---|
| Бойлер | `boiler` |
| Теплообменник | `heat-exchanger` |

### Generator

| Здание | Имя |
|---|---|
| Паровой двигатель | `steam-engine` |
| Паровая турбина | `steam-turbine` |

### Reactor

| Здание | Имя |
|---|---|
| Ядерный реактор | `nuclear-reactor` |

### StorageTank

| Здание | Имя |
|---|---|
| Резервуар | `storage-tank` |

### Pipe

| Здание | Имя |
|---|---|
| Труба | `pipe` |
| Подземная труба | `pipe-to-ground` |
| Помпа | `pump` |

### Turret

| Здание | Имя |
|---|---|
| Пулемётная турель | `gun-turret` |
| Артиллерийское орудие | `artillery-turret` |

### FlameTurret

| Здание | Имя |
|---|---|
| Огнемётная турель | `flamethrower-turret` |

### CargoWagon

| Здание | Имя |
|---|---|
| Грузовой вагон | `cargo-wagon` |

### FluidWagon

| Здание | Имя |
|---|---|
| Вагон-цистерна | `fluid-wagon` |

### Locomotive

| Здание | Имя |
|---|---|
| Локомотив | `locomotive` |

### Vehicle

| Здание | Имя |
|---|---|
| Автомобиль | `car` |
| Танк | `tank` |
| Паукотрон | `spidertron` |

### ChargingStation

| Здание | Имя |
|---|---|
| Зарядная станция автоматонов | `automaton-charging-station` |

### Building — здания без своего класса (у них есть только общее у всех зданий)

| Здание | Имя |
|---|---|
| Деревянная опора ЛЭП | `small-electric-pole` |
| Средняя опора ЛЭП | `medium-electric-pole` |
| Большая опора ЛЭП | `big-electric-pole` |
| Подстанция | `substation` |
| Прямые рельсы | `straight-rail` |
| Полудиагональные рельсы | `half-diagonal-rail` |
| Изогнутые рельсы | `curved-rail-a` |
| Изогнутые рельсы | `curved-rail-b` |
| Железнодорожная станция | `train-stop` |
| Ж/д светофор | `rail-signal` |
| Проходной ж/д светофор | `rail-chain-signal` |
| Артиллерийский вагон | `artillery-wagon` |
| Фонарь | `small-lamp` |
| Арифметический комбинатор | `arithmetic-combinator` |
| Сравнивающий комбинатор | `decider-combinator` |
| Выбирающий комбинатор | `selector-combinator` |
| Постоянный комбинатор | `constant-combinator` |
| Выключатель питания | `power-switch` |
| Программируемый динамик | `programmable-speaker` |
| Дисплей | `display-panel` |
| Большое табло | `automaton-display-large` |
| Малое табло | `automaton-display-small` |
| Солнечная панель | `solar-panel` |
| Аккумуляторный блок | `accumulator` |
| Тепловая труба | `heat-pipe` |
| Грузовая посадочная площадка | `cargo-landing-pad` |
| Стена | `stone-wall` |
| Ворота | `gate` |
| Радар | `radar` |
| Мина | `land-mine` |
| Лазерная турель | `laser-turret` |

## Предметы

### Логистика

| Предмет | Имя |
|---|---|
| Деревянный сундук | `wooden-chest` |
| Железный сундук | `iron-chest` |
| Стальной сундук | `steel-chest` |
| Резервуар | `storage-tank` |
| Деревянная опора ЛЭП | `small-electric-pole` |
| Средняя опора ЛЭП | `medium-electric-pole` |
| Большая опора ЛЭП | `big-electric-pole` |
| Подстанция | `substation` |
| Труба | `pipe` |
| Подземная труба | `pipe-to-ground` |
| Помпа | `pump` |
| Рельсы | `rail` |
| Железнодорожная станция | `train-stop` |
| Ж/д светофор | `rail-signal` |
| Проходной ж/д светофор | `rail-chain-signal` |
| Локомотив | `locomotive` |
| Грузовой вагон | `cargo-wagon` |
| Вагон-цистерна | `fluid-wagon` |
| Артиллерийский вагон | `artillery-wagon` |
| Автомобиль | `car` |
| Танк | `tank` |
| Паукотрон | `spidertron` |
| Пулемёт на шасси автоматона: охраняет посты и маршруты (me.weapon: attack, guard, patrol). Патроны — me.weapon.reload() из груза. | `automaton-combat-mk1` |
| Ракетомёт на шасси автоматона: для гнёзд и червей. Ракеты — me.weapon.reload() из груза. | `automaton-combat-mk2` |
| Летающий автоматон Mk1 | `automaton-flyer-mk1` |
| Летающий автоматон Mk2 | `automaton-flyer-mk2` |
| Рабочий автоматон Mk1 | `automaton-worker-mk1` |
| Рабочий автоматон Mk2 | `automaton-worker-mk2` |
| Рабочий автоматон Mk3 | `automaton-worker-mk3` |
| Метка автоматонов | `automaton-marker` |
| Сигнальная метка | `automaton-signal-marker` |
| Строительный дрон | `construction-robot` |
| Фонарь | `small-lamp` |
| Арифметический комбинатор | `arithmetic-combinator` |
| Сравнивающий комбинатор | `decider-combinator` |
| Выбирающий комбинатор | `selector-combinator` |
| Постоянный комбинатор | `constant-combinator` |
| Выключатель питания | `power-switch` |
| Программируемый динамик | `programmable-speaker` |
| Дисплей | `display-panel` |
| Большое табло (192×128) | `automaton-display-large` |
| Малое табло (96×64) | `automaton-display-small` |
| Каменный блок | `stone-brick` |
| Бетон | `concrete` |
| Бетон с разметкой опасности | `hazard-concrete` |
| Железобетон | `refined-concrete` |
| Железобетон с разметкой опасности | `refined-hazard-concrete` |
| Отсыпка территории | `landfill` |
| Взрывчатка для скал | `cliff-explosives` |

### Производство

| Предмет | Имя |
|---|---|
| Ремонтный комплект | `repair-pack` |
| Бойлер | `boiler` |
| Паровой двигатель | `steam-engine` |
| Солнечная батарея | `solar-panel` |
| Аккумуляторный блок | `accumulator` |
| Зарядная станция автоматонов | `automaton-charging-station` |
| Ядерный реактор | `nuclear-reactor` |
| Тепловая труба | `heat-pipe` |
| Теплообменник | `heat-exchanger` |
| Паровая турбина | `steam-turbine` |
| Каменная печь | `stone-furnace` |
| Стальная печь | `steel-furnace` |
| Электрическая печь | `electric-furnace` |
| Сборочный автомат 1 | `assembling-machine-1` |
| Сборочный автомат 2 | `assembling-machine-2` |
| Сборочный автомат 3 | `assembling-machine-3` |
| Нефтеперерабатывающий завод | `oil-refinery` |
| Химический завод | `chemical-plant` |
| Центрифуга | `centrifuge` |
| Лаборатория | `lab` |
| Маяк | `beacon` |
| Модуль скорости | `speed-module` |
| Модуль скорости 2 | `speed-module-2` |
| Модуль скорости 3 | `speed-module-3` |
| Модуль эффективности | `efficiency-module` |
| Модуль эффективности 2 | `efficiency-module-2` |
| Модуль эффективности 3 | `efficiency-module-3` |
| Модуль продуктивности | `productivity-module` |
| Модуль продуктивности 2 | `productivity-module-2` |
| Модуль продуктивности 3 | `productivity-module-3` |
| Ракетная шахта | `rocket-silo` |
| Грузовая посадочная площадка | `cargo-landing-pad` |
| Спутник | `satellite` |

### Компоненты

| Предмет | Имя |
|---|---|
| Древесина | `wood` |
| Уголь | `coal` |
| Камень | `stone` |
| Железная руда | `iron-ore` |
| Медная руда | `copper-ore` |
| Урановая руда | `uranium-ore` |
| Сырая рыба | `raw-fish` |
| Железная плита | `iron-plate` |
| Медная плита | `copper-plate` |
| Стальная балка | `steel-plate` |
| Твёрдое топливо | `solid-fuel` |
| Пластмассовый брусок | `plastic-bar` |
| Сера | `sulfur` |
| Аккумулятор | `battery` |
| Взрывчатка | `explosives` |
| water-barrel | `water-barrel` |
| Бочка нефти | `crude-oil-barrel` |
| petroleum-gas-barrel | `petroleum-gas-barrel` |
| light-oil-barrel | `light-oil-barrel` |
| heavy-oil-barrel | `heavy-oil-barrel` |
| lubricant-barrel | `lubricant-barrel` |
| sulfuric-acid-barrel | `sulfuric-acid-barrel` |
| Железная шестерня | `iron-gear-wheel` |
| Железный прут | `iron-stick` |
| Медный кабель | `copper-cable` |
| Бочка | `barrel` |
| Электросхема | `electronic-circuit` |
| Продвинутая схема | `advanced-circuit` |
| Процессор | `processing-unit` |
| Твердотопливный двигатель | `engine-unit` |
| Электродвигатель | `electric-engine-unit` |
| Каркас дрона | `flying-robot-frame` |
| Конструкция малой плотности | `low-density-structure` |
| Ракетное топливо | `rocket-fuel` |
| Уран-235 | `uranium-235` |
| Уран-238 | `uranium-238` |
| Урановый топливный элемент | `uranium-fuel-cell` |
| Отработанный урановый топливный элемент | `depleted-uranium-fuel-cell` |
| Ядерное топливо | `nuclear-fuel` |
| Автоматизационный исследовательский пакет | `automation-science-pack` |
| Логистический исследовательский пакет | `logistic-science-pack` |
| Военный исследовательский пакет | `military-science-pack` |
| Химический исследовательский пакет | `chemical-science-pack` |
| Производственный исследовательский пакет | `production-science-pack` |
| Вспомогательный исследовательский пакет | `utility-science-pack` |
| Космический исследовательский пакет | `space-science-pack` |

### Военная промышленность

| Предмет | Имя |
|---|---|
| Пистолет | `pistol` |
| Пистолет-пулемёт | `submachine-gun` |
| Дробовик | `shotgun` |
| Боевой дробовик | `combat-shotgun` |
| Ракетница | `rocket-launcher` |
| Огнемёт | `flamethrower` |
| Магазин с патронами | `firearm-magazine` |
| Магазин с бронебойными патронами | `piercing-rounds-magazine` |
| Магазин с урановыми патронами | `uranium-rounds-magazine` |
| Патроны для дробовика | `shotgun-shell` |
| Бронебойные патроны для дробовика | `piercing-shotgun-shell` |
| Пушечный снаряд | `cannon-shell` |
| Разрывной пушечный снаряд | `explosive-cannon-shell` |
| Урановый пушечный снаряд | `uranium-cannon-shell` |
| Разрывной урановый пушечный снаряд | `explosive-uranium-cannon-shell` |
| Артиллерийский снаряд | `artillery-shell` |
| Ракета | `rocket` |
| Разрывная ракета | `explosive-rocket` |
| Атомная бомба | `atomic-bomb` |
| Топливо для огнемёта | `flamethrower-ammo` |
| Граната | `grenade` |
| Осколочная граната | `cluster-grenade` |
| Ядовитая капсула | `poison-capsule` |
| Замедляющая капсула | `slowdown-capsule` |
| Лёгкая броня | `light-armor` |
| Тяжёлая броня | `heavy-armor` |
| Модульная броня | `modular-armor` |
| Силовая броня | `power-armor` |
| Силовая броня МК2 | `power-armor-mk2` |
| Портативная солнечная панель | `solar-panel-equipment` |
| Портативный реактор деления | `fission-reactor-equipment` |
| Личный аккумулятор | `battery-equipment` |
| Личный аккумулятор МК2 | `battery-mk2-equipment` |
| Оборудование для игнорирования конвейеров | `belt-immunity-equipment` |
| Экзоскелет | `exoskeleton-equipment` |
| Персональная дронстанция | `personal-roboport-equipment` |
| Персональная дронстанция МК2 | `personal-roboport-mk2-equipment` |
| Прибор ночного видения | `night-vision-equipment` |
| Энергетический щит | `energy-shield-equipment` |
| Энергетический щит МК2 | `energy-shield-mk2-equipment` |
| Персональная лазерная защита | `personal-laser-defense-equipment` |
| Электроразрядная защита | `discharge-defense-equipment` |
| Стена | `stone-wall` |
| Ворота | `gate` |
| Радар | `radar` |
| Мина | `land-mine` |
| Пулемётная турель | `gun-turret` |
| Лазерная турель | `laser-turret` |
| Огнемётная турель | `flamethrower-turret` |
| Артиллерийское орудие | `artillery-turret` |

## Жидкости

| Жидкость | Имя |
|---|---|
| Вода | `water` |
| Пар | `steam` |
| Сырая нефть | `crude-oil` |
| Попутный нефтяной газ | `petroleum-gas` |
| Дизельное топливо | `light-oil` |
| Мазут | `heavy-oil` |
| Смазочная жидкость | `lubricant` |
| Серная кислота | `sulfuric-acid` |
