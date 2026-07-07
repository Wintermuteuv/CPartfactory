// PromptOptimizer — model-specific post-processing layer.
//
// Pipeline position:  Loader → Validator → PromptBuilder → [PromptOptimizer] → Generator
//
// PromptBuilder stays a dumb assembler that turns axes into ordered `sections`.
// PromptOptimizer holds model-specific knowledge (SDXL today, Flux later) and
// reshapes those sections without the game model needing to know about it.
//
// SDXL pipeline stages:
//   A3 — conflict resolution driven by config/optimizer_rules.json
//   A2 — deduplication of repeated descriptors across sections
//   A4 — NearDark light boost + enforce canonical section order
// All stages operate on a deep copy of the builder's sections and log what they
// did into `notes[]` (surfaced in the sidecar for reproducibility).

// Canonical section order the optimizer converges toward.
// Keep in sync with promptBuilder's section order (single visual contract).
export const CANONICAL_ORDER = [
  'camera',
  'lighting',
  'lightingSource',
  'spaceType',
  'origin',
  'condition',
  'material',
  'biomass',
  'occupant',
  'thermal',
  'anomaly',
  'baseStyle',
];

function cloneSections(sections) {
  return (Array.isArray(sections) ? sections : []).map((s) => ({ key: s.key, text: s.text }));
}

function splitDescriptors(text) {
  return String(text ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function norm(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function recompose(sections) {
  return sections
    .map((s) => (s?.text ?? '').trim())
    .filter((t) => t.length > 0)
    .join(', ');
}

// ---- A3: conflict resolution -------------------------------------------------

function conditionMatches(when, ctx) {
  for (const [key, cond] of Object.entries(when ?? {})) {
    const actual = ctx[key];
    if (Array.isArray(cond)) {
      if (!cond.includes(actual)) return false;
    } else if (cond && typeof cond === 'object') {
      // numeric range: { min?, max? }
      if (typeof actual !== 'number') return false;
      if (cond.min != null && actual < cond.min) return false;
      if (cond.max != null && actual > cond.max) return false;
    } else if (actual !== cond) {
      return false;
    }
  }
  return true;
}

function applyConflictRules(sections, ctx, rules, notes) {
  const active = (rules ?? []).filter((r) => conditionMatches(r.when, ctx));
  if (active.length === 0) return sections;

  let out = sections;

  for (const rule of active) {
    // remove whole sections by key
    if (Array.isArray(rule.removeSections) && rule.removeSections.length > 0) {
      out = out.filter((s) => {
        if (rule.removeSections.includes(s.key)) {
          notes.push({ stage: 'conflict', rule: rule.id, action: 'removeSection', section: s.key });
          return false;
        }
        return true;
      });
    }

    // remove descriptors containing any of the given tokens (substring, case-insensitive)
    const removeTokens = (rule.remove ?? []).map(norm).filter(Boolean);
    // replace substrings within descriptors: [{ from, to }]
    const replaces = Array.isArray(rule.replace) ? rule.replace : [];

    if (removeTokens.length > 0 || replaces.length > 0) {
      out = out.map((s) => {
        let descriptors = splitDescriptors(s.text);

        if (removeTokens.length > 0) {
          descriptors = descriptors.filter((d) => {
            const nd = norm(d);
            const hit = removeTokens.some((tok) => nd.includes(tok));
            if (hit) notes.push({ stage: 'conflict', rule: rule.id, action: 'remove', section: s.key, removed: d });
            return !hit;
          });
        }

        if (replaces.length > 0) {
          descriptors = descriptors.map((d) => {
            let nd = d;
            for (const { from, to } of replaces) {
              if (!from) continue;
              const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
              if (re.test(nd)) {
                notes.push({ stage: 'conflict', rule: rule.id, action: 'replace', section: s.key, from, to });
                nd = nd.replace(re, to ?? '');
              }
            }
            return nd.trim();
          }).filter(Boolean);
        }

        return { ...s, text: descriptors.join(', ') };
      }).filter((s) => s.text.length > 0);
    }
  }

  return out;
}

// ---- A2: deduplication -------------------------------------------------------

function dedupe(sections, notes) {
  const seen = new Set();
  return sections
    .map((s) => {
      const kept = [];
      for (const d of splitDescriptors(s.text)) {
        const nd = norm(d);
        if (seen.has(nd)) {
          notes.push({ stage: 'dedupe', section: s.key, removed: d });
          continue;
        }
        seen.add(nd);
        kept.push(d);
      }
      return { ...s, text: kept.join(', ') };
    })
    .filter((s) => s.text.length > 0);
}

// ---- A4: light boost + canonical ordering ------------------------------------

const NEAR_DARK_BOOST =
  'extremely short light radius, deep crushing shadows, light falling off within a single step, the vast majority of the frame lost in pitch black';

function boostNearDark(sections, ctx, notes) {
  if (ctx.lighting !== 'NearDark') return sections;
  let applied = false;
  const out = sections.map((s) => {
    if (s.key === 'lightingSource') {
      applied = true;
      return { ...s, text: `${s.text}, ${NEAR_DARK_BOOST}` };
    }
    return s;
  });
  if (applied) notes.push({ stage: 'lightBoost', section: 'lightingSource', added: 'near-dark falloff' });
  return out;
}

function enforceOrder(sections) {
  const rank = (key) => {
    const i = CANONICAL_ORDER.indexOf(key);
    return i === -1 ? CANONICAL_ORDER.length : i;
  };
  return sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.key) - rank(b.s.key) || a.i - b.i)
    .map(({ s }) => s);
}

// ---- SDXL optimizer ----------------------------------------------------------

function optimizeSDXL(built, selection, config) {
  const notes = [];
  const ctx = {
    ...selection,
    thermalZone: built.derived?.thermalZone ?? null,
    anomalyIntensity: built.derived?.anomalyIntensity ?? null,
    biomassIntensity: built.derived?.biomassIntensity ?? null,
  };

  let sections = cloneSections(built.sections);
  sections = applyConflictRules(sections, ctx, config?.optimizerRules?.rules, notes); // A3
  sections = boostNearDark(sections, ctx, notes);                                     // A4 (light)
  sections = dedupe(sections, notes);                                                 // A2
  sections = enforceOrder(sections);                                                  // A4 (order)

  const positive = sections.length > 0 ? recompose(sections) : built.positive;

  return {
    ...built,
    positive,
    sections,
    notes,
    optimizer: { model: 'sdxl', version: 2, applied: notes.map((n) => n.stage) },
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
  const known = Object.prototype.hasOwnProperty.call(OPTIMIZERS, model);
  const out = (known ? OPTIMIZERS[model] : OPTIMIZERS.sdxl)(built, selection, config);
  if (!known) {
    out.notes = out.notes ?? [];
    out.notes.unshift({ stage: 'warning', message: `unknown optimizer model "${model}", fell back to sdxl` });
  }
  return out;
}
