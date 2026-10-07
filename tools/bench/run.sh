#!/bin/sh
# Прогон бенчмарка в Lua самой Factorio без окна и без пересечения с обычной игрой:
# отдельная папка данных и модов во временной папке, результаты — строки BENCH в логе.
# mod-list.json не хранится в репозитории: несколько таких файлов в workspace ломают запуск FMTK.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WORK="${TMPDIR:-/tmp}/automaton-bench"
BIN="${FACTORIO_BIN:-$HOME/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio}"
rm -rf "$WORK"; mkdir -p "$WORK/data" "$WORK/mods"
cp -R "$HERE/mods/bench" "$WORK/mods/"
printf '{"mods":[{"name":"base","enabled":true},{"name":"bench","enabled":true}]}' > "$WORK/mods/mod-list.json"
printf '[path]\nread-data=__PATH__system-read-data__\nwrite-data=%s\n' "$WORK/data" > "$WORK/config.ini"
"$BIN" --config "$WORK/config.ini" --mod-directory "$WORK/mods" --create "$WORK/map.zip" >/dev/null 2>&1
grep -E "BENCH|Error" "$WORK/data/factorio-current.log" | sed -E 's/^ *[0-9.]+ Script @__bench__\/control.lua:[0-9]+: //'
