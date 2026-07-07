import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = resolve(__dirname, '..', '..', 'config');

export const AXES_PATH = resolve(configDir, 'axes.json');
export const RULES_PATH = resolve(configDir, 'axis_rules.json');
export const OPTIMIZER_RULES_PATH = resolve(configDir, 'optimizer_rules.json');

async function loadJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadJsonOptional(path, fallback) {
  try {
    return await loadJson(path);
  } catch {
    return fallback;
  }
}

function indexAxis(axisDef) {
  const byId = new Map();
  for (const v of axisDef.values ?? []) byId.set(v.id, v);
  return { ...axisDef, byId };
}

export async function loadAxesConfig() {
  const axes = await loadJson(AXES_PATH);
  const rules = await loadJson(RULES_PATH);
  const optimizerRules = await loadJsonOptional(OPTIMIZER_RULES_PATH, { rules: [] });

  const indexedAxes = {
    lighting:  indexAxis(axes.axes.lighting),
    material:  indexAxis(axes.axes.material),
    spaceType: indexAxis(axes.axes.spaceType),
    origin:    indexAxis(axes.axes.origin),
    occupant:  indexAxis(axes.axes.occupant),
    camera:    indexAxis(axes.axes.camera ?? { values: [] }),
    condition: indexAxis(axes.axes.condition ?? { values: [] }),
  };

  return {
    raw: axes,
    rules,
    optimizerRules,
    axes: indexedAxes,
    baseStyle: axes.baseStyle,
    depth: axes.depth,
    anomalyModifiers: [...axes.anomalyModifiers].sort((a, b) => a.max - b.max),
    biomassModifiers: [...(axes.biomassModifiers ?? [])].sort((a, b) => a.max - b.max),
    thermalModifiers: axes.thermalModifiers ?? {},
  };
}
