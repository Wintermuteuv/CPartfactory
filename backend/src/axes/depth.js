function depthInRange(depth, range) {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const [shallow, deep] = range;
  return deep <= depth && depth <= shallow;
}

export function deriveThermalZone(depth, rules) {
  const hit = rules.thermalZones.find((z) => depthInRange(depth, z.range));
  return hit?.id ?? null;
}

export function deriveAnomalyIntensity(depth, rules) {
  const hit = rules.anomalyIntensity.find((b) => depthInRange(depth, b.range));
  if (!hit) return null;
  if (typeof hit.value === 'number') return hit.value;
  if (Array.isArray(hit.valueRange)) {
    const [shallow, deep] = hit.range;
    const span = shallow - deep;
    const t = span === 0 ? 0 : (shallow - depth) / span;
    const [vMin, vMax] = hit.valueRange;
    return Math.round((vMin + t * (vMax - vMin)) * 100) / 100;
  }
  return null;
}

export function deriveBiomassIntensity(depth, rules) {
  // Biomass tracks anomaly by default (env.md §12 — mutated dwarven bio-reactors
  // exist only in high-anomaly zones), but is exposed as its own derived value so
  // it can be overridden per scene in the builder.
  if (Array.isArray(rules.biomassIntensity)) {
    const hit = rules.biomassIntensity.find((b) => depthInRange(depth, b.range));
    if (hit) {
      if (typeof hit.value === 'number') return hit.value;
      if (Array.isArray(hit.valueRange)) {
        const [shallow, deep] = hit.range;
        const span = shallow - deep;
        const t = span === 0 ? 0 : (shallow - depth) / span;
        const [vMin, vMax] = hit.valueRange;
        return Math.round((vMin + t * (vMax - vMin)) * 100) / 100;
      }
    }
    return null;
  }
  return deriveAnomalyIntensity(depth, rules);
}

export function derive(depth, rules) {
  return {
    thermalZone: deriveThermalZone(depth, rules),
    anomalyIntensity: deriveAnomalyIntensity(depth, rules),
    biomassIntensity: deriveBiomassIntensity(depth, rules),
  };
}

// Shared contract for unit-interval override inputs (biomass, artifact, …).
// Returns { present, valid, value }:
//   present=false → no override supplied (use derived/default)
//   present=true, valid=false → supplied but rejected (bool/array/object/NaN/out-of-range)
//   present=true, valid=true → usable number in [0,1]
export function parseUnitScalar(value) {
  if (value == null) return { present: false, valid: true, value: null };
  if (typeof value === 'boolean' || typeof value === 'object') return { present: true, valid: false, value: null };
  const str = typeof value === 'string' ? value.trim() : value;
  if (str === '') return { present: false, valid: true, value: null };
  const n = Number(str);
  if (!Number.isFinite(n)) return { present: true, valid: false, value: null };
  if (n < 0 || n > 1) return { present: true, valid: false, value: n };
  return { present: true, valid: true, value: n };
}

export { depthInRange };
