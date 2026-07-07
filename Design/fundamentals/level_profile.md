# Cursed Pit — Level Profile & World Map

**Статус:** Draft v0.1
**Область:** структура DataAsset'ов для процедурной генерации уровней и связь "этаж → профиль"
**Применимость:** оба режима (с разными WorldMap для каждого)
**Зависит от:** environment.md (4 оси среды), adjacency_rules.md, dwarven_nodes.md, magic_and_artifacts.md
**Используется в:** все фазы PopulateCells, AssignOccupants, PlaceArtifacts, размещение узлов

---

## 1. Назначение системы

`LevelProfile` — это **тематическое описание уровня** (тематической единицы из нескольких этажей), которое управляет процедурной генерацией. Это контейнер всех параметров, определяющих, **как выглядит и наполняется** уровень — но **не определяющий** конкретную топологию (это работа `GenerateFromCell`).

`WorldMap` — это **связь между этажами и профилями**: для каждого этажа в игре указано, какой LevelProfile его описывает, либо что этаж — ручная локация.

Вместе они формируют **верхний уровень data-driven генерации**: дизайнер настраивает LevelProfile в редакторе UE5, не трогая код.

Документ решает три задачи:

1. Зафиксировать формальную структуру `ULevelProfileDataAsset` для реализации в Claude Code.
2. Зафиксировать структуру `UWorldMapDataAsset` для связи "этаж → профиль".
3. Зафиксировать **полный список LevelProfile для MVP** с конкретными параметрами (значения подлежат балансировке, но структура — финальная).

---

## 2. Архитектурные принципы

### 2.1 Уровень — несколько этажей с единой темой

**"Уровень"** — это тематическая единица из нескольких этажей подряд (например, "Deep Wilds, -21..-31"). Внутри одного уровня:

- **Origin** фиксирован (одно значение)
- **TemperatureZone** одинаковая
- **Веса** SpaceType/Material/Occupant одинаковые
- **Скаляры** (AnomalyIntensity, ArtifactDensity, NodeDensity) могут **интерполироваться по глубине**

Если внутри логической зоны нужны принципиально разные параметры (например, Origin меняется), это — **два LevelProfile**, не один.

### 2.2 Скаляры — диапазоны, веса — фиксированные

- **Скаляры** (плотности, интенсивности) задаются как `(min, max)` и **линейно интерполируются по FloorIndex** внутри DepthRange уровня.
- **Веса** (Map<Enum, float>) — фиксированные для всего уровня. Если веса должны меняться по глубине — это сигнал к разделению на два LevelProfile.

Это даёт хорошую гранулярность без раздувания количества DataAsset'ов.

### 2.3 Гибридная декомпозиция DataAsset'ов

`LevelProfile` содержит **все скаляры и веса** прямо в себе (легко читать, легко редактировать). Тяжёлые **shared** ресурсы вынесены в отдельные DataAsset'ы и подключаются через ссылки:

- `UAdjacencyRulesDataAsset` — базовая матрица соседства и hard-запреты (один общий на проект)
- (В перспективе) `UOccupantPoolDataAsset` — пулы конкретных существ внутри Occupant-категории

Это позволяет менять базовую матрицу один раз и видеть эффект во всех уровнях.

### 2.4 WorldMap отделён от LevelProfile

Связь "этаж → профиль" живёт в отдельном `UWorldMapDataAsset`. Это даёт:

- Один источник правды для структуры мира
- Лёгкое переключение между режимами (`WorldMap_Submersion`, `WorldMap_Campaign`)
- Чистую обработку ручных локаций — они **не подчиняются** системе LevelProfile вообще

### 2.5 Ручные локации — отдельная сущность

Темница (-1) и Final Floor (-60) — **не генерируются**. Они подгружаются как готовые `UWorld`. В WorldMap для них указан тип `Handcrafted` и ссылка на ассет уровня. Генератор для таких этажей не вызывается.

---

## 3. Структура ULevelProfileDataAsset

### 3.1 Полные поля

