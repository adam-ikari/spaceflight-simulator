import { describe, it, expect } from 'vitest';
import {
  gcrDoseRateMsvPerDay,
  speDoseMsv,
  vanAllenDoseMsv,
  accumulate,
  ACUTE_SICKNESS_MSV,
} from '../../src/physics/Radiation';

describe('Radiation', () => {
  it('GCR deep-space dose is halved by LEO earth shielding', () => {
    // Shielding factor 1 → LEO: ~0.3–1 mSv/day (design §6d)
    expect(gcrDoseRateMsvPerDay(1)).toBeGreaterThanOrEqual(0.3);
    expect(gcrDoseRateMsvPerDay(1)).toBeLessThanOrEqual(1);
    // Deep space (no shielding) higher than LEO
    expect(gcrDoseRateMsvPerDay(0)).toBeGreaterThan(gcrDoseRateMsvPerDay(1));
  });

  it('always reduces dose monotonically with shielding mass', () => {
    for (let gcm2 = 0; gcm2 <= 100; gcm2 += 5) {
      const more = speDoseMsv(1000, gcm2 + 5);
      const less = speDoseMsv(1000, gcm2);
      expect(more).toBeLessThan(less);
    }
  });

  it('SPE shielding attenuates exponentially', () => {
    // 50 g/cm² polyethylene blocks ~63% of a 1000 mSv event
    expect(speDoseMsv(1000, 50)).toBeLessThan(speDoseMsv(1000, 0));
    expect(speDoseMsv(1000, 50)).toBeCloseTo(1000 * Math.exp(-50 * 0.02), 6);
    expect(speDoseMsv(2000, 0)).toBeCloseTo(2000, 6);
  });

  it('Van Allen dose depends on transit profile', () => {
    expect(vanAllenDoseMsv('low')).toBeGreaterThan(0);
    expect(vanAllenDoseMsv('high')).toBeGreaterThan(vanAllenDoseMsv('low'));
    expect(vanAllenDoseMsv('transfer')).toBeGreaterThan(vanAllenDoseMsv('high'));
  });

  it('accumulates dose and flags acute sickness past 1 Sv', () => {
    expect(accumulate(900, 200)).toBeGreaterThan(ACUTE_SICKNESS_MSV);
    expect(ACUTE_SICKNESS_MSV).toBe(1000);
    expect(accumulate(0, 0)).toBe(0);
  });
});