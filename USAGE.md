# Cursed Pit · Art Factory — usage

Локальный веб-инструмент для генерации референсов окружения через ComfyUI с автовалидацией лорных правил и чек-листом покрытия.

---

## 0. Prerequisites

- **ComfyUI** запущен и слушает `http://127.0.0.1:8188`
- Чекпойнт **`juggernautXL_ragnarokBy.safetensors`** установлен в `ComfyUI/models/checkpoints/`
- **Node.js 22+** (проверено на 24.15)

---

## 1. Start

```powershell
cd "D:\Unreal Projects\CursedPit ArtFabric\backend"
npm start
```

Откроется на `http://127.0.0.1:5174`. Бэкенд сам отдаёт фронт.

В UI сверху-справа пилл:
- `READY` — ComfyUI отвечает, можно генерить
- `DEGRADED` — ComfyUI не отвечает (запусти/проверь)

---

## 2. Базовый цикл генерации

1. Слева в **Axes** выбери: Camera / Material / SpaceType / Origin / Condition / Occupant / Lighting
   - **Camera** — ракурс (чисто визуальная ось для мудборда, без валидации)
   - **Condition** — степень сохранности (Pristine…Battle-Damaged…Overgrown), ортогональна Origin
   - **Biomass** — скаляр «органической порчи». `auto` = следует за глубиной (зеркалит anomaly, env.md §12); сними галку → ручной слайдер 0…1. В холодных зонах (Cooling/DeepFreeze) подавляется автоматически.
2. Подвинь слайдер **Depth** (-60…-1). Снизу появятся производные:
   - **Zone** — `Cooling` / `DeepFreeze` / `Reheating`
   - **Anomaly** — 0.00…1.00 + цветная шкала
3. Блок **Validation** покажет:
   - `valid` (зелёный) — комбинация лорно допустима
   - `invalid` (красный) — есть `errors[]` (например, `Organic` в `Cooling`)
   - `valid with warnings` — есть `warnings[]` (например, `Ice` в Cooling выше -15 — соф-мин)
4. Справа в **Positive prompt** появится собранный из осей промпт. Если хочешь — отредактируй (появится метка `(edited)`). Кнопка **rebuild from axes** возвращает автосбор.
5. В **Params**: Steps / CFG / Sampler / Scheduler / Width-Height. Есть **пресеты SDXL native ratios** (1024² · 1216×832 · 832×1216 · 1152×896 · 896×1152) — клик заполняет W/H.
6. **Generate**. Под кнопкой появится прогресс-bar (`step X / Y`, нода). Длится 30–60с на 1024²/28 steps.
7. Результат справа: картинка + сайдкар-метаданные (seed, длительность, prompt ID, зона, аномалия).
   - **Клик по картинке** — копирует в буфер
   - **⤢ FULLSCREEN** — открывает lightbox; клик по картинке в lightbox тоже копирует; закрытие — клик по фону / Esc / `close`

---

## 3. Coverage (чек-лист покрытия)

Внизу страницы — таблица всех сцен, которые нужно покрыть артами (на основе `environment.md §3+§9`).

- **Generated** = сколько уже сгенерено артов, чьи оси попали в match-паттерн пункта
- **External** = сколько из них прошли финализацию на внешней машине (пока 0 — гибрид-плечо ещё не реализовано)
- **APPLY** — заполняет осями этого пункта генератор сверху (можно сразу жать Generate)
- **×** — удалить пункт
- **+ ADD ITEM** — добавить свой пункт (id, title, source, depth range, multi-select по осям, target count)

Авто-матч: пустой массив = wildcard. Например `material: []` матчит любой материал.

После каждой генерации Coverage пересчитывается автоматически.

---

## 4. Где что лежит

```
art-factory/
├─ backend/
│  ├─ config/
│  │  ├─ axes.json            # фразы осей + базовый стиль + anomaly/thermal/biomass модификаторы
│  │  ├─ axis_rules.json      # depth-bands, термальные/anomaly/biomass, depth-диапазоны, condition-warn
│  │  ├─ optimizer_rules.json # правила слоя PromptOptimizer (remove/removeSections/replace по условиям)
│  │  └─ coverage.json        # чек-лист сцен (auto-edit через UI или вручную)
│  └─ src/
│     ├─ index.js                       # Fastify, все маршруты
│     ├─ config.js                      # env/defaults
│     ├─ generator.js                   # оркестратор: workflow → submit → poll → download
│     ├─ progress.js                    # ProgressTracker по WS-событиям
│     ├─ comfyui/
│     │  ├─ client.js                   # HTTP /prompt /history /view
│     │  ├─ workflow.js                 # загрузка JSON-шаблона, резолв нод по class_type, applyParams
│     │  └─ wsclient.js                 # нативный WebSocket к /ws с reconnect
│     ├─ axes/
│     │  ├─ loader.js  depth.js         # depth → thermalZone / anomalyIntensity / biomassIntensity
│     │  ├─ validator.js                # combination check → {errors, warnings, derived}
│     │  ├─ promptBuilder.js            # оси → упорядоченный sections[] (единый источник правды)
│     │  └─ promptOptimizer.js          # SDXL-слой: conflict-rules → dedup → NearDark boost → canonical order
│     └─ coverage/
│        ├─ matcher.js                  # sidecar vs item match
│        ├─ scanner.js                  # скан output/*.json → counts
│        └─ store.js                    # CRUD с atomic write
├─ frontend/
│  └─ index.html                        # одностраничный vanilla UI (никаких бандлеров)
├─ output/                              # PNG + одноимённые .json сайдкары
│  └─ <timestamp>_seed<N>_<i>.png + .json
├─ CursedPit Workflow.json              # API-формат workflow ComfyUI (источник для подстановки)
├─ art_factory_brief.md                 # бриф
└─ comfyui_api_integration.md           # API-протокол
```

