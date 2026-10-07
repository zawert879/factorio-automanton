#!/bin/sh
# Бенчмарк N виртуальных роботов-перевозчиков: ./run.sh 100000
set -e
N="${1:-100000}"
HERE=$(cd "$(dirname "$0")" && pwd)
WORK="${TMPDIR:-/tmp}/automaton-haulers"
BIN="${FACTORIO_BIN:-$HOME/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio}"
rm -rf "$WORK"; mkdir -p "$WORK/data" "$WORK/mods/haulers"
printf '{"mods":[{"name":"base","enabled":true},{"name":"haulers","enabled":true}]}' > "$WORK/mods/mod-list.json"; cp "$HERE/mods/haulers/info.json" "$WORK/mods/haulers/"
sed "s/__N__/$N/" "$HERE/mods/haulers/control.template.lua" > "$WORK/mods/haulers/control.lua"
printf '[path]\nread-data=__PATH__system-read-data__\nwrite-data=%s\n' "$WORK/data" > "$WORK/config.ini"
"$BIN" --config "$WORK/config.ini" --mod-directory "$WORK/mods" --create "$WORK/map.zip" >/dev/null 2>&1
grep -h "HAUL" "$WORK/data/factorio-current.log" | sed -E 's/^.*control.lua:[0-9]+: //'
echo "save size: $(du -h "$WORK/map.zip" | cut -f1)"
"$BIN" --config "$WORK/config.ini" --mod-directory "$WORK/mods" --benchmark "$WORK/map.zip" --benchmark-ticks 3600 --disable-audio 2>&1 | grep -E "Performed|avg|Error" || true
grep -h "HAUL events" "$WORK/data/factorio-current.log" | sed -E 's/^.*control.lua:[0-9]+: //' || true
