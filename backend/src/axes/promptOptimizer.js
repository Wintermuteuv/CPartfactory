// PromptOptimizer — model-specific post-processing layer.
//
// Pipeline position:  Loader → Validator → PromptBuilder → [PromptOptimizer] → Generator
//
// PromptBuilder stays a dumb assembler that turns axes into ordered `sections`.
// PromptOptimizer holds model-specific knowledge (SDXL today, Flux later) and
// reshapes those sections without the game model needing to know about it.
//
// Phase A1 (current): pass-through skeleton + provider interface. It recomposes
// the prompt from `sections` (identical output to the builder) so it can be
// wired into every generation path safely, before any real transformations.
//
// Planned:
//   A2 — deduplication of repeated tokens across sections
//   A3 — conflict resolution driven by config/optimizer_rules.json
//   A4 — NearDark light boost + enforce canonical section order
//   B3 — Biomass/Corruption scalar injection

// Canonical section order the optimizer converges toward (A4 will enforce it).
export const CANONICAL_ORDER = [
  'lighting',
  'lightingSource',
  'spaceType',
  'origin',
  'material',
  'occupant',
  'thermal',
  'anomaly',
  'baseStyle',
];

function recompose(sections) {
  return sections
    .map((s) => (s?.text ?? '').trim())
    .filter((t) => t.length > 0)
    .join(', ');
}

/**
 * SDXL optimizer. Phase A1: pure pass-through.
 * Returns the built object augmented with { sections, notes, optimizer }.
 */
function optimizeSDXL(built, _selection, _config) {
  const notes = [];
  const sections = Array.isArray(built.sections) ? built.sections : [];
  const positive = sections.length > 0 ? recompose(sections) : built.positive;

  return {
    ...built,
    positive,
    sections,
    notes,
    optimizer: { model: 'sdxl', version: 1, applied: [] },
  };
}

const OPTIMIZERS = {
  sdxl: optimizeSDXL,
};

export function getOptimizer(model = 'sdxl') {
  return OPTIMIZERS[model] ?? OPTIMIZERS.sdxl;
}

/**
 * Apply the model-specific optimizer to a built prompt.
 * Safe on null/undefined (returns input unchanged) so callers can inline it.
 */
export function optimize(built, selection, config, model = 'sdxl') {
  if (!built) return built;
  return getOptimizer(model)(built, selection, config);
}
