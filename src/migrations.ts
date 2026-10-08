// Миграции storage (13.6). У сохранения есть версия схемы; при обновлении мода (on_configuration_changed)
// выполняются шаги от сохранённой версии до текущей, по порядку. Шаг — только про данные:
// новые поля со значением по умолчанию, переименования, перестройка таблиц. Сначала идут init-функции
// модулей (создают недостающие таблицы), потом миграции, потом adoptUnregisteredRobots.
//
// Как добавить: увеличить SCHEMA_VERSION и дописать шаг MIGRATIONS[новая версия].

/** Текущая версия схемы storage. */
export const SCHEMA_VERSION = 2

const MIGRATIONS: Record<number, (this: void) => void> = {
  // 2 (этапы 7–11): у машины — модель, бак и оружейный слот; у полётов — места в круге пересчёта.
  2: () => {
    for (const [, record] of pairs(storage.robots.byId)) {
      if (!record.entity.valid) continue
      record.model ??= record.entity.name
      record.tank ??= { amount: 0, temperature: 15 }
    }
    if (storage.flight !== undefined) storage.flight.slot ??= {}
  },
}

/** Новая игра: схема сразу текущая. */
export function initSchema(): void {
  storage.schemaVersion ??= SCHEMA_VERSION
}

/** Обновление мода: шаги от сохранённой версии до текущей. Возвращает выполненные версии. */
export function migrate(): number[] {
  const from = storage.schemaVersion ?? 1
  const done: number[] = []
  for (let version = from + 1; version <= SCHEMA_VERSION; version++) {
    MIGRATIONS[version]?.()
    done.push(version)
  }
  storage.schemaVersion = SCHEMA_VERSION
  if (done.length > 0) log(`automaton: миграции storage ${from} → ${SCHEMA_VERSION}`)
  return done
}
