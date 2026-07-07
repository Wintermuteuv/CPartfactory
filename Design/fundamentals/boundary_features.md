# Boundary Features — impassable continuations

**Статус:** Draft v0.1 — стаб для следующих итераций.
**Источник:** [`design/decisions/2026-05-19_worldscale_ecosystem.md`](../decisions/2026-05-19_worldscale_ecosystem.md).
**Pipeline:** Phase 4.5 (между PlaceArtifacts и PlaceNodes — точное место фиксируется в [ADR-012](../../adr/0012-boundary-features.md)).

---

## 1. Принцип

Playable cell-граф этажа — это **исследуемое подмножество** подземного пространства, не весь этаж. У playable пространства появляется третья категория границ:

| Категория | Что это |
|-----------|---------|
| Внутренние стены | Между cells, не соединённых connection |
| Внешние стены этажа | Периметр grid'а |
| **Impassable continuations** | Видимое продолжение подземелья, в которое игрок не может пройти |

Без третьей категории мир ощущается коробкой. С ней — частью большего пространства, в котором живёт population.

**Continuation — это логическая entity в графе**, не только decorate-объект на стене. Это означает:

- Имеет позицию (на какой стене какой cell), тип, набор свойств.
- Доступен AI-спавну как точка появления «враг приходит оттуда».
- Производит сенсорные эффекты (звук, запах, поток воздуха) на cells в радиусе.

---

## 2. Шесть базовых типов

| Тип | Нарратив | Уместен для Origin | AI-spawn |
|-----|----------|--------------------|----------|
| **Завал** | Раньше был проход, теперь нет. Что-то случилось давно. | Любой | — |
| **Узкая щель** | Пещера продолжается, но человек не пролезет. Отсюда выходят малые твари. | Natural, HumanFrontier | Ratfolk, мелкие DeepHostile |
| **Провал вниз** | Пол обрывается в темноту. Подкрепляет depth pressure. | Natural, HumanFrontier | DeepHostile (карабкаются снизу) |
| **Запечатанная гномья дверь** | Параллельная гномья сеть, недоступная людям. | DwarvenTech, DwarvenResidential | — (в «Истории» — точка сюжетного открытия) |
| **Затопленная секция** | Вода, ил, лёд. Видно, что там пространство. | Natural, DwarvenTech (повреждённый) | — (или специфические водные твари post-MVP) |
| **Активная опасность** | Постоянный пар, обвал, лава — путь в одну сторону смерти. | DwarvenTech (повреждённый), Reheating zone | — |

Веса типов в LevelProfile, выбор алгоритмом Phase 4.5.

---

## 3. Phase 4.5 — PlaceBoundaryFeatures (TBD)

Алгоритм:

1. Идёт по **внешним стенам** этажа (периметр grid) и по **внутренним стенам без connection** (между Visited cells).
2. На seeded подмножестве этих стен выбирает тип continuation, с весами из LevelProfile.AllowedBoundaryFeatures.
3. Создаёт `FBoundaryFeature` entity, добавляет в `FDungeonFloorPlan.BoundaryFeatures`.
4. Передаёт в Decorate (визуал) и в Phase 3a/AI (источники появления).

**Детали алгоритма — TBD** (target density, фильтр по соседним volumes, минимальное расстояние между continuations).

---

## 4. FBoundaryFeature struct (TBD)

Черновой набросок:

```cpp
UENUM(BlueprintType)
enum class EBoundaryFeatureKind : uint8
{
    Rubble       = 0 UMETA(DisplayName = "Завал"),
    NarrowCrack  = 1 UMETA(DisplayName = "Узкая щель"),
    PitDown      = 2 UMETA(DisplayName = "Провал вниз"),
    DwarvenSeal  = 3 UMETA(DisplayName = "Запечатанная дверь"),
    Flooded      = 4 UMETA(DisplayName = "Затопленная секция"),
    Hazard       = 5 UMETA(DisplayName = "Активная опасность"),
};

USTRUCT(BlueprintType)
struct CURSEDPIT_API FBoundaryFeature
{
    GENERATED_BODY()
    UPROPERTY() int32 CellIndex = -1;          // cell, on whose wall the feature sits
    UPROPERTY() EDirection Side;                // which wall of that cell
    UPROPERTY() EBoundaryFeatureKind Kind;
    UPROPERTY() FName FeatureId = NAME_None;    // unique within floor
    /** If this feature is a spawn anchor for AI -- which volume's encounter feeds from it. */
    UPROPERTY() int32 LinkedEncounterIndex = -1;
};
```

