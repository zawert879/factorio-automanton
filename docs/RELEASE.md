# Выпуск мода

## Релиз на GitHub — по тегу

1. Поднять версию в `mod/info.json` и дописать раздел с тем же номером в `mod/changelog.txt` (строгий формат
   Factorio — см. CLAUDE.md). Закоммитить.
2. Поставить тег и отправить:
   ```sh
   git tag v0.3.0
   git push origin main v0.3.0
   ```
3. Workflow «Выпуск» (`.github/workflows/release.yml`, вкладка Actions на GitHub):
   - проверяет, что тег совпадает с версией в `mod/info.json`;
   - собирает заметки к выпуску из раздела changelog (`tools/release/notes.mjs`; раздела нет — выпуск не делается);
   - гоняет `npm test` (тесты вне игры; внутриигровым нужна Factorio — их гонять перед тегом руками);
   - собирает `automaton_<версия>.zip` (`npm run package`) и создаёт релиз с ним;
   - если задан секрет `FACTORIO_UPLOAD_API_KEY` — выгружает тот же архив на портал модов.

Упал шаг — релиза нет; исправить, удалить тег (`git push origin :v0.3.0`, `git tag -d v0.3.0`) и поставить снова.

Друзьям без портала: страница Releases → `automaton_<версия>.zip` → в папку модов игры
(macOS `~/Library/Application Support/factorio/mods/`, Windows `%APPDATA%\Factorio\mods\`,
Linux `~/.factorio/mods/`) без распаковки.

## Портал модов (mods.factorio.com)

С портала мод ставится из игры (меню «Моды» → поиск), обновляется там же, а при входе на сервер игра сама
скачивает недостающие моды — друзьям не нужно носить zip.

Выгружает workflow (`tools/release/portal.mjs`): мода на портале ещё нет — публикует его (описание
`tools/release/portal.md`, категория Overhaul, лицензия MIT, ссылка на исходники — `homepage` из
`mod/info.json`); есть — выгружает новую версию. Проверить, что будет сделано, без ключа:
`node tools/release/portal.mjs dist/automaton_0.3.0.zip --dry-run`.

Один раз настроить:

1. Аккаунт factorio.com с купленной игрой (Steam-аккаунт привязывается в профиле factorio.com).
2. На https://factorio.com/profile создать API-ключ с правами «ModPortal: Upload Mods» и
   «ModPortal: Publish Mods».
3. GitHub → репозиторий → Settings → Secrets and variables → Actions → New repository secret:
   имя `FACTORIO_UPLOAD_API_KEY`, значение — ключ.

Дальше каждый тег `v*` выгружает релиз и на портал. Номер версии каждый раз новый — портал не принимает
тот же номер второй раз. Без секрета шаг «Портал модов» пропускается; добавили секрет позже — перезапустить
workflow (Actions → выпуск → Re-run jobs): готовый релиз на GitHub шаг пропустит.

Имя мода на портале — `name` из `mod/info.json` (`automaton`; на 2026-10-09 свободно). После публикации оно
закреплено; картинка в списке — `mod/thumbnail.png` (144×144), картинки галереи и теги добавляются на странице
мода на портале.
