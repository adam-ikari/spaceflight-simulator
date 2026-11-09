import { describe, it, expect } from 'vitest';
import { stagePerformance, validateRocket } from '../../src/physics/RocketEquation';

const RP1 = {
  propellantId: 'LOX_RP1',
  ofRatio: 2.3,
  pcMPa: 7,
  expansionRatio: 16,
};

describe('rocket equation', () => {
  it('ideal dv matches closed form', () => {
    const r = stagePerformance(
      { ...RP1, propellantMassKg: 100000, dryMassKg: 8000, thrustN: 7.6e6 },
      150000,
    );
    expect(r.dvVac).toBeCloseTo(r.ispVac * 9.80665 * Math.log(150000 / (150000 - 100000)), 1);
  });

  it('rejects rocket under 9.4 km/s', () => {
    const v = validateRocket(
      [{ ...RP1, propellantMassKg: 50000, dryMassKg: 5000, thrustN: 5e6 }],
      5000,
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/Δv|9.4/);
  });

  it('accepts a feasible two-stage rocket and sums stage dv', () => {
    const s1 = { ...RP1, propellantMassKg: 100000, dryMassKg: 8000, thrustN: 7.6e6 };
    const s2 = {
      propellantId: 'LOX_LH2',
      ofRatio: 6,
      pcMPa: 7,
      expansionRatio: 60,
      propellantMassKg: 25000,
      dryMassKg: 3000,
      thrustN: 5e5,
    };
    const v = validateRocket([s1, s2], 5000);
    expect(v.ok).toBe(true);
    expect(v.totalDv).toBeGreaterThanOrEqual(9400);
    expect(v.errors).toEqual([]);
  });

  it('accumulates dv with upper stages included in each stage m0', () => {
    const s1 = { ...RP1, propellantMassKg: 100000, dryMassKg: 8000, thrustN: 7.6e6 };
    const s2 = { ...RP1, propellantMassKg: 25000, dryMassKg: 3000, thrustN: 5e5 };
    const v = validateRocket([s1, s2], 5000);
    const first = stagePerformance(s1, 141000);
    const second = stagePerformance(s2, 33000);
    expect(v.totalDv).toBeCloseTo(first.dvVac + second.dvVac, 6);
  });

  it('warns on structure mass fraction below floor', () => {
    const thin = { ...RP1, propellantMassKg: 100000, dryMassKg: 1000, thrustN: 7.6e6 };
    const v = validateRocket([thin], 5000);
    expect(v.warnings.join()).toMatch(/structure|结构/);
  });

  it('warns on first-stage TWR below 1.2', () => {
    const weak = { ...RP1, propellantMassKg: 100000, dryMassKg: 8000, thrustN: 1e6 };
    const v = validateRocket([weak], 5000);
    expect(v.warnings.join()).toMatch(/TWR/);
  });
});