```cpp
UCLASS(BlueprintType)
class CURSEDPIT_API ULevelProfileDataAsset : public UDataAsset
{
    GENERATED_BODY()

public:
    // ===== Идентификация =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    FString ProfileName;                          // "DeepWilds", "EndgamePeak" — для дебага

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    FIntPoint DepthRange;                         // (floorMin, floorMax), оба значения отрицательные

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    bool bCampaignOnly = false;                   // профиль доступен только в "Истории"

    // ===== Тематика (фиксированные значения на уровень) =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Theme")
    EOrigin Origin;                               // Natural / DwarvenTech / DwarvenResidential / etc.

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Theme")
    ETemperatureZone TemperatureZone;             // Cooling / DeepFreeze / Reheating

    // ===== Скаляры (интерполируются по FloorIndex внутри DepthRange) =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Scalars",
              meta=(ClampMin="0.0", ClampMax="1.0"))
    FFloatRange AnomalyIntensity;                 // близость к гномьим узлам, влияет на эффекты

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Scalars",
              meta=(ClampMin="0.0", ClampMax="1.0"))
    FFloatRange ArtifactDensity;                  // плотность артефактов

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Scalars",
              meta=(ClampMin="0.0", ClampMax="1.0"))
    FFloatRange NodeDensity;                      // плотность гномьих узлов

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Scalars",
              meta=(ClampMin="0.0", ClampMax="1.0"))
    FFloatRange HubChance;                        // шанс появления Hub-узла

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Scalars",
              meta=(ClampMin="0.0", ClampMax="1.0"))
    FFloatRange StructuralDensity;                // доля cells под опорные Chasm/Shaft

    // ===== Веса (фиксированные на уровень) =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Weights")
    TMap<EMaterial, float> AllowedMaterials;      // Stone, Ice, DwarvenMetal, Organic, Crystal

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Weights")
    TMap<ESpaceType, float> AllowedSpaceTypes;    // Corridor, Hall, Shaft, Cavern, Maze, Chasm

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Weights")
    TMap<EOccupant, float> AllowedOccupants;      // None, Goblins, Ratfolk, HumanGarrison, etc.

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Weights")
    TMap<ENodeType, float> AvailableNodeTypes;    // Charge, Repair, Healing, Rest

    // ===== Структурные настройки =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Structure")
    ESpaceType EntrySpaceType = ESpaceType::Hall; // тип EntryCell

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Structure")
    ESpaceType ExitSpaceType = ESpaceType::Shaft; // тип ExitCells

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Structure")
    bool bAllowStackedShafts = false;             // снимать ли запрет Shaft↔Shaft

    // ===== Связи с shared ресурсами =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="SharedAssets")
    TObjectPtr<UAdjacencyRulesDataAsset> AdjacencyRules;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="SharedAssets")
    TMap<FSpaceTypePair, float> AdjacencyOverrides;  // локальные перезаписи матрицы

    // ===== Точечные override'ы для отдельных этажей =====

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Overrides")
    TMap<int32, FFloorOverride> FloorOverrides;   // FloorIndex → специфичные override

public:
    // ===== Runtime API =====

    /** Вернуть интерполированное значение скаляра для конкретного этажа */
    float GetAnomalyIntensityForFloor(int32 FloorIndex) const;
    float GetArtifactDensityForFloor(int32 FloorIndex) const;
    float GetNodeDensityForFloor(int32 FloorIndex) const;
    float GetHubChanceForFloor(int32 FloorIndex) const;
    float GetStructuralDensityForFloor(int32 FloorIndex) const;

    /** Применён ли override для данного этажа, и какой именно */
    bool HasOverrideForFloor(int32 FloorIndex) const;
    const FFloorOverride& GetOverrideForFloor(int32 FloorIndex) const;
};
```

### 3.2 Логика интерполяции

```cpp
float ULevelProfileDataAsset::GetAnomalyIntensityForFloor(int32 FloorIndex) const
{
    // 1. Проверка override
    if (const FFloorOverride* Override = FloorOverrides.Find(FloorIndex))
    {
        if (Override->bAnomalyIntensityOverridden)
        {
            return Override->AnomalyIntensity;
        }
    }

    // 2. Линейная интерполяция между min и max по позиции в DepthRange
    const float Alpha = GetDepthAlpha(FloorIndex);  // 0.0 в начале уровня, 1.0 в конце
    return FMath::Lerp(AnomalyIntensity.GetLowerBoundValue(),
                       AnomalyIntensity.GetUpperBoundValue(),
                       Alpha);
}

float ULevelProfileDataAsset::GetDepthAlpha(int32 FloorIndex) const
{
    // DepthRange = (floorMin, floorMax), оба отрицательные, floorMin > floorMax
    // например, DepthRange = (-21, -31): -21 это начало уровня, -31 это конец
    const int32 FloorMin = DepthRange.X;
    const int32 FloorMax = DepthRange.Y;
    if (FloorMin == FloorMax) return 0.0f;
    return float(FloorMin - FloorIndex) / float(FloorMin - FloorMax);
}
```

