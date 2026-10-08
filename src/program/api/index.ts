// Функции и объекты API программ (docs/API.md): подключение регистрирует их в рантайме.
// Порядок важен: research — последним, он оборачивает уже зарегистрированные функции проверкой
// исследований. (TSTL поднимает import выше export … from — поэтому actions тоже через import.)
import "./output"
import "./me"
import "./vision"
import "./world"
import "./comms"
import "./board"
import "./display"
import "./signals"
import "./combat"
import { registerActionApi } from "./actions"
import "./research"

export { registerActionApi }
