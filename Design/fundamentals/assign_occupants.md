# Cursed Pit — Assign Occupants

**Статус:** Draft v0.1
**Область:** размещение существ и лорных находок на этаже после PopulateCells
**Применимость:** оба режима (Occupant `DwarvenLiving` — только "История")
**Зависит от:** environment.md (Occupant как 4-я ось), enemies_and_ai.md (архетипы), level_profile.md, adjacency_rules.md
**Используется в:** Фаза 3 генерации (после PopulateCells, до Decorate)

---

## 1. Назначение системы

`AssignOccupants` — третья фаза процедурной генерации, которая **наполняет этаж живыми существами и лорными находками**. На вход — граф с уже назначенными `SpaceType` и `Material` для каждой cell (после `PopulateCells`). На выход — те же cells, но с привязанными к ним **encounter'ами** (тактическими группами врагов) и **dwarven remains** (точечными лорными находками).

Документ решает четыре задачи:

1. Зафиксировать **encounter-based модель** размещения существ.
2. Зафиксировать **гибридную композицию** encounter'ов: якорные шаблоны + веса архетипов внутри размерных категорий.
3. Зафиксировать **отдельную фазу `PlaceDwarvenRemains`** для лорных находок.
4. Спроектировать структуру DataAsset'ов: `UEncounterTemplateDataAsset`, `UEncounterPoolDataAsset` и связанные.

---

## 2. Базовые принципы

### 2.1 Encounter-based, не per-cell

