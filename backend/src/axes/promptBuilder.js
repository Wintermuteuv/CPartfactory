import { derive, parseUnitScalar } from './depth.js';

function pickBandModifier(intensity, modifiers) {
  if (intensity == null) return null;
  for (const m of modifiers) {
    if (intensity <= m.max) return m;
  }
  return modifiers[modifiers.length - 1] ?? null;
}

// A value's prompt text: prefer atomic `tokens` (Phase D) over a legacy `phrase`.
function textOfValue(v) {
  if (!v) return null;
  if (Array.isArray(v.tokens) && v.tokens.length > 0) return v.tokens.join(', ');
  return v.phrase ?? null;
}

function phraseOf(axis, id) {
  if (!axis || id == null) return null;
  const v = axis.byId.get(id);
  return v ? textOfValue(v) : null;
}

// Effective value for a unit-interval driver: manual override wins when valid,
// otherwise fall back to the derived/default value (invalid overrides are ignored
// here — the validator reports them; under `force` we degrade gracefully).
function effectiveScalar(value, fallback, fallbackSource) {
  const p = parseUnitScalar(value);
  if (!p.present || !p.valid || p.value == null) return { value: fallback, source: fallbackSource };
  return { value: p.value, source: 'manual' };
}

export function buildPrompt(selection, config) {
  const {
    axes, baseStyle, rules,
    anomalyModifiers, thermalModifiers, biomassModifiers, artifactModifiers,
  } = config;
  const depth = Number(selection.depth);
  const derived = derive(depth, rules);

  const cameraPhrase    = phraseOf(axes.camera,    selection.camera);
  const lightingPhrase  = phraseOf(axes.lighting,  selection.lighting ?? 'Torches');
  const spacePhrase     = phraseOf(axes.spaceType, selection.spaceType);
  const originPhrase    = phraseOf(axes.origin,    selection.origin);
  const conditionPhrase = phraseOf(axes.condition, selection.condition);
  const materialPhrase  = phraseOf(axes.material,  selection.material);
  const occupantPhrase  = phraseOf(axes.occupant,  selection.occupant);
  const occupancyPhrase = phraseOf(axes.occupancy, selection.occupancy);
  const anomalyMod      = pickBandModifier(derived.anomalyIntensity, anomalyModifiers);
  const thermalMod      = derived.thermalZone ? thermalModifiers[derived.thermalZone] : null;

  // Biomass — depth-derived by default (env.md §12), overridable per scene.
  const bio = effectiveScalar(selection.biomass, derived.biomassIntensity, 'depth');
  const biomassMod = pickBandModifier(bio.value, biomassModifiers ?? []);

  // Artifact density — a purely authored dial (LevelProfile.ArtifactDensity is not a
  // depth formula), so it defaults to 0 and is set manually.
  const art = effectiveScalar(selection.artifact, 0, 'default');
  const artifactMod = pickBandModifier(art.value, artifactModifiers ?? []);

  const derivedOut = {
    ...derived,
    biomassIntensity: bio.value,
    biomassSource: bio.source,
    artifactIntensity: art.value,
    artifactSource: art.source,
  };

  // Ordered sections — single source of truth. PromptOptimizer works over this
  // structure (conflict rules / dedup / ordering). Text is trimmed here so
  // downstream recomposition is a structural pass-through.
  const sections = [
    { key: 'camera',         text: cameraPhrase },
    { key: 'lighting',       text: baseStyle.lightingDirective },
    { key: 'lightingSource', text: lightingPhrase },
    { key: 'spaceType',      text: spacePhrase },
    { key: 'origin',         text: originPhrase },
    { key: 'condition',      text: conditionPhrase },
    { key: 'material',       text: materialPhrase },
    { key: 'biomass',        text: biomassMod?.phrase ?? null },
    { key: 'artifact',       text: artifactMod?.phrase ?? null },
    { key: 'occupant',       text: occupantPhrase },
    { key: 'occupancy',      text: occupancyPhrase },
    { key: 'thermal',        text: thermalMod?.phrase ?? null },
    { key: 'anomaly',        text: anomalyMod?.phrase ?? null },
    { key: 'baseStyle',      text: baseStyle.positive },
  ]
    .map((s) => ({ key: s.key, text: (s.text ?? '').trim() }))
    .filter((s) => s.text.length > 0);

  const positive = sections.map((s) => s.text).join(', ');
  const negative = baseStyle.negative;

  return {
    positive,
    negative,
    derived: derivedOut,
    sections,
    fragments: {
      camera:    cameraPhrase,
      lighting:  baseStyle.lightingDirective ?? null,
      lightingSource: lightingPhrase,
      condition: conditionPhrase,
      material:  materialPhrase,
      biomass:   biomassMod?.phrase ?? null,
      artifact:  artifactMod?.phrase ?? null,
      spaceType: spacePhrase,
      origin:    originPhrase,
      occupant:  occupantPhrase,
      occupancy: occupancyPhrase,
      thermal:   thermalMod?.phrase ?? null,
      anomaly:   anomalyMod?.phrase ?? null,
      baseStyle: baseStyle.positive,
    },
  };
}
