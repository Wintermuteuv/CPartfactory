import { derive } from './depth.js';

function pickBandModifier(intensity, modifiers) {
  if (intensity == null) return null;
  for (const m of modifiers) {
    if (intensity <= m.max) return m;
  }
  return modifiers[modifiers.length - 1] ?? null;
}

function phraseOf(axis, id) {
  if (!axis || id == null) return null;
  return axis.byId.get(id)?.phrase ?? null;
}

function effectiveBiomass(selection, depthDerived) {
  const manual = selection.biomass;
  if (manual == null || manual === '') return { value: depthDerived, source: 'depth' };
  const n = Number(manual);
  if (Number.isNaN(n)) return { value: depthDerived, source: 'depth' };
  return { value: Math.max(0, Math.min(1, n)), source: 'manual' };
}

export function buildPrompt(selection, config) {
  const { axes, baseStyle, rules, anomalyModifiers, thermalModifiers, biomassModifiers } = config;
  const depth = Number(selection.depth);
  const derived = derive(depth, rules);

  const cameraPhrase    = phraseOf(axes.camera,    selection.camera);
  const lightingPhrase  = phraseOf(axes.lighting,  selection.lighting ?? 'Torches');
  const spacePhrase     = phraseOf(axes.spaceType, selection.spaceType);
  const originPhrase    = phraseOf(axes.origin,    selection.origin);
  const conditionPhrase = phraseOf(axes.condition, selection.condition);
  const materialPhrase  = phraseOf(axes.material,  selection.material);
  const occupantPhrase  = phraseOf(axes.occupant,  selection.occupant);
  const anomalyMod      = pickBandModifier(derived.anomalyIntensity, anomalyModifiers);
  const thermalMod      = derived.thermalZone ? thermalModifiers[derived.thermalZone] : null;

  // Biomass is a separate scalar driver (env.md §12 — mutated dwarven bio-reactors
  // live in high-anomaly zones). It defaults to the depth-derived value but can be
  // overridden per scene via selection.biomass.
  const bio = effectiveBiomass(selection, derived.biomassIntensity);
  const biomassMod = pickBandModifier(bio.value, biomassModifiers ?? []);

  // Effective derived values (reflect manual biomass override for UI/sidecar).
  const derivedOut = {
    ...derived,
    biomassIntensity: bio.value,
    biomassSource: bio.source,
  };

  // Ordered sections — single source of truth for prompt assembly.
  // PromptOptimizer works over this structure (conflict rules / dedup / ordering)
  // instead of parsing the flat string. Text is trimmed here so downstream
  // recomposition is a structural pass-through, not an accidental one.
  const sections = [
    { key: 'camera',         text: cameraPhrase },
    { key: 'lighting',       text: baseStyle.lightingDirective },
    { key: 'lightingSource', text: lightingPhrase },
    { key: 'spaceType',      text: spacePhrase },
    { key: 'origin',         text: originPhrase },
    { key: 'condition',      text: conditionPhrase },
    { key: 'material',       text: materialPhrase },
    { key: 'biomass',        text: biomassMod?.phrase ?? null },
    { key: 'occupant',       text: occupantPhrase },
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
      spaceType: spacePhrase,
      origin:    originPhrase,
      occupant:  occupantPhrase,
      thermal:   thermalMod?.phrase ?? null,
      anomaly:   anomalyMod?.phrase ?? null,
      baseStyle: baseStyle.positive,
    },
  };
}
