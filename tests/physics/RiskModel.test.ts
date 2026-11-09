import { describe, it, expect } from 'vitest';
import { abortSuccessRate, computePLOC, type RiskInput } from '../../src/physics/RiskModel';

const base: RiskInput = {
  solidBoosterLit: false,
  mach: 2,
  dynamicPressurePa: 30000,
  escapeSystem: 'tower',
  phase: 'ascent',
  crewed: true,
};

describe('abortSuccessRate', () => {
  it('solid booster lit -> abort rate 0', () => {
    expect(
      abortSuccessRate({
        ...base,
        solidBoosterLit: true,
        phase: 'ascent',
      }),
    ).toBe(0);
  });

  it('propulsive escape abort > 0.5 at high mach', () => {
    expect(
      abortSuccessRate({
        ...base,
        mach: 2,
        dynamicPressurePa: 30000,
        escapeSystem: 'propulsive',
      }),
    ).toBeGreaterThan(0.5);
  });

  it('tower abort degrades with dynamic pressure and approaches 0', () => {
    const lowQ = abortSuccessRate({ ...base, dynamicPressurePa: 0 });
    const highQ = abortSuccessRate({ ...base, dynamicPressurePa: 80000 });
    expect(lowQ).toBeCloseTo(0.95, 5);
    expect(highQ).toBeLessThan(lowQ);
    expect(highQ).toBeLessThan(0.15);
  });

  it('no escape system is a low chance', () => {
    const r = abortSuccessRate({ ...base, escapeSystem: 'none' });
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.2);
  });

  it('stays in [0,1]', () => {
    for (const escapeSystem of ['tower', 'propulsive', 'none'] as const) {
      for (const dynamicPressurePa of [0, 30000, 100000]) {
        const r = abortSuccessRate({ ...base, escapeSystem, dynamicPressurePa });
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('computePLOC', () => {
  it('PLOC decreases with better escape system', () => {
    const tow = computePLOC({
      solidBoosterLit: false,
      mach: 2,
      dynamicPressurePa: 30000,
      escapeSystem: 'tower',
      phase: 'ascent',
      crewed: true,
    }).ploc;
    const pro = computePLOC({
      solidBoosterLit: false,
      mach: 2,
      dynamicPressurePa: 30000,
      escapeSystem: 'propulsive',
      phase: 'ascent',
      crewed: true,
    }).ploc;
    expect(pro).toBeLessThan(tow);
  });

  it('solid booster abort = 0 means every launch failure kills crew', () => {
    const lit = computePLOC({ ...base, solidBoosterLit: true });
    const sep = computePLOC({ ...base, solidBoosterLit: false, escapeSystem: 'propulsive' });
    expect(lit.ploc).toBeGreaterThan(sep.ploc);
  });

  it('reports fault-tree contributors that combine to the PLOC', () => {
    const out = computePLOC(base);
    expect(out.contributors.length).toBeGreaterThan(0);
    const union = 1 - out.contributors.reduce((acc, c) => acc * (1 - c.prob), 1);
    expect(out.ploc).toBeCloseTo(union, 12);
    for (const c of out.contributors) {
      expect(c.node.length).toBeGreaterThan(0);
      expect(c.prob).toBeGreaterThanOrEqual(0);
      expect(c.prob).toBeLessThan(1);
    }
  });

  it('includes reentry and landing nodes only when relevant', () => {
    const ascent = computePLOC(base).contributors.map((c) => c.node);
    const entry = computePLOC({ ...base, phase: 'entry' }).contributors.map((c) => c.node);
    expect(ascent).toContain('engine_failure');
    expect(ascent).not.toContain('reentry_ablation');
    expect(entry).toContain('reentry_ablation');
    expect(entry).not.toContain('engine_failure');
  });

  it('no crew -> no loss of crew probability', () => {
    expect(computePLOC({ ...base, crewed: false }).ploc).toBe(0);
  });
});
