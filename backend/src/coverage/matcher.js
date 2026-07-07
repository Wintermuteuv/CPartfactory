function depthInRange(depth, range) {
  if (!Array.isArray(range) || range.length !== 2) return true;
  const [shallow, deep] = range;
  return deep <= depth && depth <= shallow;
}

function axisMatches(allowed, value) {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return value != null && allowed.includes(value);
}

export function sidecarMatchesItem(sidecar, item) {
  const axes = sidecar?.axes;
  if (!axes) return false;
  const m = item.match ?? {};
  if (!axisMatches(m.material,  axes.material))  return false;
  if (!axisMatches(m.spaceType, axes.spaceType)) return false;
  if (!axisMatches(m.origin,    axes.origin))    return false;
  if (!axisMatches(m.occupant,  axes.occupant))  return false;
  if (!axisMatches(m.lighting,  axes.lighting))  return false;
  if (!depthInRange(axes.depth, item.depthRange)) return false;
  return true;
}

export function isExternalSidecar(sidecar) {
  if (!sidecar) return false;
  if (sidecar.external === true) return true;
  if (sidecar.stage === 'external_final' || sidecar.stage === 'external') return true;
  if (sidecar.provider && sidecar.provider !== 'local') return true;
  return false;
}
