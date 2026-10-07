# Automaton — мод для Factorio

Оверхол для игры с друзьями: конвейеры, буры, манипуляторы, логистические роботы и насосы убраны,
их работу делают машины-автоматоны по программам на подмножестве TypeScript.

- Дизайн и принятые решения: `docs/DESIGN.md`. Не менять решения молча — сначала спросить.
- Встроенная библиотека для программ машин: `docs/API.md` (объявления TS — основа будущего `automaton.d.ts`;
  примеры должны проходить `tsc --strict`).
- План: `docs/ROADMAP.md`. Работаем по задачам по порядку; перед задачей уточнить детали,
  после — отметить `[x]`, сделать коммит (одна задача — один коммит, сообщение на русском, с номером
  задачи) и кратко сообщить, что сделано и как проверено.
- Замеры производительности — в `tools/bench/` (запускаются без окна и не мешают открытой игре).
- `docs/language-samples/` — варианты синтаксиса, из которых выбран TypeScript (`3-typescript.md`).

- Целевая версия: Factorio 2.0 (stable), только base, без зависимости от Space Age.
- Корень репозитория = корень мода. В игру подключён симлинком:
  `~/Library/Application Support/factorio/mods/automaton` -> этот каталог.
- Игра (Steam, macOS): `~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`
- Лог игры: `~/Library/Application Support/factorio/factorio-current.log`

## Структура
- `settings.lua` — настройки мода (settings stage)
- `data.lua` / `data-updates.lua` / `data-final-fixes.lua` — прототипы (data stage)
- `control.lua` — runtime-логика (события, команды, GUI)
- `locale/{en,ru}/*.cfg` — строки; добавлять ключи сразу в оба языка
- `changelog.txt` — строгий формат Factorio (99 дефисов, `Version:`, `Date:`, категории с отступом 2, пункты с отступом 4)

## Соглашения
- API 2.0: `storage` вместо `global`; справка https://lua-api.factorio.com/latest/
- Имена прототипов, настроек и GUI-элементов — с префиксом `automaton-`.
- Инициализацию `storage` делать в `on_init` и повторять в `on_configuration_changed`.
- Сборка/публикация — через FMTK (VS Code) или `npx factoriomod-debug package`; dotfiles и `CLAUDE.md` в zip не попадают.

## FMTK
- Расширение закреплено на версии 2.0.14 (последняя ветки 2.0.x). FMTK 2.1.x запускает игру с `--dap`,
  а этот флаг есть только в Factorio 2.1 — на 2.0.x отладка молча не стартует.
  Обновлять FMTK до 2.1.x только вместе с переходом мода на Factorio 2.1.
- Тип отладчика в `launch.json` — `factoriomod`; mods-путь FMTK берёт из конфига игры.
