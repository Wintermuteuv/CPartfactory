import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sidecarMatchesItem, isExternalSidecar } from './matcher.js';

async function loadSidecars(outputDir) {
  let names;
  try {
    names = await readdir(outputDir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const sidecars = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(outputDir, name), 'utf8');
      const data = JSON.parse(raw);
      sidecars.push({ name, ...data });
    } catch {
      // skip malformed sidecars
    }
  }
  return sidecars;
}

export async function computeCoverage(items, outputDir) {
  const sidecars = await loadSidecars(outputDir);
  const counts = items.map((item) => {
    let generated = 0;
    let external = 0;
    const matchedFiles = [];
    for (const s of sidecars) {
      if (!sidecarMatchesItem(s, item)) continue;
      generated += 1;
      if (isExternalSidecar(s)) external += 1;
      matchedFiles.push({
        name: s.name.replace(/\.json$/, '.png'),
        sidecar: s.name,
        seed: s.seed ?? null,
        stage: s.stage ?? null,
        depth: s.axes?.depth ?? null,
      });
    }
    return { ...item, generated, external, matchedFiles };
  });
  return { items: counts, totalSidecars: sidecars.length };
}
