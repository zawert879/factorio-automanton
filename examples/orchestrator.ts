// @program Оркестратор
// Раздаёт рабочим задания — какую печь кормить рудой — и показывает на табло, кто чем занят.
// Стоит в плавильне и видит печи; рабочие (программа «Рабочий») находят его сами и регистрируются.
// Как запустить:
//   1. Исследуйте «Радиосвязь автоматонов» (и «Табло», если нужно табло).
//   2. Выделите печи «Программатором» и назовите зону «плавильня»; большое табло назовите «штаб».
//   3. Одна машина — «Оркестратор», несколько — «Рабочий» с параметром {"field": "<зона с рудой>"}.
// Параметры (необязательно): {"zone": "плавильня", "display": "штаб", "ore": "iron-ore"}.

type Order = { furnace: Entity; ore: Item };
type Done = { furnaceId: number };

interface WorkerInfo { robot: Robot; name: string; status: string; busy: boolean }

const args = me.args<{ zone?: string; display?: string; ore?: Item }>();
const ore: Item = args.ore ?? "iron-ore";
const workers = new Map<number, WorkerInfo>();
const assigned = new Set<number>();            // печи, на которые уже выдано задание

/** Табло — если есть (без него оркестратор тоже работает). */
function findScreen(): Display | null {
  try {
    return display(args.display ?? "штаб");
  } catch (e) {
    return null;
  }
}
const screen = findScreen();

move(zone(args.zone ?? "плавильня"));
subscribe("ищу-оркестратора");

function handleMail(): void {
  for (let m = tryReceive("ищу-оркестратора"); m !== null; m = tryReceive("ищу-оркестратора")) {
    send(m.from, "оркестратор", me.id);
  }
  for (let m = tryReceive<string>("регистрация"); m !== null; m = tryReceive<string>("регистрация")) {
    workers.set(m.from.id, { robot: m.from, name: m.data, status: "свободен", busy: false });
    m.reply("ok");
  }
  for (let m = tryReceive<Done>("готово"); m !== null; m = tryReceive<Done>("готово")) {
    assigned.delete(m.data.furnaceId);
    const w = workers.get(m.from.id);
    if (w !== undefined) {
      w.busy = false;
      w.status = "свободен";
    }
  }
}

function assignWork(): void {
  const hungry = scan.entities({ type: "furnace" })
    .filter(f => f.count(ore) < 10 && !assigned.has(f.id));
  let next = 0;
  for (const w of workers.values()) {
    if (next >= hungry.length) break;
    if (w.busy) continue;
    const furnace = hungry[next++];
    assigned.add(furnace.id);
    w.busy = true;
    w.status = `руда → печь #${furnace.id}`;
    const order: Order = { furnace, ore };
    send(w.robot, "задание", order);
  }
}

function draw(): void {
  if (screen === null) return;
  const s = screen;
  const list = [...workers.values()];
  const busy = list.filter(w => w.busy).length;
  const rows: Cell[][] = list.map(w => [
    w.name,
    { text: w.status, color: w.busy ? "yellow" : "green" },
  ]);
  s.frame(() => {
    s.clear("black");
    s.text(4, 4, "Занятость роботов", { color: "yellow", size: 12 });
    s.table(4, 20, [["Робот", "Задача"], ...rows], { header: true });
    s.bar(4, s.height - 10, s.width - 8, 6, list.length === 0 ? 0 : busy / list.length, "green");
  });
}

while (true) {
  handleMail();
  assignWork();
  draw();
  wait(1);
}
