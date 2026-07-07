import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAxesConfig } from '../src/axes/loader.js';
import { buildPrompt } from '../src/axes/promptBuilder.js';
import { optimize, CANONICAL_ORDER } from '../src/axes/promptOptimizer.js';
import { validateCombination } from '../src/axes/validator.js';

const cfg = await loadAxesConfig();

const base = {
  material: 'Stone', spaceType: 'Corridor', origin: 'DwarvenTech',
  occupant: 'None', lighting: 'Torches', camera: 'EyeLevel', condition: 'Worn',
};
const sel = (over = {}) => ({ ...base, depth: -3, ...over });

test('optimize is deterministic for the same selection', () => {
  const s = sel({ depth: -30 });
  const a = optimize(buildPrompt(s, cfg), s, cfg);
  const b = optimize(buildPrompt(s, cfg), s, cfg);
  assert.equal(a.positive, b.positive);
});

test('optimize is idempotent (re-optimizing changes nothing)', () => {
  const s = sel({ lighting: 'NearDark', depth: -50, origin: 'Natural' });
  const once = optimize(buildPrompt(s, cfg), s, cfg);
  const twice = optimize({ ...once, sections: once.sections.map((x) => ({ ...x })) }, s, cfg);
  assert.equal(twice.positive, once.positive);
});

test('A0 cleanup: removed tokens never appear', () => {
  for (const depth of [-3, -20, -33, -40, -55]) {
    for (const origin of ['Natural', 'DwarvenTech', 'DwarvenResidential']) {
      const s = sel({ depth, origin, spaceType: 'Chasm', occupant: 'DwarvenRemains' });
      const p = optimize(buildPrompt(s, cfg), s, cfg).positive;
      assert.ok(!/dwarven walkways|oil lanterns|mutated organic intrusions/i.test(p), `leaked in ${JSON.stringify(s)}`);
    }
  }
});

test('A2 dedup: no duplicate descriptors in output', () => {
  const s = sel({ depth: -40, origin: 'Natural', material: 'Stone', lighting: 'Torches' });
  const p = optimize(buildPrompt(s, cfg), s, cfg).positive;
  const descriptors = p.split(',').map((d) => d.trim().toLowerCase());
  const uniq = new Set(descriptors);
  assert.equal(descriptors.length, uniq.size, 'duplicate descriptor survived');
});

test('A3 conflict: Natural drops water-eroded', () => {
  const s = sel({ origin: 'Natural', depth: -40 }); // Reheating, so not removed by cold rule
  const built = buildPrompt(s, cfg);
  assert.ok(/water-eroded/i.test(built.positive), 'builder should still contain water-eroded');
  const opt = optimize(built, s, cfg);
  assert.ok(!/water-eroded/i.test(opt.positive), 'optimizer should strip water-eroded for Natural');
  assert.ok(opt.notes.some((n) => n.stage === 'conflict' && n.rule === 'natural-dry'));
});

test('B3 biomass: present in deep Reheating, suppressed in cold zones', () => {
  // Reheating deep + manual high biomass → present
  const hot = sel({ depth: -50, biomass: 0.9, material: 'Stone' });
  const hotP = optimize(buildPrompt(hot, cfg), hot, cfg).positive;
  assert.ok(/biomass|organic corruption|fleshy/i.test(hotP), 'biomass should appear in deep hot zone');

  // Cooling zone + manual high biomass → removed by cold-no-biomass rule
  const cold = sel({ depth: -10, biomass: 0.9, material: 'Stone' });
  const coldOpt = optimize(buildPrompt(cold, cfg), cold, cfg);
  assert.ok(!/organic corruption|fleshy growths|biomass in the cracks/i.test(coldOpt.positive), 'biomass must be suppressed in Cooling');
  assert.ok(coldOpt.notes.some((n) => n.rule === 'cold-no-biomass'));
});

test('B3 biomass: manual override beats depth default', () => {
  const s = sel({ depth: -5, biomass: 0.0 }); // shallow: depth default already 0
  const built = buildPrompt(s, cfg);
  assert.equal(built.derived.biomassSource, 'manual');
  assert.equal(built.derived.biomassIntensity, 0);
});

test('A4 NearDark boost applied', () => {
  const s = sel({ lighting: 'NearDark' });
  const opt = optimize(buildPrompt(s, cfg), s, cfg);
  assert.ok(/short light radius|crushing shadows/i.test(opt.positive));
  assert.ok(opt.notes.some((n) => n.stage === 'lightBoost'));
});

test('A4 canonical order: camera first, baseStyle last', () => {
  const s = sel({ camera: 'LowAngleUp', depth: -40 });
  const opt = optimize(buildPrompt(s, cfg), s, cfg);
  const keys = opt.sections.map((x) => x.key);
  assert.equal(keys[0], 'camera');
  assert.equal(keys[keys.length - 1], 'baseStyle');
  // keys must be a subsequence of CANONICAL_ORDER
  let idx = -1;
  for (const k of keys) {
    const at = CANONICAL_ORDER.indexOf(k);
    assert.ok(at > idx, `section ${k} out of canonical order`);
    idx = at;
  }
});

test('A5 unknown model falls back to sdxl with a warning note', () => {
  const s = sel();
  const opt = optimize(buildPrompt(s, cfg), s, cfg, 'fluxx');
  assert.ok(opt.notes.some((n) => n.stage === 'warning'));
  assert.equal(opt.optimizer.model, 'sdxl');
});

test('validator: biomass out of range is an error', () => {
  const v = validateCombination(sel({ biomass: 2 }), cfg);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.rule === 'biomass-out-of-range'));
});

test('validator: Pristine warns at high anomaly', () => {
  const v = validateCombination(sel({ condition: 'Pristine', depth: -50 }), cfg);
  assert.ok(v.warnings.some((w) => w.rule === 'condition-anomaly-mismatch'));
});

test('validator: new axes are optional (missing is fine)', () => {
  const { camera, condition, ...noFine } = base;
  const v = validateCombination({ ...noFine, depth: -3 }, cfg);
  assert.ok(v.ok, JSON.stringify(v.errors));
});
