// @program Кладовщик
// Стоит у сундука и по радио отвечает, сколько в нём чего: request("кладовщик", "сколько", "coal").
// Как запустить: поставьте машину рядом с сундуком, назовите её «кладовщик» (окно машины → имя),
// исследуйте «Радиосвязь автоматонов». Другие машины спрашивают так:
//   const coal = request<number>("кладовщик", "сколько", "coal", 10);

const chest = scan.entities({ type: ["container", "logistic-container"] })[0];
if (chest === undefined) {
  alert(`${me.name}: рядом нет сундука`);
  exit();
}
me.label = "склад";

while (true) {
  const msg = receive<Item>("сколько");
  if (msg !== null) msg.reply(chest.count(msg.data));
}
