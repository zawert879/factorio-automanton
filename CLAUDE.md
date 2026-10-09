# Automaton — мод для Factorio

Оверхол для игры с друзьями: конвейеры, буры, манипуляторы, логистические роботы и прибрежный насос убраны,
их работу делают машины-автоматоны по программам на подмножестве TypeScript.

- Дизайн и принятые решения: `docs/DESIGN.md`. Не менять решения молча — сначала спросить.
- Встроенная библиотека для программ машин: `docs/API.md` (объявления TS — основа будущего `automaton.d.ts`;
  примеры должны проходить `tsc --strict`). Каждое описание в объявлениях — по-русски и по-английски:
  строка ` * @en …` в `/** … */`, `// русский @en english` в строчном комментарии (`npm test` ловит пропуски).
- `docs/REVIEW.md` — что пользователь должен проверить руками и решения, принятые без него; пополнять
  после каждой задачи, пока работа идёт автономно.
- План: `docs/ROADMAP.md`. Работаем по задачам по порядку; перед задачей уточнить детали,
  после — отметить `[x]`, сделать коммит (одна задача — один коммит, сообщение на русском, с номером
  задачи) и кратко сообщить, что сделано и как проверено. В коммитах и PR — никакой атрибуции Claude
  (`Co-Authored-By`, «Generated with Claude Code»): иначе Claude попадает в контрибьюторы на GitHub.
- Замеры производительности — в `tools/bench/` (запускаются без окна и не мешают открытой игре).
- `docs/LANGUAGE.md` — спецификация языка программ (подмножество TS), представление значений в Lua, отличия от JS.
- `docs/language-samples/` — варианты синтаксиса, из которых выбран TypeScript (`3-typescript.md`).
- Английские версии для игроков (18.9): `README.en.md`, `docs/en/{PLAYER_GUIDE,VSCODE,LANGUAGE}.md`. Меняешь русский
  документ — поправь и английский; примеры кода в них проверяются так же (`npm run dts`, `npm test`).

- Целевая версия: Factorio 2.0 (stable), только base, без зависимости от Space Age.
- Мод пишется на TypeScript (`src/`), TypeScriptToLua собирает Lua в `mod/` — это папка мода, она
  подключена к игре симлинком `~/Library/Application Support/factorio/mods/automaton` -> `mod/`.
- Игра (Steam, macOS): `~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`
- Лог игры: `~/Library/Application Support/factorio/factorio-current.log`

## Сборка
- `npm run build` — собрать Lua в `mod/`; `npm run watch` — пересобирать при изменениях.
- F5 в VS Code сначала запускает сборку (`preLaunchTask`), потом игру с отладчиком.
- Собранный Lua (`mod/**/*.lua`) в git не хранится. Точки останова ставятся в `mod/*.lua`.
- Версии закреплены: TypeScript 6.0.2 (требует TypeScriptToLua 1.37.1), typed-factorio 3.36.0 —
  типы Factorio 2.0 (4.x — уже 2.1, не обновлять). `skipLibCheck` нужен: TS 6 падает на типах typed-factorio.
- Все виды проверок и причины десинков — `docs/TESTING.md`. После изменений состояния, планировщика или
  кода программ машин гонять `npm run test:desync` (сохранение/загрузка посреди работы).
- `npm test [фильтр]` — тесты вне игры: `tests/**/*.test.ts` (библиотека — `tests/lib/testing.ts`) собираются
  в `build/` и выполняются в Lua 5.2 (`tools/lua/build.sh` собирает его при первом запуске). Окружение как
  в Factorio: нет `coroutine`, `io`, `os`, `loadfile`, `dofile`. Тестами покрываются чистые модули (без API игры).
  Особенность TSTL: `string.length` — в байтах UTF-8 (`"ж".length === 2`).
- `npm run test:game` — внутриигровые тесты: `src/test/*.test.ts` (каждый файл регистрируется в
  `src/test/index.ts`) выполняются в Factorio без окна на первом тике, итог — в `script-output`.
  Включаются только служебным модом `automaton-test`, который создаёт скрипт; в zip мода не попадают.
  Ошибки скриптов в таком запуске Factorio пишет в stdout, а не в `factorio-current.log`.
- TSTL: `s.trim()` (и `trimStart`/`trimEnd`) портит кириллицу — убирает байты `C2 A0 EF BB BF`, а это концы
  букв «л», «п», «Р». В коде мода — `trim(s)` из `src/lang/runtime/strings.ts`; `npm test` ловит `.trim()`.
- TSTL: замыкание внутри `for (let i = …; …; i++)` видит последнее значение `i`, а не своей итерации
  (в JS — своей). Если замыкание переживает итерацию (колбэк, `t.after`), значение передавать через
  параметр функции или `for … of`.