**Пример:** для DeepWilds (DepthRange = (-21, -31), AnomalyIntensity = (0.1, 0.3)):
- На -21: alpha = 0.0, AnomalyIntensity = 0.1
- На -26: alpha = 0.5, AnomalyIntensity = 0.2
- На -31: alpha = 1.0, AnomalyIntensity = 0.3

### 3.3 Структура FFloorOverride

```cpp
USTRUCT(BlueprintType)
struct FFloorOverride
{
    GENERATED_BODY()

    // Каждое поле override'ится только если соответствующий bool == true.
    // Это позволяет override'ить конкретные параметры, не трогая остальные.

    UPROPERTY(EditAnywhere) bool bAnomalyIntensityOverridden = false;
    UPROPERTY(EditAnywhere, meta=(EditCondition="bAnomalyIntensityOverridden"))
    float AnomalyIntensity = 0.0f;

    UPROPERTY(EditAnywhere) bool bArtifactDensityOverridden = false;
    UPROPERTY(EditAnywhere, meta=(EditCondition="bArtifactDensityOverridden"))
    float ArtifactDensity = 0.0f;

    UPROPERTY(EditAnywhere) bool bNodeDensityOverridden = false;
    UPROPERTY(EditAnywhere, meta=(EditCondition="bNodeDensityOverridden"))
    float NodeDensity = 0.0f;

    UPROPERTY(EditAnywhere) bool bHubChanceOverridden = false;
    UPROPERTY(EditAnywhere, meta=(EditCondition="bHubChanceOverridden"))
    float HubChance = 0.0f;

    UPROPERTY(EditAnywhere) bool bStructuralDensityOverridden = false;
    UPROPERTY(EditAnywhere, meta=(EditCondition="bStructuralDensityOverridden"))
    float StructuralDensity = 0.0f;

    // Описание override для самодокументации
    UPROPERTY(EditAnywhere)
    FString OverrideReason;     // "Особый этаж: плато DeepFreeze с экстремальным холодом"
};
```

FloorOverride — **редкий инструмент**. Если для уровня нужно много override'ов, это значит, что **уровень должен быть разделён** на два LevelProfile.

---

## 4. Структура UWorldMapDataAsset

### 4.1 Полные поля

```cpp
UCLASS(BlueprintType)
class CURSEDPIT_API UWorldMapDataAsset : public UDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    FString WorldMapName;                         // "Submersion_MVP", "Campaign_MVP"

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Identity")
    EGameMode TargetMode;                         // Submersion / Campaign

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Floors")
    TArray<FFloorMapping> FloorMappings;          // отсортированы по убыванию (от -1 к -60)

public:
    /** Вернуть mapping для конкретного этажа, или nullptr */
    const FFloorMapping* GetMappingForFloor(int32 FloorIndex) const;

    /** Вернуть LevelProfile для этажа (nullptr если этаж ручной) */
    ULevelProfileDataAsset* GetProfileForFloor(int32 FloorIndex) const;

    /** Вернуть ссылку на ручной уровень (nullptr если этаж процедурный) */
    TSoftObjectPtr<UWorld> GetHandcraftedLevelForFloor(int32 FloorIndex) const;

    /** Является ли этаж ручным */
    bool IsHandcraftedFloor(int32 FloorIndex) const;
};

USTRUCT(BlueprintType)
struct FFloorMapping
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere) int32 FloorIndex;
    UPROPERTY(EditAnywhere) EFloorKind Kind;      // Procedural / Handcrafted

    // Только для Procedural
    UPROPERTY(EditAnywhere, meta=(EditCondition="Kind == EFloorKind::Procedural"))
    TObjectPtr<ULevelProfileDataAsset> LevelProfile;

    // Только для Handcrafted
    UPROPERTY(EditAnywhere, meta=(EditCondition="Kind == EFloorKind::Handcrafted"))
    TSoftObjectPtr<UWorld> HandcraftedLevel;

    // Опциональное лорное имя этажа (для UI/дебага)
    UPROPERTY(EditAnywhere)
    FString FloorName;                            // "Темница", "Final Floor: дверь"
};
```

