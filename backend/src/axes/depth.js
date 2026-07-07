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

export function derive(depth, rules) {
  return {
    thermalZone: deriveThermalZone(depth, rules),
    anomalyIntensity: deriveAnomalyIntensity(depth, rules),
  };
}

export { depthInRange };
