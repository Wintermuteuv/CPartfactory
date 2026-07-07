import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = resolve(__dirname, '..', '..', 'config');

export const COVERAGE_PATH = resolve(configDir, 'coverage.json');

export async function loadCoverage() {
  const raw = await readFile(COVERAGE_PATH, 'utf8');
  return JSON.parse(raw);
}

async function atomicWrite(path, data) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export async function saveCoverage(coverage) {
  await atomicWrite(COVERAGE_PATH, JSON.stringify(coverage, null, 2));
}

export function findIndex(coverage, id) {
  return coverage.items.findIndex((i) => i.id === id);
}

function normalizeItem(item) {
  const out = {
    id: String(item.id ?? '').trim(),
    title: String(item.title ?? '').trim(),
    source: item.source ?? null,
    depthRange: Array.isArray(item.depthRange) && item.depthRange.length === 2
      ? [Number(item.depthRange[0]), Number(item.depthRange[1])]
      : null,
    match: {
      material:  Array.isArray(item.match?.material)  ? item.match.material  : [],
      spaceType: Array.isArray(item.match?.spaceType) ? item.match.spaceType : [],
      origin:    Array.isArray(item.match?.origin)    ? item.match.origin    : [],
      occupant:  Array.isArray(item.match?.occupant)  ? item.match.occupant  : [],
      lighting:  Array.isArray(item.match?.lighting)  ? item.match.lighting  : [],
    },
    targetCount: Number.isFinite(Number(item.targetCount)) ? Number(item.targetCount) : 0,
  };
  if (!out.id) throw new Error('coverage item: id is required');
  if (!out.title) throw new Error('coverage item: title is required');
  if (!out.depthRange) throw new Error('coverage item: depthRange [shallow, deep] is required');
  return out;
}

export async function addItem(item) {
  const cov = await loadCoverage();
  const normalized = normalizeItem(item);
  if (findIndex(cov, normalized.id) !== -1) {
    throw new Error(`coverage item with id "${normalized.id}" already exists`);
  }
  cov.items.push(normalized);
  await saveCoverage(cov);
  return normalized;
}

export async function updateItem(id, patch) {
  const cov = await loadCoverage();
  const idx = findIndex(cov, id);
  if (idx === -1) throw new Error(`coverage item "${id}" not found`);
  const merged = { ...cov.items[idx], ...patch, id };
  const normalized = normalizeItem(merged);
  cov.items[idx] = normalized;
  await saveCoverage(cov);
  return normalized;
}

export async function deleteItem(id) {
  const cov = await loadCoverage();
  const idx = findIndex(cov, id);
  if (idx === -1) return false;
  cov.items.splice(idx, 1);
  await saveCoverage(cov);
  return true;
}
