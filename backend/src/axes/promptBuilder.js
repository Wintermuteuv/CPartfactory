import { derive } from './depth.js';

function pickAnomalyModifier(intensity, modifiers) {
  if (intensity == null) return null;
  for (const m of modifiers) {
    if (intensity <= m.max) return m;
  }
  return modifiers[modifiers.length - 1] ?? null;
}

function phraseOf(axis, id) {
  return axis.byId.get(id)?.phrase ?? null;
}

export function buildPrompt(selection, config) {
  const { axes, baseStyle, rules, anomalyModifiers, thermalModifiers } = config;
  const depth = Number(selection.depth);
  const derived = derive(depth, rules);

  const lightingPhrase  = phraseOf(axes.lighting,  selection.lighting ?? 'Torches');
  const materialPhrase  = phraseOf(axes.material,  selection.material);
  const spacePhrase     = phraseOf(axes.spaceType, selection.spaceType);
  const originPhrase    = phraseOf(axes.origin,    selection.origin);
  const occupantPhrase  = phraseOf(axes.occupant,  selection.occupant);
  const anomalyMod      = pickAnomalyModifier(derived.anomalyIntensity, anomalyModifiers);
  const thermalMod      = derived.thermalZone ? thermalModifiers[derived.thermalZone] : null;

  // Ordered sections — single source of truth for prompt assembly.
  // PromptOptimizer works over this structure (dedup / conflict rules /
  // canonical ordering) instead of parsing the flat string.
  const sections = [
    { key: 'lighting',       text: baseStyle.lightingDirective },
    { key: 'lightingSource', text: lightingPhrase },
    { key: 'spaceType',      text: spacePhrase },
    { key: 'origin',         text: originPhrase },
    { key: 'material',       text: materialPhrase },
    { key: 'occupant',       text: occupantPhrase },
    { key: 'thermal',        text: thermalMod?.phrase ?? null },
    { key: 'anomaly',        text: anomalyMod?.phrase ?? null },
    { key: 'baseStyle',      text: baseStyle.positive },
  ].filter((s) => s.text && s.text.trim().length > 0);

  const positive = sections.map((s) => s.text).join(', ');
  const negative = baseStyle.negative;

  return {
    positive,
    negative,
    derived,
    sections,
    fragments: {
      lighting:  baseStyle.lightingDirective ?? null,
      lightingSource: lightingPhrase,
      material:  materialPhrase,
      spaceType: spacePhrase,
      origin:    originPhrase,
      occupant:  occupantPhrase,
      thermal:   thermalMod?.phrase ?? null,
      anomaly:   anomalyMod?.phrase ?? null,
      baseStyle: baseStyle.positive,
    },
  };
}
