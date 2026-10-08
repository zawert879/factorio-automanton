// @program Патруль
// Боевая машина объезжает посты; кончаются патроны — едет в арсенал за магазинами,
// сильно повреждена — зовёт ремонтника и ждёт дома (ремонтник подписан на неё: subscribe(id, "нужен-ремонт")).
// Как запустить:
//   1. Исследуйте «Боевые автоматоны», сделайте боевой автоматон Mk1.
//   2. Поставьте метки «пост-1», «пост-2», «пост-3» вдоль маршрута; выделите «Программатором» зону
//      «арсенал» с сундуком, в котором лежат магазины. Дом машины — в её окне.
//   3. Параметры (необязательно): {"posts": ["пост-1", "пост-2"], "arsenal": "арсенал", "ammo": "firearm-magazine"}.

const args = me.args<{ posts?: string[]; arsenal?: string; ammo?: Item }>();
const route = (args.posts ?? ["пост-1", "пост-2", "пост-3"]).map((name) => marker(name));
const ammo: Item = args.ammo ?? "firearm-magazine";
const arsenal = find({ type: "container" }, zone(args.arsenal ?? "арсенал"))[0];
const ammoLeft = () => me.weapon?.ammo?.count ?? 0;

while (true) {
  if (ammoLeft() < 20) {
    move(arsenal);
    take(arsenal, ammo, 50);
    reload();
  }

  patrol(route, () => ammoLeft() < 20 || me.health < 0.4);

  if (me.health < 0.4) {
    publish("нужен-ремонт", me.id);
    goHome();
    waitUntil(() => me.health > 0.9, { every: 2 });
  }
}