### 4.2 Почему отдельный WorldMap

- **Чистая работа с ручными локациями** — они не подчиняются LevelProfile вообще, что лорно и геймплейно правильно.
- **Раздельные карты для режимов** — у "Истории" может быть отдельная WorldMap с CampaignOnly профилями.
- **Лёгкая ревизия структуры мира** — открыл один asset, увидел всю карту.
- **Тестовые WorldMap** — для отладки можно сделать `WorldMap_TestSingleProfile` с одним этажом одного профиля.

---

## 5. Полный набор LevelProfile для MVP

Все LevelProfile для режима "Погружение". CampaignOnly = false для всех.

### 5.1 UpperGarrison (-2 ... -5)

Гномье техническое подземелье, контролируемое человеческим гарнизоном. Чистая архитектура, регулярные узлы.

- **Origin:** DwarvenTech
- **TemperatureZone:** Cooling
- **AnomalyIntensity:** (0.0, 0.0)
- **ArtifactDensity:** (0.2, 0.25) — низкая, регулярная
- **NodeDensity:** (0.7, 0.6) — высокая, обслуживается
- **HubChance:** (0.2, 0.15)
- **StructuralDensity:** (0.05, 0.08) — почти нет провалов
- **AllowedMaterials:** {Stone: 0.5, DwarvenMetal: 1.0, Crystal: 0.1}
- **AllowedSpaceTypes:** {Hall: 1.0, Corridor: 1.0, Shaft: 0.3}
- **AllowedOccupants:** {HumanGarrison: 1.0, None: 0.3}
- **AvailableNodeTypes:** {Charge: 0.5, Repair: 1.0, Healing: 0.8, Rest: 0.5}
- **EntrySpaceType:** Hall
- **ExitSpaceType:** Shaft

### 5.2 GoblinHalls (-6 ... -11)

Заброшенная гномья инфраструктура, занятая гоблинами и крысолюдами. Захваченные узлы.

- **Origin:** DwarvenTech
- **TemperatureZone:** Cooling
- **AnomalyIntensity:** (0.0, 0.05)
- **ArtifactDensity:** (0.3, 0.5)
- **NodeDensity:** (0.4, 0.3)
- **HubChance:** (0.1, 0.05)
- **StructuralDensity:** (0.08, 0.12)
- **AllowedMaterials:** {Stone: 1.0, DwarvenMetal: 0.7, Ice: 0.1}
- **AllowedSpaceTypes:** {Hall: 0.8, Corridor: 1.0, Shaft: 0.4, Cavern: 0.3, Maze: 0.5}
- **AllowedOccupants:** {Goblins: 1.0, Ratfolk: 0.7, None: 0.3}
- **AvailableNodeTypes:** {Charge: 0.3, Repair: 0.5, Healing: 0.5, Rest: 0.3}

### 5.3 FrontierCaves (-12 ... -20)

Граница между гномьей инфраструктурой и природной системой пещер. Появляются DeepHostile.

- **Origin:** Natural
- **TemperatureZone:** Cooling
- **AnomalyIntensity:** (0.1, 0.3)
- **ArtifactDensity:** (0.5, 0.7)
- **NodeDensity:** (0.3, 0.2)
- **HubChance:** (0.05, 0.05)
- **StructuralDensity:** (0.12, 0.15)
- **AllowedMaterials:** {Stone: 1.0, DwarvenMetal: 0.3, Ice: 0.3, Crystal: 0.2}
- **AllowedSpaceTypes:** {Cavern: 1.0, Corridor: 0.7, Maze: 0.6, Chasm: 0.5, Hall: 0.3, Shaft: 0.3}
- **AllowedOccupants:** {Ratfolk: 0.7, DeepHostile: 0.6, HumanExiles: 0.3, DwarvenRemains: 0.2, None: 0.4}
- **AvailableNodeTypes:** {Charge: 0.3, Repair: 0.3, Healing: 0.3, Rest: 0.5}

