// @program Патруль
// Боевая машина объезжает посты; кончаются патроны — едет в арсенал за магазинами,
// сильно повреждена — зовёт ремонтника и ждёт дома (ремонтник подписан на неё: radio.subscribe(id, "нужен-ремонт")).
// Как запустить:
//   1. Исследуйте «Боевые автоматоны», сделайте боевой автоматон Mk1.
//   2. Поставьте метки «пост-1», «пост-2», «пост-3» вдоль маршрута; выделите «Программатором» зону
//      «арсенал» с сундуком, в котором лежат магазины. Дом машины — в её окне.
//   3. Параметры (необязательно): {"posts": ["пост-1", "пост-2"], "arsenal": "арсенал", "ammo": "firearm-magazine"}.

const args = me.args<{ posts?: string[]; arsenal?: string; ammo?: Item }>();
const route = (args.posts ?? ["пост-1", "пост-2", "пост-3"]).map((name) => marker(name));
const ammo: Item = args.ammo ?? "firearm-magazine";
const arsenal = zone(args.arsenal ?? "арсенал").find(Chest)[0];

// Оружие есть только у боевых моделей (2C): у остальных me.weapon === null.
const weapon = me.weapon;
if (weapon === null) {
  alert(`${me.name}: «Патруль» — программа для боевой машины`);
  exit();
}
const ammoLeft = () => weapon.ammo?.count ?? 0;

while (true) {
  if (ammoLeft() < 20) {
    me.move(arsenal);
    arsenal.extract(ammo, 50);
    weapon.reload();
  }

  weapon.patrol(route, () => ammoLeft() < 20 || me.health < 0.4);

  if (me.health < 0.4) {
    radio.publish("нужен-ремонт", me.id);
    me.goHome();
    waitUntil(() => me.health > 0.9, { every: 2 });
  }
}
