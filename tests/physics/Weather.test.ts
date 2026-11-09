import { describe, it, expect } from 'vitest';
import { evaluateLaunch, windLoadMoment, type WeatherState } from '../../src/physics/Weather';

const calm: WeatherState = {
  groundWindMs: 4,
  windShearPerKm: 10,
  tempC: 20,
  lightningRisk: 0.05,
  cloudCeilingM: 3000,
  seaWaveM: 1,
};

describe('evaluateLaunch', () => {
  it('calm weather -> go, no violations', () => {
    const r = evaluateLaunch(calm);
    expect(r.go).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('strong ground wind 15 m/s -> violation, go false', () => {
    const r = evaluateLaunch({ ...calm, groundWindMs: 15 });
    expect(r.go).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.violations.some((v) => v.toLowerCase().includes('wind'))).toBe(true);
  });

  it('cold tempC -5 -> O-ring violation', () => {
    const r = evaluateLaunch({ ...calm, tempC: -5 });
    expect(r.go).toBe(false);
    expect(r.violations.some((v) => v.toLowerCase().includes('temp'))).toBe(true);
  });

  it('high lightning 0.5 -> violation', () => {
    const r = evaluateLaunch({ ...calm, lightningRisk: 0.5 });
    expect(r.go).toBe(false);
    expect(r.violations.some((v) => v.toLowerCase().includes('lightning'))).toBe(true);
  });

  it('wind shear above 30 m/s/km -> violation', () => {
    const r = evaluateLaunch({ ...calm, windShearPerKm: 40 });
    expect(r.go).toBe(false);
    expect(r.violations.some((v) => v.toLowerCase().includes('shear'))).toBe(true);
  });

  it('cloud ceiling below 1000 m -> violation', () => {
    const r = evaluateLaunch({ ...calm, cloudCeilingM: 600 });
    expect(r.go).toBe(false);
    expect(r.violations.some((v) => v.toLowerCase().includes('cloud'))).toBe(true);
  });

  it('sea waves above 3 m -> violation', () => {
    const r = evaluateLaunch({ ...calm, seaWaveM: 4 });
    expect(r.go).toBe(false);
    expect(r.violations.some((v) => v.toLowerCase().includes('wave'))).toBe(true);
  });

  it('thresholds are exclusive (wind exactly 10 m/s is go)', () => {
    expect(evaluateLaunch({ ...calm, groundWindMs: 10 }).go).toBe(true);
  });
});

describe('windLoadMoment', () => {
  it('zero at ground', () => {
    expect(windLoadMoment(calm, 0)).toBe(0);
  });

  it('increases with ground wind speed at fixed altitude', () => {
    const low = windLoadMoment({ ...calm, groundWindMs: 5 }, 8);
    const high = windLoadMoment({ ...calm, groundWindMs: 15 }, 8);
    expect(high).toBeGreaterThan(low);
  });

  it('increases with altitude in the lower atmosphere', () => {
    const low = windLoadMoment(calm, 2);
    const mid = windLoadMoment(calm, 8);
    expect(mid).toBeGreaterThan(low);
  });

  it('positive for strong shear at high altitude', () => {
    expect(windLoadMoment({ ...calm, groundWindMs: 0, windShearPerKm: 40 }, 10)).toBeGreaterThan(0);
  });
});