### 5.4 DeepWilds (-21 ... -31)

Чистая природа с редкими изношенными гномьими руинами. Самая опасная зона перед плато холода.

- **Origin:** Natural
- **TemperatureZone:** Cooling
- **AnomalyIntensity:** (0.2, 0.3)
- **ArtifactDensity:** (0.7, 0.5) — снижается к DeepFreeze
- **NodeDensity:** (0.2, 0.1)
- **HubChance:** (0.03, 0.0)
- **StructuralDensity:** (0.15, 0.2)
- **AllowedMaterials:** {Stone: 1.0, Ice: 0.5, Crystal: 0.3, DwarvenMetal: 0.2}
- **AllowedSpaceTypes:** {Cavern: 1.0, Chasm: 0.6, Maze: 0.7, Corridor: 0.3, Shaft: 0.4}
- **AllowedOccupants:** {DeepHostile: 1.0, DwarvenRemains: 0.4, None: 0.5}
- **AvailableNodeTypes:** {Charge: 0.2, Repair: 0.2, Healing: 0.3, Rest: 0.3}

### 5.5 DeepFreeze (-32 ... -34)

Плато экстремального холода. Без узлов, минимум артефактов, только ледяные адаптированные формы.

- **Origin:** Natural
- **TemperatureZone:** DeepFreeze
- **AnomalyIntensity:** (0.4, 0.4)
- **ArtifactDensity:** (0.3, 0.3)
- **NodeDensity:** (0.05, 0.0)
- **HubChance:** (0.0, 0.0)
- **StructuralDensity:** (0.2, 0.2)
- **AllowedMaterials:** {Ice: 1.0, Stone: 0.5, DwarvenMetal: 0.1}
- **AllowedSpaceTypes:** {Cavern: 1.0, Chasm: 0.7, Shaft: 0.4, Corridor: 0.3, Maze: 0.3}
- **AllowedOccupants:** {DeepHostile: 1.0, DwarvenRemains: 0.2, None: 0.6}
- **AvailableNodeTypes:** {Rest: 0.2} — почти ничего

### 5.6 ReheatingWilds (-35 ... -44)

Природа с разогревом. Появляется Organic, гномьи узлы снова работают (горячая зона). DwarvenLiving только в "Истории".

- **Origin:** Natural
- **TemperatureZone:** Reheating
- **AnomalyIntensity:** (0.5, 0.7)
- **ArtifactDensity:** (0.7, 0.9)
- **NodeDensity:** (0.3, 0.5)
- **HubChance:** (0.05, 0.1)
- **StructuralDensity:** (0.15, 0.18)
- **AllowedMaterials:** {Stone: 1.0, Crystal: 0.5, DwarvenMetal: 0.3, Organic: 0.4}
- **AllowedSpaceTypes:** {Cavern: 1.0, Chasm: 0.5, Maze: 0.6, Corridor: 0.4, Hall: 0.3, Shaft: 0.4}
- **AllowedOccupants:** {DeepHostile: 1.0, HumanExiles: 0.5, DwarvenRemains: 0.3, None: 0.4}
- **AvailableNodeTypes:** {Charge: 0.5, Repair: 0.3, Healing: 0.5, Rest: 0.3}

### 5.7 EndgamePeak (-45 ... -50)

Архитектурная кульминация: второй гномий город, занятый врагами. Пик опасности всей игры. Размеры этажей увеличены (контролируется на уровне генератора, не LevelProfile).

- **Origin:** DwarvenResidential
- **TemperatureZone:** Reheating
- **AnomalyIntensity:** (0.7, 0.9)
- **ArtifactDensity:** (0.9, 1.0)
- **NodeDensity:** (0.5, 0.4) — некоторые работают, некоторые захвачены
- **HubChance:** (0.15, 0.2)
- **StructuralDensity:** (0.1, 0.12)
- **AllowedMaterials:** {DwarvenMetal: 1.0, Stone: 0.5, Crystal: 0.6, Organic: 0.3}
- **AllowedSpaceTypes:** {Hall: 1.0, Corridor: 0.7, Cavern: 0.5, Maze: 0.4, Shaft: 0.4, Chasm: 0.3}
- **AllowedOccupants:** {DeepHostile: 1.0, DwarvenRemains: 0.3, None: 0.2}
- **AvailableNodeTypes:** {Charge: 1.0, Repair: 0.7, Healing: 0.7, Rest: 0.5}
- **AdjacencyOverrides:** {(Maze, Chasm): 0.3} — разрешить редкое сочетание для "невозможной геометрии" эндгейма