- Номера `defines.inventory` у разных типов зданий совпадают (топливо = сундук = патроны турели = 1, вход печи =
  вход сборщика = 2): `get_inventory(fuel)` у сундука вернёт сундук. Слоты выбирать по типу здания
  (`src/automaton/transfer.ts`). Вход печи в 2.0 вмещает больше стопки (54 руды при стопке 50).
- Необработанный `throw new Error("…")` Factorio показывает как `Unknown key: "…"` (TSTL бросает таблицу,
  игра читает её как ключ перевода). Для фатальных ошибок в коде мода — `error("текст")`.
- `npm run shot` — снимки внешнего вида (`src/test/visual.ts` → `build/visual/*.png`), игра с окном на секунды.
  Изменения графики и интерфейса проверять снимками — их можно открыть и посмотреть.
- Проверка без окна, не мешая открытой игре: отдельная папка данных через `--config` и `--mod-directory`
  (пример — `tools/bench/run.sh`).

## Структура
- `src/settings.ts` — настройки мода (settings stage); `src/data.ts` (+ `data-updates`, `data-final-fixes`) —
  прототипы (data stage); `src/control.ts` — runtime (события, команды, GUI); модули — рядом, в подпапках.
- `src/storage.d.ts` — тип `storage`; `src/names.ts` — имена прототипов (общие для data и control).
- `src/prototypes/removal.ts` — удаление ванили (`data-final-fixes`), `src/prototypes/technologies.ts` — технологии.
- `examples/*.ts` — программы-примеры (первая строка `// @program Имя`); в игру сами не попадают — их публикуют
  `/am-science` и тесты (`publishExamples`, `src/program/examples.ts`); проверяются
  `npm run dts` (tsc) и `npm test` (компилятор мода), попадают в мод через `src/program/examples.generated.ts`.
- `src/debug/commands.ts` — отладочные команды (`/am-give [число]` — выдать машины); в мультиплеере только админам.
- В `data`/`settings` глобальные `data`, `mods` объявляются в файле через `factorio:common`
  (в tsconfig подключены только типы runtime).
- `mod/locale/{en,ru}/*.cfg` — строки; добавлять ключи сразу в оба языка.
- `mod/changelog.txt` — строгий формат Factorio (99 дефисов, `Version:`, `Date:`, категории с отступом 2,
  пункты с отступом 4).

## Соглашения
- API 2.0: `storage` вместо `global`; справка https://lua-api.factorio.com/latest/
- В `storage` — только простые данные и ссылки на объекты игры (LuaEntity, LuaRenderObject): без функций,
  классов и метатаблиц. Типы словарей с необязательными записями — `Record<K, V | undefined>`.
- `script.on_nth_tick(1)` занят тестовыми модулями (`src/test/runner.ts`, `stateDump.ts`); код мода подписывается
  на тик через `onTick()` из `src/events.ts` (у мода один обработчик на событие).
- Персонаж без игрока (`mine_entity` из скрипта) не вызывает `on_player_mined_entity`: события подбора
  тестируются вызовом обработчика напрямую.
- Имена прототипов, настроек и GUI-элементов — с префиксом `automaton-`; в своём TS-коде — camelCase.
- Инициализацию `storage` делать в `on_init` и повторять в `on_configuration_changed`.
- В коде мода не использовать `async`/генераторы (TypeScriptToLua делает их на корутинах, а их в Factorio нет).
- Упаковка — `npm run package` (FMTK 2.0.14 из `mod/`, архив — в `dist/`); перед упаковкой FMTK сам
  запускает `npm run build`. Тесты (`mod/test/`) в архив не попадают (`package.ignore` в info.json).
- Версия мода и `mod/changelog.txt` — при выпуске для друзей; версия схемы storage — `src/migrations.ts`.
- Выпуск — тег `vX.Y.Z` (= версия в `mod/info.json`): GitHub Actions собирает zip в релиз и, если задан
  секрет `FACTORIO_UPLOAD_API_KEY`, выгружает на портал модов. Подробно — `docs/RELEASE.md`.

## FMTK
- Расширение закреплено на версии 2.0.14 (последняя ветки 2.0.x). FMTK 2.1.x запускает игру с `--dap`,
  а этот флаг есть только в Factorio 2.1 — на 2.0.x отладка молча не стартует.
  Обновлять FMTK до 2.1.x только вместе с переходом мода на Factorio 2.1.
- Тип отладчика в `launch.json` — `factoriomod`, путь к модам задан явно (`modsPath`).
- Не класть `mod-list.json` в репозиторий (тестовые и бенчмарк-моды создают его во временной папке):
  если в workspace их несколько, FMTK молча не запускает отладку.
