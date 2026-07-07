import { derive, depthInRange, parseUnitScalar } from './depth.js';

function violation(rule, message, fields = {}) {
  return { severity: 'error', rule, message, ...fields };
}

function warning(rule, message, fields = {}) {
  return { severity: 'warning', rule, message, ...fields };
}

export function validateAxisIds(selection, config) {
  const issues = [];
  const OPTIONAL = new Set(['lighting', 'camera', 'condition', 'occupancy']);
  for (const axisKey of ['material', 'spaceType', 'origin', 'occupant', 'lighting', 'camera', 'condition', 'occupancy']) {
    const value = selection[axisKey];
    if (!value) {
      if (OPTIONAL.has(axisKey)) continue; // optional fine-tuning axes
      issues.push(violation('missing-axis', `${axisKey} is required`, { axis: axisKey }));
      continue;
    }
    const axis = config.axes[axisKey];
    if (!axis.byId.has(value)) {
      issues.push(violation('unknown-value', `${axisKey} value "${value}" is not in axes.json`, { axis: axisKey, value }));
    }
  }
  return issues;
}

export function validateCombination(selection, config) {
  const { rules } = config;
  const { material, origin, occupant } = selection;
  const depth = Number(selection.depth);
  const issues = [];

  if (!Number.isInteger(depth) || depth < -60 || depth > -1) {
    issues.push(violation('depth-out-of-range', `depth must be integer in [-60, -1], got ${selection.depth}`, { axis: 'depth', value: selection.depth }));
  }

  issues.push(...validateAxisIds(selection, config));

  if (issues.some((i) => i.severity === 'error' && i.rule === 'depth-out-of-range')) {
    return { ok: false, issues, derived: null };
  }

  const derived = derive(depth, rules);

  if (material && derived.thermalZone) {
    const matRule = rules.materialByThermalZone?.[derived.thermalZone];
    if (matRule?.forbidden?.includes(material)) {
      issues.push(violation('material-thermal-forbidden',
        `Material "${material}" is forbidden in thermal zone "${derived.thermalZone}"`,
        { axis: 'material', value: material, thermalZone: derived.thermalZone }));
    }
    const softMin = matRule?.softMinDepth?.[material];
    if (typeof softMin === 'number' && depth > softMin) {
      issues.push(warning('material-soft-min-depth',
        `Material "${material}" is implausible above depth ${softMin} in zone "${derived.thermalZone}" (current depth ${depth})`,
        { axis: 'material', value: material, softMinDepth: softMin, currentDepth: depth }));
    }
  }

  if (origin) {
    const r = rules.originDepthRange?.[origin]?.range;
    if (r && !depthInRange(depth, r)) {
      issues.push(violation('origin-depth-out-of-range',
        `Origin "${origin}" only valid in depth range [${r[0]}, ${r[1]}], got ${depth}`,
        { axis: 'origin', value: origin, range: r, currentDepth: depth, reason: rules.originDepthRange[origin].reason ?? null }));
    }
  }

  if (occupant) {
    const r = rules.occupantDepthRange?.[occupant]?.range;
    if (r && !depthInRange(depth, r)) {
      issues.push(violation('occupant-depth-out-of-range',
        `Occupant "${occupant}" only valid in depth range [${r[0]}, ${r[1]}], got ${depth}`,
        { axis: 'occupant', value: occupant, range: r, currentDepth: depth, reason: rules.occupantDepthRange[occupant].reason ?? null }));
    }
  }

  if (origin) {
    // validate the EFFECTIVE lighting (builder defaults to Torches when unset)
    const effLighting = selection.lighting ?? 'Torches';
    const lw = rules.lightingByOrigin?.[origin];
    if (lw?.warn?.includes(effLighting)) {
      issues.push(warning('lighting-origin-mismatch',
        `Lighting "${effLighting}" is implausible for origin "${origin}": ${lw.reason ?? ''}`,
        { axis: 'lighting', value: effLighting, origin }));
    }
  }

  for (const axisKey of ['biomass', 'artifact']) {
    const p = parseUnitScalar(selection[axisKey]);
    if (p.present && !p.valid) {
      issues.push(violation(`${axisKey}-out-of-range`,
        `${axisKey} override must be a number in [0, 1], got ${JSON.stringify(selection[axisKey])}`,
        { axis: axisKey, value: selection[axisKey] }));
    }
  }

  if (selection.occupancy && (occupant === 'None' || occupant == null) &&
      ['Active', 'Infested'].includes(selection.occupancy)) {
    issues.push(warning('occupancy-empty-mismatch',
      `Occupancy "${selection.occupancy}" contradicts Occupant "None" — no inhabitants to leave active traces`,
      { axis: 'occupancy', value: selection.occupancy }));
  }

  if (selection.condition) {
    const cr = rules.conditionRules?.[selection.condition];
    if (cr?.warnAboveAnomaly != null && derived.anomalyIntensity != null &&
        derived.anomalyIntensity > cr.warnAboveAnomaly) {
      issues.push(warning('condition-anomaly-mismatch',
        `Condition "${selection.condition}" is implausible at anomaly ${derived.anomalyIntensity.toFixed(2)}: ${cr.reason ?? ''}`,
        { axis: 'condition', value: selection.condition, anomalyIntensity: derived.anomalyIntensity }));
    }
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return {
    ok,
    issues,
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
    derived,
  };
}
