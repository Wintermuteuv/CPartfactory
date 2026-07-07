# Cursed Pit — Art Factory: ComfyUI API Integration (для Claude Code)

> Технический компаньон к `art_factory_brief.md`. Описывает протокол работы
> с локальным ComfyUI API и точные адреса подстановки параметров в workflow.
> Это разжёванный пункт 2 плана разработки ("ComfyUIClient").

---

## 1. Окружение

- ComfyUI запущен локально, обслуживает И UI, И API на одном адресе:
  **`http://127.0.0.1:8188`**
- Отдельный флаг для локального доступа НЕ нужен. Достаточно держать ComfyUI
  запущенным (консоль + опционально вкладка браузера — они уживаются).
- Базовая модель: **Juggernaut XL** (SDXL). Проверена на RTX 5060 (8 ГБ).
- Подтверждённые рабочие дефолты (генерят чисто, без OOM на 1024×1024):
  - resolution: 1024×1024
  - steps: 28
  - cfg: 6.5
  - sampler_name: `dpmpp_2m`
  - scheduler: `karras`
  - denoise: 1

---

## 2. Ключевые эндпойнты (стабильны между релизами)

| Эндпойнт | Метод | Назначение |
|----------|-------|-----------|
| `/prompt` | POST | Отправить workflow (API-формат) в очередь. Возвращает `prompt_id`. ~80% работы здесь. |
| `/history/{prompt_id}` | GET | Забрать результат выполнения по prompt_id. |
| `/view?filename=...&subfolder=...&type=output` | GET | Скачать готовый PNG. |
| `/upload/image` | POST | Загрузить входное изображение (понадобится для IP-Adapter, Этап 2). |
| `/ws?clientId={id}` | WS | Реал-тайм прогресс (опционально; можно обойтись поллингом /history). |

---

## 3. workflow_api.json — карта нод и адреса подстановки

Шаблон экспортируется из ComfyUI (Settings → Enable Dev Mode → "Save (API Format)").
В API-формате это плоский dict, ключи — строковые ID нод, у каждой `class_type`.

**Точная карта нод текущего тестового workflow:**

| ID | class_type | Что подставлять | Путь подстановки |
|----|-----------|-----------------|------------------|
| `"3"` | KSampler | seed | `wf["3"]["inputs"]["seed"]` |
| `"3"` | KSampler | steps / cfg / sampler_name / scheduler | `wf["3"]["inputs"][...]` |
| `"4"` | CheckpointLoaderSimple | имя чекпойнта | `wf["4"]["inputs"]["ckpt_name"]` |
| `"5"` | EmptyLatentImage | width / height / batch_size | `wf["5"]["inputs"][...]` |
| `"6"` | CLIPTextEncode (positive) | позитивный промпт | `wf["6"]["inputs"]["text"]` |
| `"7"` | CLIPTextEncode (negative) | негативный промпт | `wf["7"]["inputs"]["text"]` |

**ВАЖНО:** не полагаться слепо на эти ID навсегда — если workflow пересоберут,
ID изменятся. Надёжнее: при загрузке шаблона находить ноды по `class_type`
(а для двух CLIPTextEncode — различать по тому, на какую из них ссылается
`KSampler.inputs.positive` vs `.negative`). ID выше — текущее фактическое
состояние, годятся как дефолт/проверка.

---

## 4. Протокол генерации (псевдокод)

```
function generate(workflowTemplate, { positive, negative, seed, ckpt,
                                       width, height, batchSize }):
    wf = deepCopy(workflowTemplate)
    wf["6"].inputs.text  = positive
    wf["7"].inputs.text  = negative
    wf["3"].inputs.seed  = seed
    wf["4"].inputs.ckpt_name = ckpt
    wf["5"].inputs.width = width
    wf["5"].inputs.height = height
    wf["5"].inputs.batch_size = batchSize

    clientId = uuid()
    resp = POST /prompt  { prompt: wf, client_id: clientId }
    promptId = resp.prompt_id

    // поллинг до готовности
    loop:
        h = GET /history/{promptId}
        if h[promptId] exists and has outputs:
            break
        sleep(1s)

    // выходные изображения лежат в h[promptId].outputs[nodeId].images[]
    // каждый: { filename, subfolder, type }
    for img in outputs:
        bytes = GET /view?filename={img.filename}&subfolder={img.subfolder}&type={img.type}
        save(bytes, targetPath)
```

