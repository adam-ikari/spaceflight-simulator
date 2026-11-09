import { describe, it, expect } from 'vitest';
import {
  computeConsumables,
  stepLifeSupport,
} from '../../src/physics/LifeSupport';

const DAY = 86400;

describe('computeConsumables', () => {
  it('consumes ~0.84 kg O2 per person per day', () => {
    const c = computeConsumables({ crew: 3, durationDays: 1 });
    expect(c.o2Kg).toBeGreaterThan(2.42);
    expect(c.o2Kg).toBeLessThan(2.62);
  });

  it('returns positive totals equal to the sum of parts', () => {
    const c = computeConsumables({ crew: 3, durationDays: 7 });
    expect(c.totalKg).toBeGreaterThan(0);
    expect(c.totalKg).toBeCloseTo(
      c.o2Kg + c.waterKg + c.foodKg + c.liohKg,
      6,
    );
  });

  it('scales linearly with crew and duration', () => {
    const c1 = computeConsumables({ crew: 2, durationDays: 3 });
    const c2 = computeConsumables({ crew: 4, durationDays: 6 });
    expect(c2.o2Kg).toBeCloseTo(c1.o2Kg * 4, 6);
    expect(c2.totalKg).toBeCloseTo(c1.totalKg * 4, 6);
  });
});

describe('stepLifeSupport', () => {
  it('reduces O2 by ~2.52 kg over one day for 3 crew', () => {
    const s0 = {
      o2RemainKg: 100,
      waterRemainKg: 100,
      co2Pct: 0,
      metabolicHeatW: 0,
      failures: [],
    };
    const s1 = stepLifeSupport(s0, 3, DAY);
    expect(s0.o2RemainKg - s1.o2RemainKg).toBeGreaterThan(2.42);
    expect(s0.o2RemainKg - s1.o2RemainKg).toBeLessThan(2.62);
  });

  it('reduces water by ~2.7 kg per person per day', () => {
    const s0 = {
      o2RemainKg: 100,
      waterRemainKg: 50,
      co2Pct: 0,
      metabolicHeatW: 0,
      failures: [],
    };
    const s1 = stepLifeSupport(s0, 1, DAY);
    expect(50 - s1.waterRemainKg).toBeGreaterThan(2.6);
    expect(50 - s1.waterRemainKg).toBeLessThan(2.8);
  });

  it('accumulates CO2 fraction up to a cap', () => {
    const s0 = {
      o2RemainKg: 100,
      waterRemainKg: 100,
      co2Pct: 0.05,
      metabolicHeatW: 0,
      failures: [],
    };
    const s1 = stepLifeSupport(s0, 3, DAY);
    expect(s1.co2Pct).toBeGreaterThan(s0.co2Pct);
    expect(s1.co2Pct).toBeLessThanOrEqual(1.0);
  });

  it('sets metabolic heat at 100 W per person', () => {
    const s0 = {
      o2RemainKg: 100,
      waterRemainKg: 100,
      co2Pct: 0,
      metabolicHeatW: 0,
      failures: [],
    };
    expect(stepLifeSupport(s0, 4, 60).metabolicHeatW).toBe(400);
  });

  it('reports o2_depleted when O2 runs out, without mutating input', () => {
    const s0 = {
      o2RemainKg: 0.1,
      waterRemainKg: 100,
      co2Pct: 0,
      metabolicHeatW: 0,
      failures: [],
    };
    const s1 = stepLifeSupport(s0, 2, DAY);
    expect(s1.failures).toContain('o2_depleted');
    expect(s0.failures).not.toContain('o2_depleted');
    expect(s1.failures).not.toBe(s0.failures);
  });

  it('does not duplicate o2_depleted across steps', () => {
    const s0 = {
      o2RemainKg: 0,
      waterRemainKg: 100,
      co2Pct: 0,
      metabolicHeatW: 0,
      failures: ['o2_depleted'],
    };
    expect(stepLifeSupport(s0, 2, 60).failures).toEqual(['o2_depleted']);
  });
});