Существа размещаются **тактическими группами** (encounter'ами), а не равномерно по всем cells. Это даёт:

- Читаемые боевые ситуации (как в souls-like)
- Передышки между встречами
- Возможность спроектировать тактически осмысленные комбинации (Brute впереди, Ranged за ним)

Один encounter занимает **1+ связных cells**.

### 2.2 Гибридный состав encounter'а

Каждый encounter получает свой состав одним из двух способов:

- **Anchor template** — фиксированный шаблон, прописанный дизайнером ("Goblin Ambush", "Ratfolk Pack"). Дают узнаваемые паттерны.
- **Fill через веса** — алгоритм выбирает размерную категорию (small/medium/large), затем взвешенно набирает архетипы из пула, доступного для Occupant.

Обычно на этаже 0-2 якорных encounter'а; остальные — fill.

### 2.3 Тактические якоря — для тренируемых паттернов

Якорные шаблоны существуют чтобы дать игроку **узнаваемые ситуации**, на которых он тренируется. "О, я узнаю эту засаду — Brute впереди, лучник за ним". Это эстетика souls-like и Arx Fatalis: некоторые ситуации повторяются как узнаваемые.

Fill-encounter'ы — фон между якорями. Они вариативны, не запоминаются индивидуально, дают **общую угрозу зоны**.

### 2.4 Сложность через типы и плотность, не цифры

В соответствии с enemies_and_ai.md (п. 1.2): враги не масштабируются по уровню игрока. Этаж становится сложнее через:

- **Состав encounter'а** — больше архетипов, более опасные комбинации
- **Плотность encounter'ов** — больше встреч на этаже
- **Среду** — высокий AnomalyIntensity → возможны мутации

### 2.5 DwarvenRemains — не encounter

`DwarvenRemains` (тела гномов, дневники, схемы) — **не существа**. Они не вступают в бой. Это **точечные лорные находки**, размещаемые отдельной мини-фазой `PlaceDwarvenRemains` с собственной плотностью.

### 2.6 Детерминизм

При одинаковом `Seed` и `LevelProfile` распределение encounter'ов и remains воспроизводится точно. Это критично для `CampaignManager` ("История" фиксирует состояние мира после первой генерации).

---

## 3. Структура UEncounterTemplateDataAsset

Каждый encounter (и якорный, и fill-категория) описывается одним DataAsset'ом.

```cpp
UCLASS(BlueprintType)
class CURSEDPIT_API UEncounterTemplateDataAsset : public UDataAsset
{
    GENERATED_BODY()

public:
    // ===== Идентификация =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    FString TemplateName;                          // "GoblinAmbush_Small", "GoblinFill_Medium"

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    EOccupant Occupant;                            // Goblins, Ratfolk, DeepHostile, etc.

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    FIntPoint DepthRange;                          // (-2, -5) — на каких этажах доступен

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    bool bCampaignOnly = false;                    // только для "Истории" (например, named encounter)

    // ===== Тип шаблона =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Anchor")
    int32 AnchorPriority = 0;                      // 0 = fill only; >0 = может быть якорным

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Anchor")
    int32 MaxPerFloor = -1;                        // -1 = без лимита; для якорных обычно 1

    // ===== Состав =====

    // Способ A: фиксированный состав (для якорных)
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Composition")
    bool bUseFixedComposition = false;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Composition",
              meta=(EditCondition="bUseFixedComposition"))
    TArray<FArchetypeCount> FixedComposition;      // {Brute: 1, Ranged: 2}

    // Способ B: веса архетипов + размерная категория (для fill)
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Composition",
              meta=(EditCondition="!bUseFixedComposition"))
    TMap<EEnemyArchetype, float> ArchetypeWeights; // {Skirmisher: 1.0, Brute: 0.3, Ranged: 0.5}

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Composition",
              meta=(EditCondition="!bUseFixedComposition"))
    FIntPoint SizeRange;                           // (3, 5) — добрать от 3 до 5 существ

    // ===== Пространственные требования =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Space")
    FIntPoint CellCountRange;                      // (1, 3) — encounter занимает от 1 до 3 cells

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Space")
    TArray<ESpaceType> PreferredSpaceTypes;        // {Hall, Cavern} — где этому encounter'у комфортно

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Space")
    TArray<ESpaceType> ForbiddenSpaceTypes;        // {Chasm} — где никогда

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Space")
    int32 MinDistanceFromEntry = 2;                // не ставить ближе чем N cells от EntryCell

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Space")
    int32 MinDistanceFromOtherEncounter = 1;       // буфер между encounter'ами

    // ===== Балансировка =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Balance")
    int32 EncounterWeight = 1;                     // вклад в общую "сложность" этажа

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Balance")
    float SelectionWeight = 1.0f;                  // вероятностный вес при выборе из пула

    // ===== Лор/UI (опционально) =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Lore")
    FText FlavorDescription;                       // "Гоблиньи разведчики" — для дебага/UI
};

USTRUCT(BlueprintType)
struct FArchetypeCount
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere) EEnemyArchetype Archetype;
    UPROPERTY(EditAnywhere) int32 Count = 1;
};
```

### 3.1 Якорный vs fill: разница в полях

**Якорный шаблон:**
- `AnchorPriority` > 0
- `bUseFixedComposition` = true
- `FixedComposition` задан явно
- `MaxPerFloor` обычно 1
- `EncounterWeight` явно прописан (так как состав фиксирован)

**Fill шаблон:**
- `AnchorPriority` = 0
- `bUseFixedComposition` = false
- `ArchetypeWeights` + `SizeRange` заданы
- `MaxPerFloor` = -1 (можно повторять)
- `EncounterWeight` усреднён по ожидаемому размеру

### 3.2 Архетипы

`EEnemyArchetype` — 7 архетипов из enemies_and_ai.md:

```cpp
UENUM(BlueprintType)
enum class EEnemyArchetype : uint8
{
    Skirmisher,
    Brute,
    Ranged,
    Ambusher,
    Caster,
    Lurker,
    PackCoordinated
};
```

Какие архетипы доступны для какого Occupant — определяется в `UOccupantArchetypePoolDataAsset` (см. п. 5).

---

## 4. Структура UEncounterPoolDataAsset

Глобальный пул всех шаблонов encounter'ов на проект. Один asset, ссылается из конфига генератора.

```cpp
UCLASS(BlueprintType)
class CURSEDPIT_API UEncounterPoolDataAsset : public UDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Pool")
    TArray<TObjectPtr<UEncounterTemplateDataAsset>> Templates;

public:
    /** Фильтр доступных шаблонов для заданных условий */
    TArray<UEncounterTemplateDataAsset*> GetTemplatesFor(
        int32 FloorIndex,
        EOccupant Occupant,
        bool bIsCampaignMode
    ) const;

    /** Фильтр только якорных шаблонов */
    TArray<UEncounterTemplateDataAsset*> GetAnchorTemplatesFor(
        int32 FloorIndex,
        EOccupant Occupant,
        bool bIsCampaignMode
    ) const;
};
```

### 4.1 Связь с LevelProfile

LevelProfile **не хранит** список шаблонов напрямую. Он определяет:

- `AllowedOccupants: TMap<EOccupant, float>` — какие Occupant категории доступны и с какими весами
- `EncounterDensity: FFloatRange` (новое поле в LevelProfile) — целевая сумма EncounterWeight на этаже
- `AnchorEncounterChance: FFloatRange` (новое поле в LevelProfile) — вероятность выбрать якорный вместо fill при заполнении

При генерации алгоритм запрашивает у `EncounterPool`:
```cpp
Pool->GetTemplatesFor(FloorIndex, Occupant, bIsCampaignMode)
```
и получает уже отфильтрованный список.

### 4.2 Добавления в LevelProfile

В существующий `ULevelProfileDataAsset` добавляются три поля:

```cpp
UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Occupants")
FFloatRange EncounterDensity;                  // целевая сумма EncounterWeight на этаже

UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Occupants")
FFloatRange AnchorEncounterChance;             // вероятность anchor vs fill при выборе

UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Occupants")
FFloatRange DwarvenRemainsDensity;             // плотность лорных находок
```

Соответствующие методы интерполяции:
```cpp
float GetEncounterDensityForFloor(int32 FloorIndex) const;
float GetAnchorEncounterChanceForFloor(int32 FloorIndex) const;
float GetDwarvenRemainsDensityForFloor(int32 FloorIndex) const;
```

### 4.3 Не блокирует уже утверждённое

**Важно:** структура LevelProfile из `level_profile.md` **не меняется** в существующих полях. Добавляются только **новые поля** в категорию "Occupants". `Allowed Occupants` остаётся как был; `EncounterDensity` дополняет, не заменяет.

---

## 5. Структура UOccupantArchetypePoolDataAsset

Связь "категория Occupant → доступные архетипы". Один asset на проект.

```cpp
UCLASS(BlueprintType)
class CURSEDPIT_API UOccupantArchetypePoolDataAsset : public UDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    TMap<EOccupant, FOccupantPool> Pools;
};

USTRUCT(BlueprintType)
struct FOccupantPool
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere)
    TSet<EEnemyArchetype> AvailableArchetypes;
};
```

### 5.1 Содержимое для MVP

Зафиксировано в соответствии с enemies_and_ai.md:

| Occupant | Доступные архетипы |
|----------|---------------------|
| Goblins | Skirmisher, Brute, Ranged, Caster |
| Ratfolk | Skirmisher, Ranged, Ambusher, PackCoordinated |
| HumanGarrison | Brute, Ranged |
| HumanExiles | Brute, Ranged, Ambusher |
| DeepHostile | Skirmisher, Brute, Ranged, Ambusher, Lurker, PackCoordinated (без Caster) |
| DwarvenRemains | — (не существа) |
| None | — |
| DwarvenLiving (Campaign only) | — (не вступают в бой, особая логика) |

Этот mapping — **single source of truth** для генератора. Если encounter template указывает архетип, недоступный для Occupant, это **ошибка валидации** на этапе загрузки asset'а.

---

## 6. Алгоритм AssignOccupants

Многоэтапный жадный алгоритм. Детерминирован при заданном `Seed`.

### 6.1 Псевдокод

```
function AssignOccupants(graph, levelProfile, encounterPool, occupantPool, seed):

    # === Этап 1: вычислить таргеты ===
    targetBudget = levelProfile.EncounterDensity.GetForFloor(graph.FloorIndex)
    anchorChance = levelProfile.AnchorEncounterChance.GetForFloor(graph.FloorIndex)
    allowedOccupants = levelProfile.AllowedOccupants  # Map<EOccupant, float>

    # === Этап 2: выбрать Occupant категорию для этажа ===
    # На MVP — один доминирующий Occupant на этаж (опционально вторичный, см. п. 6.2)
    primaryOccupant = SelectWeighted(allowedOccupants, seed)
    bIsCampaign = (currentMode == EGameMode::Campaign)

    # === Этап 3: разместить якорные encounter'ы ===
    anchorTemplates = encounterPool.GetAnchorTemplatesFor(
        graph.FloorIndex, primaryOccupant, bIsCampaign)
    placedBudget = 0

    foreach template in SortByPriorityDesc(anchorTemplates):
        if Roll(seed) > anchorChance: continue  # не каждый якорь срабатывает
        if template.MaxPerFloor reached: continue

        cluster = FindCellCluster(graph, template, alreadyOccupied)
        if cluster is null: continue              # нет подходящего места — пропускаем

        encounter = BuildAnchorEncounter(template, cluster, seed)
        Assign(cluster, encounter)
        placedBudget += template.EncounterWeight

        if placedBudget >= targetBudget: return

    # === Этап 4: заполнить остаток fill encounter'ами ===
    fillTemplates = encounterPool.GetFillTemplatesFor(
        graph.FloorIndex, primaryOccupant, bIsCampaign)

    while placedBudget < targetBudget and fillTemplates not empty:
        template = SelectWeighted(fillTemplates, seed)
        cluster = FindCellCluster(graph, template, alreadyOccupied)
        if cluster is null:
            # Не нашли подходящий cluster — снижаем требования или прекращаем
            attemptsLeft -= 1
            if attemptsLeft == 0: break
            continue

        encounter = BuildFillEncounter(template, cluster, seed)
        Assign(cluster, encounter)
        placedBudget += encounter.EncounterWeight  # для fill — фактический вес от размера

    # === Этап 5: применить AnomalyIntensity модификаторы ===
    anomIntensity = levelProfile.GetAnomalyIntensityForFloor(graph.FloorIndex)
    foreach encounter in placedEncounters:
        ApplyAnomalyMutations(encounter, anomIntensity, seed)
```

### 6.2 Один или несколько Occupants на этаж

На MVP — **один доминирующий Occupant на этаж** (или None, если выпало). Это упрощает дизайн и даёт чёткую идентичность этажу.

Альтернатива — 1 первичный + редкий вторичный (например, на этаже Ratfolk изредка попадается одинокий DeepHostile-Lurker). Это **опциональное расширение** через параметр `LevelProfile.SecondaryOccupantChance`, но **в MVP не реализуется**.

### 6.3 BuildAnchorEncounter

Якорный шаблон содержит `FixedComposition: TArray<FArchetypeCount>`. Алгоритм просто разворачивает его в конкретные существа:

```
function BuildAnchorEncounter(template, cluster, seed):
    encounter = new Encounter()
    encounter.Template = template
    encounter.Cluster = cluster
    encounter.EncounterWeight = template.EncounterWeight

    foreach (archetype, count) in template.FixedComposition:
        for i in 1..count:
            cell = SelectBestCellForArchetype(cluster, archetype, seed)
            encounter.AddCreature(archetype, cell)

    return encounter
```

`SelectBestCellForArchetype` использует подсказки из enemies_and_ai.md (п. 9.1):
- Brute → Hall, Corridor
- Ranged → Hall, Cavern (с возвышениями)
- Skirmisher → Hall, Cavern
- Caster → Hall (центр)
- и т.д.

Внутри cluster алгоритм выбирает cell наиболее подходящего SpaceType для архетипа.

### 6.4 BuildFillEncounter

Fill шаблон содержит `ArchetypeWeights: TMap<Archetype, float>` и `SizeRange: FIntPoint`. Алгоритм добирает существ:

```
function BuildFillEncounter(template, cluster, seed):
    size = RandRange(template.SizeRange, seed)
    encounter = new Encounter()
    encounter.Template = template
    encounter.Cluster = cluster

    for i in 1..size:
        archetype = SelectWeighted(template.ArchetypeWeights, seed)
        cell = SelectBestCellForArchetype(cluster, archetype, seed)
        encounter.AddCreature(archetype, cell)

    encounter.EncounterWeight = ComputeWeightFromComposition(encounter)
    return encounter
```

`ComputeWeightFromComposition` — функция стоимости архетипа:
- Skirmisher = 1
- Brute = 2
- Ranged = 2
- Ambusher = 2
- Caster = 3
- PackCoordinated = 3
- Lurker = 5

Это даёт `EncounterWeight` как сумму. Используется для подсчёта общей сложности этажа.

### 6.5 FindCellCluster

Самая сложная часть. Найти кластер из `template.CellCountRange` связных cells, удовлетворяющий ограничениям:

```
function FindCellCluster(graph, template, alreadyOccupied):
    candidates = []
    foreach startCell in graph.cells:
        if startCell in alreadyOccupied: continue
        if startCell.SpaceType in template.ForbiddenSpaceTypes: continue
        if Distance(startCell, graph.EntryCell) < template.MinDistanceFromEntry: continue
        if NearOtherEncounter(startCell, template.MinDistanceFromOtherEncounter): continue

        # Попробовать вырастить cluster от startCell
        cluster = GrowCluster(startCell, template, alreadyOccupied)
        if cluster.size in template.CellCountRange:
            score = ScoreCluster(cluster, template)
            candidates.Add((cluster, score))

    if candidates is empty: return null

    # Выбрать кластер с лучшим score (для якорных) или взвешенно (для fill)
    if template.AnchorPriority > 0:
        return BestScored(candidates)
    else:
        return SelectWeighted(candidates, by="score", seed)
```

`ScoreCluster` поощряет cells подходящего SpaceType:
- +10 за каждую cell в `PreferredSpaceTypes`
- -5 за cell не в `PreferredSpaceTypes`
- 0 за cell нейтрального SpaceType

`GrowCluster` — BFS-расширение от startCell, добавляющее соседние cells пока размер не достигнет верха `CellCountRange` или не закончатся валидные соседи.

### 6.6 ApplyAnomalyMutations

В зонах с высоким `AnomalyIntensity` стандартные архетипы получают **модификаторы** (не новый архетип, см. enemies_and_ai.md п. 9.3):

```
function ApplyAnomalyMutations(encounter, intensity, seed):
    if intensity < 0.5: return  # нет мутаций
    if Roll(seed) > intensity: return  # вероятностно

    foreach creature in encounter:
        if Roll(seed) < intensity * 0.3:
            creature.AddModifier(AnomalyMutation)
```

Конкретные модификаторы (вспышки агрессии, изменённое поведение, визуальные эффекты) — задача AI-уровня, не AssignOccupants. AssignOccupants только помечает существо как мутировавшее.

---

## 7. Этап PlaceDwarvenRemains

Отдельная самостоятельная фаза. Запускается **после** AssignOccupants, чтобы не конкурировать с encounter'ами за cells.

### 7.1 Логика

```
function PlaceDwarvenRemains(graph, levelProfile, seed):
    density = levelProfile.GetDwarvenRemainsDensityForFloor(graph.FloorIndex)
    targetCount = round(density * graph.cellCount)

    candidates = []
    foreach cell in graph.cells:
        weight = ComputeRemainsWeightForCell(cell, levelProfile)
        if weight > 0:
            candidates.Add((cell, weight))

    placed = 0
    while placed < targetCount and candidates not empty:
        cell = SelectWeighted(candidates, seed)
        remainType = SelectRemainType(cell, levelProfile, seed)
        cell.Remains = remainType
        candidates.Remove(cell)
        placed += 1
```

### 7.2 ComputeRemainsWeightForCell

Учитывает Origin и SpaceType:

| Контекст cell | Вес | Логика |
|---------------|-----|--------|
| Origin=DwarvenResidential, SpaceType=Hall | 3.0 | Жилое гномье — много следов |
| Origin=DwarvenTech, SpaceType=Hall/Corridor | 2.0 | Техническое — следы есть |
| Origin=Natural, SpaceType=Cavern | 0.5 | Изредка — в дальних местах |
| Origin=Natural, SpaceType=Chasm | 0.2 | На дне провалов — редкие |
| Origin=HumanAdapted/HumanFrontier | 0.3 | Люди их частично растащили |
| Cell внутри encounter'а | 0 | Не размещаем поверх боевой группы |
| Cell — EntryCell | 0 | Не на входе |

Эти веса — стартовая точка для балансировки.

### 7.3 Типы DwarvenRemains

В MVP — четыре подтипа:

```cpp
UENUM(BlueprintType)
enum class EDwarvenRemainType : uint8
{
    Corpse,         // тело гнома — визуал + потенциальный лут
    Artifact,       // гномий артефакт (интегрируется с PlaceArtifacts)
    Inscription,    // надпись на стене (нечитаемая без языка из campaign_lore.md)
    Scattered       // россыпь предметов (мелкие гномьи вещи)
};
```

В **BattleTraces** (-56..-57) — особый профиль с повышенной плотностью **Corpse** (следы битв гномов с DeepHostile).

### 7.4 Связь с PlaceArtifacts

Если `RemainType = Artifact`, эта cell **резервируется** для следующей фазы (`PlaceArtifacts`, #13). PlaceArtifacts может разместить артефакт **на теле гнома** (Corpse + Artifact в одной cell — лорно правильно: "артефакт на останках").

Это синергия двух фаз, не конфликт.

---

## 8. Интеграция в общий конвейер генерации

Обновлённая последовательность фаз (с уточнением мест AssignOccupants и PlaceDwarvenRemains):

```
Phase 1: GenerateFromCell           # граф этажа (готово)
Phase 2: PopulateCells              # SpaceType + Material (в работе)
Phase 3a: AssignOccupants           # этот документ — encounter'ы существ
Phase 3b: PlaceDwarvenRemains       # этот документ — лорные находки
Phase 4: PlaceArtifacts             # артефакты (см. magic_and_artifacts.md, #13)
Phase 5: PlaceNodes                 # гномьи узлы (см. dwarven_nodes.md)
Phase 6: Decorate                   # визуальное наполнение (#14)
```

Между фазами 3a и 3b — `alreadyOccupied` cells передаются как контекст: PlaceDwarvenRemains не назначает remains в cells, занятые encounter'ом.

---

## 9. Стартовый набор EncounterTemplate для MVP

Минимальный набор шаблонов для запуска генерации. Полный набор будет расширяться через playtest.

### 9.1 Якорные шаблоны (anchors)

**Goblin Ambush** — узнаваемая засада гоблинов
- Occupant: Goblins
- DepthRange: (-3, -8)
- FixedComposition: {Brute: 1, Ranged: 2}
- CellCountRange: (2, 3)
- PreferredSpaceTypes: {Corridor, Hall}
- MinDistanceFromEntry: 4
- MaxPerFloor: 1
- AnchorPriority: 10
- EncounterWeight: 5

**Ratfolk Pack** — стайная охота крысолюдов
- Occupant: Ratfolk
- DepthRange: (-7, -15)
- FixedComposition: {Skirmisher: 4, PackCoordinated: 1}
- CellCountRange: (2, 3)
- PreferredSpaceTypes: {Maze, Cavern}
- MaxPerFloor: 1
- AnchorPriority: 10
- EncounterWeight: 7

**Deep Lurker Den** — одинокий страж глубин
- Occupant: DeepHostile
- DepthRange: (-20, -44)
- FixedComposition: {Lurker: 1}
- CellCountRange: (1, 2)
- PreferredSpaceTypes: {Cavern, Chasm}
- MaxPerFloor: 1
- AnchorPriority: 15  // высокий приоритет — редкая узнаваемая встреча
- EncounterWeight: 5

**Endgame Concentration** — пик опасности эндгейма
- Occupant: DeepHostile
- DepthRange: (-45, -50)
- FixedComposition: {Brute: 2, Ranged: 1, Lurker: 1}
- CellCountRange: (3, 4)
- PreferredSpaceTypes: {Hall, Cavern}
- MaxPerFloor: 1
- AnchorPriority: 20
- EncounterWeight: 12

### 9.2 Fill шаблоны

**Goblin Small** — мелкая группа гоблинов
- Occupant: Goblins
- DepthRange: (-2, -8)
- ArchetypeWeights: {Skirmisher: 1.0, Brute: 0.2, Ranged: 0.3}
- SizeRange: (2, 3)
- CellCountRange: (1, 2)
- PreferredSpaceTypes: {Hall, Corridor}
- AnchorPriority: 0
- SelectionWeight: 1.0

**Goblin Medium** — средняя группа гоблинов
- Occupant: Goblins
- DepthRange: (-4, -10)
- ArchetypeWeights: {Skirmisher: 1.0, Brute: 0.5, Ranged: 0.4, Caster: 0.1}
- SizeRange: (3, 5)
- CellCountRange: (2, 3)
- PreferredSpaceTypes: {Hall, Cavern}
- AnchorPriority: 0
- SelectionWeight: 0.7

**Ratfolk Small** — мелкие крысолюды
- Occupant: Ratfolk
- DepthRange: (-6, -14)
- ArchetypeWeights: {Skirmisher: 1.0, Ambusher: 0.4}
- SizeRange: (2, 4)
- CellCountRange: (1, 2)
- PreferredSpaceTypes: {Maze, Corridor}
- AnchorPriority: 0
- SelectionWeight: 1.0

**Ratfolk Medium** — средняя стая крысолюдов
- Occupant: Ratfolk
- DepthRange: (-8, -20)
- ArchetypeWeights: {Skirmisher: 1.0, Ambusher: 0.5, Ranged: 0.3, PackCoordinated: 0.2}
- SizeRange: (3, 5)
- CellCountRange: (2, 3)
- PreferredSpaceTypes: {Maze, Cavern}
- AnchorPriority: 0
- SelectionWeight: 0.6

**HumanGarrison Patrol** — патруль гарнизона
- Occupant: HumanGarrison
- DepthRange: (-2, -5)
- ArchetypeWeights: {Brute: 1.0, Ranged: 0.5}
- SizeRange: (2, 3)
- CellCountRange: (1, 2)
- PreferredSpaceTypes: {Hall, Corridor}
- AnchorPriority: 0
- SelectionWeight: 1.0

**DeepHostile Small** — мелкие глубинные
- Occupant: DeepHostile
- DepthRange: (-12, -34)
- ArchetypeWeights: {Skirmisher: 1.0, Ambusher: 0.7, Ranged: 0.3}
- SizeRange: (2, 4)
- CellCountRange: (1, 2)
- PreferredSpaceTypes: {Cavern, Maze}
- AnchorPriority: 0
- SelectionWeight: 1.0

**DeepHostile Medium** — средние глубинные
- Occupant: DeepHostile
- DepthRange: (-15, -44)
- ArchetypeWeights: {Skirmisher: 1.0, Brute: 0.6, Ambusher: 0.5, Ranged: 0.4, PackCoordinated: 0.2}
- SizeRange: (3, 5)
- CellCountRange: (2, 3)
- PreferredSpaceTypes: {Cavern, Hall, Maze}
- AnchorPriority: 0
- SelectionWeight: 0.5

**DeepHostile Heat** — адаптированные к жаре (Reheating)
- Occupant: DeepHostile
- DepthRange: (-35, -44)
- ArchetypeWeights: {Brute: 1.0, Skirmisher: 0.7, Lurker: 0.2}
- SizeRange: (2, 4)
- CellCountRange: (2, 3)
- PreferredSpaceTypes: {Cavern, Hall}
- AnchorPriority: 0
- SelectionWeight: 1.0

**DeepHostile Ice** — ледяные формы (DeepFreeze)
- Occupant: DeepHostile
- DepthRange: (-32, -34)
- ArchetypeWeights: {Skirmisher: 1.0, Lurker: 0.3}
- SizeRange: (1, 3)
- CellCountRange: (1, 2)
- PreferredSpaceTypes: {Cavern, Chasm}
- AnchorPriority: 0
- SelectionWeight: 1.0

### 9.3 Сводно

Стартовый MVP-набор: **4 якорных + 9 fill = 13 EncounterTemplate'ов**. Каждый — отдельный DataAsset. Все они складываются в `EncounterPool_MVP`.

После playtest набор расширяется: добавляются вариации, региональные особенности, экспериментальные комбинации.

---

## 10. Связь с другими системами

### 10.1 С PopulateCells

AssignOccupants работает с уже назначенными `SpaceType` и `Material`. Если PopulateCells меняет логику — encounter templates могут потребовать обновления `PreferredSpaceTypes`/`ForbiddenSpaceTypes`. Но **базовая структура** AssignOccupants от PopulateCells не зависит.

### 10.2 С enemies_and_ai.md

AssignOccupants ставит существа на cells, но **поведение** (sensorика, состояния, реакция на тела) — задача AI-уровня. AssignOccupants только создаёт существ; AI сам берёт на себя их работу после spawn.

### 10.3 С magic_and_artifacts.md

`PlaceArtifacts` (#13) — следующая фаза. Она может разместить артефакт **на теле** `DwarvenRemains.Corpse`, что лорно правильно.

### 10.4 С dwarven_nodes.md

Размещение узлов (Charge, Repair, Healing, Rest, Hub) — **отдельная фаза `PlaceNodes`**. AssignOccupants не трогает узлы, но влияет на их захваченность: если рядом с узлом стоит encounter с врагами — узел "захвачен" (см. dwarven_nodes.md, п. 8).

Логика "узел захвачен" — это **post-processing**: после всех фаз размещения, для каждого узла проверяется, есть ли в радиусе encounter, и помечается флагом `IsCaptured`.

### 10.5 С level_profile.md

AssignOccupants добавляет в LevelProfile три новых поля (`EncounterDensity`, `AnchorEncounterChance`, `DwarvenRemainsDensity`). Существующие поля **не меняются**. Это совместимое расширение.

### 10.6 С campaign_lore.md

В режиме "История" доступны:
- `DwarvenLiving` как Occupant — особая логика (не encounter, NPC-уровень, см. campaign_lore.md)
- Named encounters с уникальными существами — `bCampaignOnly = true` в шаблоне
- Гарантированные сюжетные встречи — через FloorOverrides в LevelProfile (см. level_profile.md, п. 3.3)

В MVP "Погружения" эти возможности не используются, но архитектура их поддерживает.

---

## 11. Что цементируется этим документом

1. **Encounter-based размещение** — существа группами, не per-cell.
2. **Гибридная композиция** — якорные шаблоны (FixedComposition) + fill (ArchetypeWeights + SizeRange).
3. **Anchor priority** — выбор якоря зависит от приоритета и шанса в LevelProfile.
4. **Глобальный EncounterPool** — все шаблоны в одном DataAsset, LevelProfile фильтрует.
5. **Отдельная фаза PlaceDwarvenRemains** для лорных находок.
6. **Один доминирующий Occupant на этаж** в MVP (вторичный — опциональное расширение).
7. **Архитектурные пулы**: `UEncounterPoolDataAsset`, `UOccupantArchetypePoolDataAsset`.
8. **Расширение LevelProfile**: три новых поля без изменения существующих.
9. **AnomalyMutations** — модификатор архетипа, не новый архетип.
10. **Стартовый набор**: 4 якорных + 9 fill шаблонов для MVP.

---

## 12. Что НЕ фиксируется

- Точные значения весов и плотностей в шаблонах — стартовые точки, подлежат балансировке.
- Конкретные модификаторы AnomalyMutation — задача AI/визуала.
- AI behavior внутри encounter (координация архетипов между собой) — отдельная задача.
- Поведение `DwarvenLiving` в "Истории" — кампания-специфично, отдельный документ.
- Визуальная подача encounter'ов в дебаг-режиме.
- Динамика после spawn (миграция врагов между cells после боя) — задача AI-уровня.

---

## 13. Открытые вопросы

1. **Респаун в "Истории".** Если игрок зачистил этаж и вернулся — encounter'ы появляются заново? Сейчас концепция CampaignManager подразумевает, что **нет**: зачищенные encounter'ы остаются зачищенными до конца кампании. В "Погружении" вопроса не возникает — забег одноразовый.

2. **Динамика на этаже.** Encounter'ы статичны (стоят в назначенных cells)? Или гибридно — какой-то процент патрулирует? Для MVP — статичны (после spawn AI решает локально). Патрули — post-MVP.

3. **Награды за encounter.** Должен ли каждый encounter гарантированно давать награду (лут, ресурс)? Сейчас концепция — нет: лут размещается отдельно (PlaceArtifacts, общие drops от существ). Encounter сам по себе — это **препятствие**, не **награда**. Но возможен анкорный encounter с встроенной наградой (награда задаётся в FixedComposition как дополнительное поле). Это post-MVP.

4. **Тревога между encounter'ами.** Если игрок попал в шумный бой — слышит ли соседний encounter? Сейчас концепция — да (см. enemies_and_ai.md, п. 8.1), но это **runtime AI**, не AssignOccupants. AssignOccupants просто создаёт encounter'ы; их "слышимость" друг друга — задача AI.

5. **Группы из разных Occupants.** Сейчас один encounter — один Occupant. В enemies_and_ai.md (п. 12) был открыт вопрос о смешанных стаях. Зафиксировать: **в MVP — нет**. Каждый encounter моноген по Occupant. Расширение — позже.

6. **Уплотнение шаблонов на этаже.** Если `EncounterDensity` высокая, но шаблонов мало — алгоритм может застрять. Решение: после N неудачных попыток FindCellCluster — снижаем `MinDistanceFromOtherEncounter` или выходим с предупреждением. Балансировка через playtest.

7. **Spatial fairness.** Если все encounter'ы концентрируются в одной части этажа — это плохо. Стоит ли добавить "распределение по карте" как мягкое требование? Сейчас — нет (буфер `MinDistanceFromOtherEncounter` решает большую часть проблемы). Расширение — после playtest.

---

## 14. Следующие шаги

1. Реализовать `UEncounterTemplateDataAsset`, `UEncounterPoolDataAsset`, `UOccupantArchetypePoolDataAsset` в C++.
2. Расширить `ULevelProfileDataAsset` тремя новыми полями + методами интерполяции.
3. Создать `EncounterPool_MVP` со всеми 13 стартовыми шаблонами из раздела 9.
4. Создать `OccupantArchetypePool_MVP` с mapping из раздела 5.1.
5. Реализовать алгоритм AssignOccupants в коде (Phase 3a).
6. Реализовать PlaceDwarvenRemains (Phase 3b).
7. Дополнить существующие LevelProfile значениями `EncounterDensity` и `AnchorEncounterChance` (см. level_profile.md, раздел 5).
8. Тестовый прогон: сгенерировать 5-10 этажей разных профилей, визуально оценить распределение encounter'ов.
9. После стабилизации — переходить к PlaceArtifacts (#13).