### 5.8 EndgamePath (-51 ... -55)

Атмосферная переходная зона. Малая плотность врагов, нарастающие голоса гномов. Архитектура постепенно становится более резидентной.

- **Origin:** DwarvenTech
- **TemperatureZone:** Reheating
- **AnomalyIntensity:** (0.6, 0.5) — снижается к гномьей территории
- **ArtifactDensity:** (0.8, 0.7)
- **NodeDensity:** (0.5, 0.7)
- **HubChance:** (0.1, 0.15)
- **StructuralDensity:** (0.08, 0.06)
- **AllowedMaterials:** {DwarvenMetal: 1.0, Stone: 0.4, Crystal: 0.4}
- **AllowedSpaceTypes:** {Hall: 1.0, Corridor: 1.0, Shaft: 0.5, Cavern: 0.3}
- **AllowedOccupants:** {DeepHostile: 0.3, DwarvenRemains: 0.5, None: 1.0}
- **AvailableNodeTypes:** {Charge: 0.7, Repair: 0.7, Healing: 0.5, Rest: 0.7}

### 5.9 BattleTraces (-56 ... -57)

Этажи следов борьбы между гномами и hostiles. Повреждённый DwarvenTech, прорвавшиеся враги.

- **Origin:** DwarvenTech
- **TemperatureZone:** Reheating
- **AnomalyIntensity:** (0.6, 0.8) — вокруг повреждённых узлов
- **ArtifactDensity:** (0.9, 1.0)
- **NodeDensity:** (0.4, 0.3) — много повреждённых
- **HubChance:** (0.05, 0.05)
- **StructuralDensity:** (0.1, 0.15)
- **AllowedMaterials:** {DwarvenMetal: 1.0, Stone: 0.4, Crystal: 0.3}
- **AllowedSpaceTypes:** {Hall: 1.0, Corridor: 0.8, Cavern: 0.4, Maze: 0.3, Shaft: 0.3, Chasm: 0.4}
- **AllowedOccupants:** {DeepHostile: 0.7, DwarvenRemains: 1.0, None: 0.4}
- **AvailableNodeTypes:** {Charge: 0.5, Repair: 0.3, Healing: 0.3, Rest: 0.3}

### 5.10 DwarvenHalls (-58 ... -59)

Активные гномьи залы — зеркало темницы (-1). Чистая гномья архитектура. Защитные системы работают. Малая плотность hostile.

- **Origin:** DwarvenResidential
- **TemperatureZone:** Reheating
- **AnomalyIntensity:** (0.8, 0.9)
- **ArtifactDensity:** (1.0, 1.0)
- **NodeDensity:** (0.7, 0.8)
- **HubChance:** (0.2, 0.25)
- **StructuralDensity:** (0.05, 0.05)
- **AllowedMaterials:** {DwarvenMetal: 1.0, Stone: 0.3, Crystal: 0.7}
- **AllowedSpaceTypes:** {Hall: 1.0, Corridor: 1.0, Shaft: 0.4}
- **AllowedOccupants:** {DwarvenRemains: 0.3, None: 1.0} — почти нет врагов
- **AvailableNodeTypes:** {Charge: 1.0, Repair: 0.8, Healing: 0.7, Rest: 0.7}

---

## 6. WorldMap для "Погружения" (MVP)

Полное содержимое `WorldMap_Submersion_MVP`:

| FloorIndex | Kind | LevelProfile / HandcraftedLevel | FloorName |
|------------|------|----------------------------------|-----------|
| -1 | Handcrafted | `Dungeon_L01` (UWorld asset) | Темница |
| -2 | Procedural | UpperGarrison | Верхний гарнизон |
| -3 | Procedural | UpperGarrison | Верхний гарнизон |
| -4 | Procedural | UpperGarrison | Верхний гарнизон |
| -5 | Procedural | UpperGarrison | Верхний гарнизон |
| -6 | Procedural | GoblinHalls | Гоблиньи коридоры |
| -7 | Procedural | GoblinHalls | Гоблиньи коридоры |
| ... | ... | ... | ... |
| -11 | Procedural | GoblinHalls | Гоблиньи коридоры |
| -12 | Procedural | FrontierCaves | Дикие пещеры |
| ... | ... | ... | ... |
| -20 | Procedural | FrontierCaves | Дикие пещеры |
| -21 | Procedural | DeepWilds | Глубокая дичь |
| ... | ... | ... | ... |
| -31 | Procedural | DeepWilds | Глубокая дичь |
| -32 | Procedural | DeepFreeze | Замёрзшее плато |
| -33 | Procedural | DeepFreeze | Замёрзшее плато |
| -34 | Procedural | DeepFreeze | Замёрзшее плато |
| -35 | Procedural | ReheatingWilds | Раскалённая дичь |
| ... | ... | ... | ... |
| -44 | Procedural | ReheatingWilds | Раскалённая дичь |
| -45 | Procedural | EndgamePeak | Пик опасности |
| ... | ... | ... | ... |
| -50 | Procedural | EndgamePeak | Пик опасности |
| -51 | Procedural | EndgamePath | Путь к двери |
| ... | ... | ... | ... |
| -55 | Procedural | EndgamePath | Путь к двери |
| -56 | Procedural | BattleTraces | Следы битв |
| -57 | Procedural | BattleTraces | Следы битв |
| -58 | Procedural | DwarvenHalls | Гномьи залы |
| -59 | Procedural | DwarvenHalls | Гномьи залы |
| -60 | Handcrafted | `FinalFloor_L60` (UWorld asset) | Дверь |

**Итого:** 10 LevelProfile + 2 ручных уровня = 12 элементов мира.

---

## 7. WorldMap для "Истории" (концептуально)

`WorldMap_Campaign_MVP` (отдельный asset, **в MVP не реализуется**, но архитектурно учитывается):

Отличия от Submersion WorldMap:

- Этаж 0 — ручная локация (город), доступна до точки невозврата
- Допустимые Occupant'ы в каждом профиле могут включать `DwarvenLiving` (CampaignOnly)
- Могут существовать CampaignOnly-профили, недоступные в "Погружении"
- Final Floor (-60) использует другой Handcrafted UWorld — версию с открытой дверью и последующей зоной

В MVP создаётся только `WorldMap_Submersion_MVP`. Архитектура поддерживает добавление `WorldMap_Campaign_MVP` без переписывания кода.

---

## 8. Использование в коде

### 8.1 Точка входа

```cpp
// В RunSessionManager (короткоживущий, текущая сессия)
void URunSessionManager::EnterFloor(int32 FloorIndex)
{
    const UWorldMapDataAsset* WorldMap = GetActiveWorldMap();  // зависит от режима
    const FFloorMapping* Mapping = WorldMap->GetMappingForFloor(FloorIndex);

    if (!Mapping)
    {
        UE_LOG(LogCursedPit, Error, TEXT("No mapping for floor %d"), FloorIndex);
        return;
    }

    if (Mapping->Kind == EFloorKind::Handcrafted)
    {
        LoadHandcraftedLevel(Mapping->HandcraftedLevel);
        return;
    }

    // Procedural path
    ULevelProfileDataAsset* Profile = Mapping->LevelProfile;
    int32 Seed = ComputeSeedForFloor(FloorIndex);
    GenerateFloorProcedurally(FloorIndex, Profile, Seed);
}
```

### 8.2 Получение параметров в фазах генерации

```cpp
// В PopulateCells:
const float AnomIntensity = Profile->GetAnomalyIntensityForFloor(FloorIndex);
const float StructDensity = Profile->GetStructuralDensityForFloor(FloorIndex);
// ... использование

// В PlaceArtifacts:
const float ArtifactDensity = Profile->GetArtifactDensityForFloor(FloorIndex);
// ... использование

// В PlaceNodes:
const float NodeDensity = Profile->GetNodeDensityForFloor(FloorIndex);
const float HubChance = Profile->GetHubChanceForFloor(FloorIndex);
// ... использование
```