Реальные формы запроса/ответа `/prompt`: тело `{ "prompt": <wf-dict>, "client_id": <id> }`.
Ответ содержит `prompt_id`. Результаты в `/history/{id}` — под ключом `outputs`,
сгруппированы по ID ноды SaveImage, массив `images` с `filename/subfolder/type`.

---

## 5. Стадийность под 8 ГБ VRAM (соблюдать)

Нельзя держать в VRAM всё разом. Три прохода:

1. **Draft-батч:** batch_size = N (старт 4–6), можно меньше шагов (~20) и/или
   меньшее разрешение (768) для скорости. Один POST /prompt с batch_size=N
   вернёт N картинок за один прогон.
2. **Select:** пользователь выбирает лучший вариант в галерее → берём его seed.
   (При batch выходные сиды = baseSeed, baseSeed+1, ... — учитывать индексацию,
   либо генерить N отдельными запросами с явными сидами, что надёжнее для
   воспроизводимости выбранного.)
3. **Final:** один прогон с зафиксированным seed, полные шаги (28), 1024+,
   затем отдельный upscale-проход (`4x-UltraSharp` через ноду UpscaleModelLoader
   + ImageUpscaleWithModel) — это уже отдельный мини-workflow, грузится после
   выгрузки основного, чтобы не ловить OOM.

Рекомендация по сидам: для предсказуемости лучше N отдельных запросов с
явно заданными сидами (seed = base+i), чем один batch — тогда «финал по
выбранному seed» тривиально воспроизводим.

---

## 6. Хранилище результатов

Имя файла: `art_<material>_<space>_<origin>_<occupant>_d<depth>_seed<N>.png`
Рядом одноимённый `.json`:
```json
{
  "prompt_positive": "...",
  "prompt_negative": "...",
  "seed": 123456789,
  "axes": { "material": "...", "spaceType": "...", "origin": "...",
            "occupant": "...", "depth": -30 },
  "derived": { "anomalyIntensity": 0.3, "thermalZone": "Cooling" },
  "params": { "steps": 28, "cfg": 6.5, "sampler": "dpmpp_2m",
              "scheduler": "karras", "width": 1024, "height": 1024 },
  "checkpoint": "juggernautXL_...safetensors",
  "styleVersion": "none",   // позже: id набора эталонов IP-Adapter
  "stage": "final",         // draft | final
  "createdAt": "ISO-8601"
}
```

---

## 7. Базовый промпт и негатив (стартовая точка, подбирать итеративно)

Проверенный на тесте позитив (мрачная гномья пещера, Stone+Corridor):
```
dark fantasy underground cave, ancient dwarven stone corridor, industrial
decay, wet rough rock walls, dim torchlight, volumetric fog, grim atmosphere,
muted limited color palette, cinematic lighting, highly detailed environment
concept art
```
Негатив:
```
bright, colorful, cartoon, anime, low quality, blurry, watermark, text,
signature, oversaturated, cheerful, sunny, modern
```

PromptBuilder собирает позитив как: `<базовый стиль> + <фразы выбранных осей>
+ <модификаторы аномалии по depth>`. Конкретные фразы-маппинги для каждого
значения осей — открытый вопрос, подбирать с Ivan на живых генерациях.

Замечание по лору: верхний "дневной" свет из пролома лорно сомнителен
(поверхность замёрзла, свет в подземелье искусственный/зеркальный) — учесть
при формулировке фраз для верхних этажей.

---

## 8. Что НЕ делать (повтор из брифа, критично)

- НЕ авто-цикл "анализ→re-анализ" в MVP.
- НЕ Flux локально (8 ГБ + IP-Adapter не тянет).
- НЕ монолитный workflow — стадийность из-за VRAM.
- НЕ хардкодить правила осей и адреса нод намертво — выносить в конфиг,
  ноды по возможности резолвить по class_type.
- НЕ localStorage/sessionStorage в UI.
