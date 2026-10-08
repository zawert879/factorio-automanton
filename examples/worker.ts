// @program Рабочий
// Находит оркестратора (сначала рядом, потом по радио), регистрируется у него и выполняет задания:
// накопать руды на месторождении и отвезти в печь, которую назвал оркестратор.
// Параметры: {"field": "<зона с рудой>", "amount": 50} — зону выделите «Программатором» на месторождении.

type Order = { furnace: Entity; ore: Item };

function findBoss(): number {
  const near = scan.robots().find(r => r.program === "Оркестратор");
  if (near !== undefined) return near.id;
  while (true) {
    broadcast("ищу-оркестратора");
    const answer = receive<number>("оркестратор", 10);
    if (answer !== null) return answer.data;
  }
}

const { field, amount } = me.args<{ field: string; amount?: number }>();
const boss = findBoss();
request(boss, "регистрация", me.name, 30);
me.label = "рабочий";

while (true) {
  const msg = receive<Order>("задание");
  if (msg === null) continue;

  const { furnace, ore } = msg.data;
  try {
    move(zone(field));
    mine(ore, amount ?? 50);
    move(furnace);
    put(furnace, ore);
  } catch (e) {
    say(`Не вышло: ${e instanceof ActionError ? e.code : "?"}`);
  } finally {
    send(boss, "готово", { furnaceId: furnace.id });
  }
}
