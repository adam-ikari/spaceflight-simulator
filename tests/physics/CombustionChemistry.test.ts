import { describe, it, expect } from 'vitest';
import { combustionState } from '../../src/physics/CombustionChemistry';
import { PROPELLANTS } from '../../src/physics/propellants';

describe('combustionState', () => {
  it('at the optimum O/F it reproduces the measured table point', () => {
    const s = combustionState('LOX_RP1', PROPELLANTS['LOX_RP1'].ofTypical);
    expect(s.tcK).toBeCloseTo(PROPELLANTS['LOX_RP1'].tcK, 6);
    expect(s.mGmol).toBeCloseTo(PROPELLANTS['LOX_RP1'].mGmol, 6);
    expect(s.ofOptimal).toBe(PROPELLANTS['LOX_RP1'].ofTypical);
  });

  it('reacted fraction peaks at stoichiometric', () => {
    // RP-1 stoichiometric is 3.45; optimum 2.3 runs fuel-rich.
    expect(combustionState('LOX_RP1', 3.45).reactedFraction).toBeCloseTo(1, 6);
    expect(combustionState('LOX_RP1', 2.3).reactedFraction).toBeLessThan(0.8);
  });

  it('chamber temperature falls and molecular weight rises away from optimum', () => {
    const opt = combustionState('LOX_RP1', 2.3);
    const lean = combustionState('LOX_RP1', 4.6); // 2× the ratio
    const rich = combustionState('LOX_RP1', 1.15); // half the ratio

    for (const s of [lean, rich]) {
      expect(s.tcK).toBeLessThan(opt.tcK * 0.9);
      expect(s.mGmol).toBeGreaterThan(opt.mGmol);
    }
  });

  it('is symmetric in log-ratio space: 2× and 0.5× give the same state', () => {
    const lean = combustionState('LOX_LH2', 12.0);
    const rich = combustionState('LOX_LH2', 3.0);
    expect(lean.tcK).toBeCloseTo(rich.tcK, 6);
    expect(lean.mGmol).toBeCloseTo(rich.mGmol, 6);
  });

  it('rejects an unknown propellant', () => {
    expect(() => combustionState('unobtainium', 2)).toThrow(/Unknown propellant/);
  });
});