---

## 5. Структура сайдкара

Рядом с каждым PNG лежит `.json` с:
```json
{
  "prompt_positive": "…",
  "prompt_negative": "…",
  "seed": 123456789,
  "axes": { "material": "Stone", "spaceType": "Corridor", "origin": "DwarvenTech", "occupant": "None", "camera": "EyeLevel", "condition": "Worn", "depth": -3 },
  "derived": { "thermalZone": "Cooling", "anomalyIntensity": 0, "biomassIntensity": 0, "biomassSource": "depth" },
  "optimizer": { "model": "sdxl", "version": 2, "applied": ["conflict"], "notes": [ { "stage": "conflict", "rule": "natural-dry", "action": "remove", "removed": "water-eroded rock contours" } ] },
  "params": { "steps": 28, "cfg": 6.5, "sampler": "dpmpp_2m", "scheduler": "karras", "width": 1024, "height": 1024, "batchSize": 1 },
  "checkpoint": "juggernautXL_ragnarokBy.safetensors",
  "styleVersion": "none",
  "stage": "draft",
  "comfy": { "promptId": "...", "clientId": "...", "sourceNode": "9", "sourceFilename": "...", "subfolder": "art-factory", "type": "output" },
  "createdAt": "2026-05-24T20:43:11.370Z"
}
```

---

## 6. HTTP-роуты (если без UI)

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET  | `/healthz`              | состояние backend + ComfyUI |
| GET  | `/axes`                 | оси + базовый стиль для UI-дропдаунов |
| POST | `/axes/derive`          | `{depth}` → `{thermalZone, anomalyIntensity}` |
| POST | `/axes/validate`        | `{material, spaceType, origin, occupant, depth}` → `{ok, errors[], warnings[], derived}` |
| POST | `/prompt/preview`       | то же + сборка промпта без генерации |
| POST | `/generate`             | принимает `{axes:{...}}` ИЛИ `{positive:"..."}`. Поля: seed/steps/cfg/sampler/scheduler/width/height/batchSize/ckpt/force/stage |
| GET  | `/progress/active`      | прогресс текущей генерации `{value, max, node, status}` |
| GET  | `/progress/:promptId`   | прогресс конкретной |
| GET  | `/coverage`             | пункты + counts |
| POST | `/coverage`             | добавить пункт |
| PUT  | `/coverage/:id`         | обновить |
| DELETE | `/coverage/:id`       | удалить |
| GET  | `/images/<filename>`    | отдача готового PNG |

Пример быстрой генерации:
```powershell
curl -X POST http://127.0.0.1:5174/generate `
  -H "content-type: application/json" `
  -d '{"axes":{"material":"Stone","spaceType":"Corridor","origin":"DwarvenTech","occupant":"None","depth":-3},"steps":28,"width":1024,"height":1024}'
```

---

## 7. Редактирование конфигов

- **`axes.json`** — фразы для промпта по каждому значению осей. Подбираются итеративно с Иваном на живых генерациях.
- **`axis_rules.json`** — депт-диапазоны, термальные/anomaly/biomass бэнды, condition-warn. Менять при изменениях в `Design/fundamentals/environment.md`.
- **`optimizer_rules.json`** — правила разрешения конфликтов слоя PromptOptimizer: `when` (условия на оси + derived), действия `remove` (по подстроке) / `removeSections` (по key) / `replace`. Здесь чинятся кросс-осевые противоречия без правки кода.
- **Тесты:** `npm test` в `backend/` (node:test) — паритет/дедуп/конфликты/оси. Гонять после правок конфигов или оптимайзера.
- **`coverage.json`** — пункты чек-листа. Удобнее через UI (`+ ADD ITEM`), но можно и руками.
- **`CursedPit Workflow.json`** — workflow ComfyUI в API-формате. Чтобы заменить — пересохранить из ComfyUI через **Settings → Enable Dev Mode → Save (API Format)**. Резолвер нод работает по `class_type`, не по ID — workflow можно пересобирать.

После любой правки JSON-конфигов — `Ctrl+C` в терминале бэкенда → `npm start` заново.

---

## 8. Что ещё в плане

- **5** — батч N вариантов → галерея → выбор лучшего
- **5.1** — upscale-pass (4x-UltraSharp) + IP-Adapter для консистентности стиля
- **6** — финализация: seed-lock выбранного + имя `art_<material>_<space>_<origin>_<occupant>_d<depth>_seed<N>.png`
- **7** — гибрид-плечо: финализация Flux на арендованной GPU