### 8.3 Детерминизм

`ComputeSeedForFloor(FloorIndex)` — детерминированная функция от глобального seed и FloorIndex. При одинаковом глобальном seed (как в "Истории" с CampaignManager) этаж сгенерируется одинаково при повторном посещении.

---

## 9. Что цементируется этим документом

1. LevelProfile описывает **тематический уровень** (несколько этажей), не отдельный этаж.
2. Скаляры интерполируются по FloorIndex внутри DepthRange; веса фиксированы на уровень.
3. FloorOverrides — точечный инструмент для редких исключений, не для систематических вариаций.
4. Гибридная декомпозиция DataAsset'ов: LevelProfile содержит всё, кроме shared AdjacencyRules.
5. WorldMap отделён от LevelProfile — отдельный DataAsset со связью "этаж → профиль".
6. Ручные локации — вне системы LevelProfile, обрабатываются через `Kind = Handcrafted` в WorldMap.
7. Origin — single value на профиль. Смешанные зоны решаются разделением на два профиля.
8. MVP "Погружения" использует **10 процедурных LevelProfile + 2 ручных уровня**.

---

## 10. Что НЕ фиксируется

- Точные значения весов и скаляров — приведённые в разделе 5 числа являются **отправной точкой**, подлежат балансировке через playtest.
- Структура `UOccupantPoolDataAsset` (как именно Occupant раскладывается в конкретных существ) — задача для документа AssignOccupants (#12).
- Структура `UAdjacencyRulesDataAsset` — следует напрямую из adjacency_rules.md, прописывается при реализации.
- WorldMap для "Истории" — на этапе MVP не реализуется, проектируется позже.
- Структура ручных уровней (UWorld assets для темницы и Final Floor) — задача отдельных документов (dungeon_location.md уже частично покрывает темницу).
- UI debug-режим для визуализации LevelProfile на этаже.

---

## 11. Открытые вопросы

1. **Смешанные Origin внутри уровня.** Сейчас зафиксирована модель single-Origin: смешанные зоны (например, "DwarvenTech + Natural" во FrontierCaves) решаются через **доминирующий** Origin и вторичные элементы через decals/details. Стоит ли в будущем добавить secondary Origin с весом? — отложено до playtest.

2. **Балансировка скаляров.** Все значения в разделе 5 — отправная точка. После реализации генератора и первых тестов веса и плотности будут корректироваться. Это **ожидаемая итерация**, не недостаток дизайна.

3. **Связь с реальной формулой температуры.** Сейчас температура — глобальная формула от FloorIndex (см. environment.md, п. 8). LevelProfile хранит только TemperatureZone (enum). Если потребуется тонкая настройка температуры внутри уровня — добавим FloatRange для температуры. Пока избыточно.

4. **OccupantPool DataAsset.** Решение, как именно Occupant разворачивается в конкретные существа (Goblin = Skirmisher + Brute + Ranged), — задача документа AssignOccupants (#12). LevelProfile хранит только Map<Occupant, Weight>; разворачивание происходит в фазе AssignOccupants.

5. **Tooling для редактирования.** В UE5 редактирование 10 LevelProfile DataAsset'ов через стандартный inspector работоспособно, но для удобной балансировки в перспективе нужен **custom asset editor**, отображающий распределение скаляров по глубине графически. — отложено до MVP-полировки.

---

## 12. Следующие шаги

1. Реализовать `ULevelProfileDataAsset`, `UWorldMapDataAsset`, `UAdjacencyRulesDataAsset` в C++ (Claude Code).
2. Создать перечисления `EOrigin`, `EMaterial`, `ESpaceType`, `EOccupant`, `ETemperatureZone`, `ENodeType`, `EGameMode`, `EFloorKind` (если ещё не созданы).
3. Создать 10 DataAsset'ов LevelProfile с параметрами из раздела 5.
4. Создать `WorldMap_Submersion_MVP` DataAsset со всеми 60 floor mapping'ами.
5. Создать `AdjacencyRules_Default` DataAsset на основе матрицы из adjacency_rules.md.
6. Реализовать `PopulateCells` (#11), используя LevelProfile + AdjacencyRules.
7. Перейти к `AssignOccupants` (#12) — следующая фаза.