**Полная спецификация полей и методов — TBD.**

---

## 5. Связь с AI-спавном (TBD)

После Phase 4.5 спавн врагов перестаёт быть «из воздуха»:

- Враги приходят из **ближайшего подходящего** continuation.
- Ratfolk появляются из щелей и норок.
- DeepHostile — из провалов и затопленных секций.
- Это создаёт **читаемость экосистемы**: игрок видит нору → знает, что отсюда вылезут крысолюды.

**Алгоритм связки encounter ↔ continuation — TBD.** Скорее всего: для каждого `FPlannedEncounter` Phase 3a находит ближайший подходящий boundary feature по Occupant type, сохраняет `LinkedEncounterIndex` в feature.

---

## 6. Сенсорные эффекты (TBD)

Continuations производят passive cues:

- Звук (журчание воды, скрип щебня, далёкий рык).
- Поток воздуха (холодный/тёплый сквозняк из щели).
- Запах (TBD как технически — пока проработка концептуальная).

**Радиусы, типы эффектов per kind — TBD.** Часть будет реализована через `UAudioZoneSubsystem` (см. ADR-006 §10).

---

## 7. Что попадает в MVP

| Элемент | На MVP | Когда |
|---------|--------|-------|
| Базовые 6 типов continuations как entities | ✅ | Phase 4.5 реализация |
| Decorate визуализация continuations | ✅ | Phase 6 расширение |
| Спавн врагов привязан к continuations | ✅ | Phase 3a доработка |
| Сенсорные эффекты (звук, поток воздуха) | 🔶 | После AudioZone subsystem |
| Запах как механика | ⬜ | Post-MVP |
| Открытие гномьих дверей сюжетом | ⬜ | «История», не MVP |
| Водные твари из Flooded | ⬜ | Post-MVP |

---

## 8. Открытые вопросы

1. **SpaceType.Lair или флаг?** Нужен ли отдельный тип пространства для «логова» рядом с continuation, или это свойство существующего volume (Room + isLair=true).
2. **Стабильность continuations между забегами в «Истории».** Должны ли запечатанные двери конкретного этажа быть в одном месте от загрузки к загрузке, или генерироваться заново.
3. **Continuations как сюжетные точки в «Истории».** Может ли запечатанная гномья дверь открываться сюжетом, превращаясь в проход в новую авторскую локацию.
4. **Поведение AI рядом с гнездом.** Враги защищают гнездо агрессивнее? Возвращаются туда отдыхать?
5. **Видимость continuations на карте.** Игрок видит на карте, что в этом месте есть «что-то ещё», или это только sensory feedback в реальном времени.
6. **Density target в LevelProfile.** Сколько continuations на этаж? Per-100-cells как у encounters, или фиксированное число per-edge?

---

## 9. Связанные документы

- [`design/decisions/2026-05-19_worldscale_ecosystem.md`](../decisions/2026-05-19_worldscale_ecosystem.md) — source decision.
- [`design/fundamentals/ecosystem.md`](ecosystem.md) — экологический контекст: какой Occupant приходит из какого continuation.
- [ADR-012](../../adr/0012-boundary-features.md) — формализация Phase 4.5 (будет написан в заходе 2).
- [ADR-010](../../adr/0010-origin-driven-phase1-and-volumes.md) — Phase 4.5 встаёт в pipeline после Phase 4.
- [`design/fundamentals/environment.md`](environment.md) v0.6 — оси среды.
