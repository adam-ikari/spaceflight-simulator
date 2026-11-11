import { describe, it, expect } from 'vitest';
import {
  CREW_POGO_LIMIT_G,
  cyclesToFailure,
  firstBendingHz,
  minerDamageIncrement,
  naturalFrequencyHz,
  overLimitProbability,
  pogoEffectiveMassKg,
  pogoResponse,
  pogoStiffnessNm,
  randomVibrationGrms,
} from '../../src/physics/StructuralDynamics';

const saturnPogo = () => ({
  thrustN: 3.4e7,
  vehicleMassKg: 2.9e6,
  pumpOscillationFrac: 0.025,
  excitationHz: 5.5,
  naturalHz: 5.5,
  qFactor: 20,
});

describe('pogo', () => {
  it('resonance amplifies by Q and reproduces the Apollo 6 ≈0.6 g order', () => {
    const r = pogoResponse(saturnPogo());
    expect(r.amplification).toBeCloseTo(20, 6);
    expect(r.resonant).toBe(true);
    // 2.5 % ripple · Q 20 · T/W ≈ 1.2 → 0.6 g, the Apollo 6 order; that is
    // above the 0.5 g crew limit, which is why pogo was a mission problem.
    expect(r.structuralAccelG).toBeGreaterThan(0.4);
    expect(r.structuralAccelG).toBeLessThan(0.8);
    expect(r.structuralAccelG).toBeGreaterThan(CREW_POGO_LIMIT_G);

    const nominal = pogoResponse({ ...saturnPogo(), pumpOscillationFrac: 0.01 });
    expect(nominal.structuralAccelG).toBeLessThan(CREW_POGO_LIMIT_G);
  });

  it('off-resonance response follows the SDOF formula', () => {
    const r = pogoResponse({ ...saturnPogo(), excitationHz: 2.75, qFactor: 20 });
    // 1/sqrt((1−0.25)² + (0.5/20)²) ≈ 1.333
    expect(r.amplification).toBeCloseTo(1.333, 2);
    expect(r.resonant).toBe(false);

    const high = pogoResponse({ ...saturnPogo(), excitationHz: 11, qFactor: 20 });
    expect(high.amplification).toBeCloseTo(1 / 3, 2);
  });

  it('a severe pump ripple pushes the crew over the 0.5 g limit', () => {
    const r = pogoResponse({ ...saturnPogo(), pumpOscillationFrac: 0.05 });
    expect(r.structuralAccelG).toBeGreaterThan(CREW_POGO_LIMIT_G);
  });

  it('frequency scales as sqrt(k/m)', () => {
    expect(naturalFrequencyHz(2000, 2.39e6)).toBeCloseTo(5.5, 1);
    expect(naturalFrequencyHz(8000, 2.39e6)).toBeCloseTo(2.75, 1);
    expect(naturalFrequencyHz(0, 1)).toBe(0);
  });

  it('Saturn V-derived effective mass and stiffness land at 5.5 Hz ± 0.5', () => {
    const m = pogoEffectiveMassKg(2.1e6);
    const k = pogoStiffnessNm(3.4e7);
    expect(naturalFrequencyHz(m, k)).toBeGreaterThan(5.0);
    expect(naturalFrequencyHz(m, k)).toBeLessThan(6.0);
  });
});

describe('first bending', () => {
  const saturn = () => firstBendingHz(110, 2.0e12, 27_000);

  it('Saturn V-class stack lands in the 0.3–1.5 Hz control-interaction band', () => {
    expect(saturn()).toBeGreaterThan(0.3);
    expect(saturn()).toBeLessThan(1.5);
  });

  it('scales as L⁻² for a given EI and mass per length', () => {
    const short = firstBendingHz(55, 2.0e12, 27_000);
    expect(short / saturn()).toBeCloseTo(4, 3);
  });

  it('stiffer structures bend faster', () => {
    expect(firstBendingHz(110, 8.0e12, 27_000)).toBeGreaterThan(saturn());
  });
});

describe('random vibration and fatigue', () => {
  it('Miles: 0.04 g²/Hz at 150 Hz, Q = 10 gives ≈9.7 g_rms', () => {
    const g = randomVibrationGrms(0.04, 150, 10);
    expect(g).toBeCloseTo(9.71, 1);
  });

  it('Miles: 0.02 g²/Hz at 100 Hz, Q = 10 gives ≈5.6 g_rms', () => {
    expect(randomVibrationGrms(0.02, 100, 10)).toBeCloseTo(5.6, 1);
  });

  it('cycles to failure falls as g^4', () => {
    expect(cyclesToFailure(10)).toBeCloseTo(1e7, -5);
    expect(cyclesToFailure(20)).toBeCloseTo(1e7 / 16, -3);
  });

  it('Miner damage accumulates and reaches 1 at the S–N limit', () => {
    const d1 = minerDamageIncrement(10, 100, 1);
    expect(d1).toBeCloseTo(100 / 1e7, 12);
    // 1e5 s at the reference level → damage 1.
    expect(minerDamageIncrement(10, 100, 1e5)).toBeCloseTo(1, 6);
    // At 20 g_rms the allowable cycles are 1e7/16; at 100 Hz that is 6250 s.
    expect(minerDamageIncrement(20, 100, 6250)).toBeCloseTo(1, 4);
  });
});

describe('overLimitProbability', () => {
  it('is zero below the limit and rises to 1 past it', () => {
    expect(overLimitProbability(400, 500, 50)).toBe(0);
    expect(overLimitProbability(550, 500, 50)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(overLimitProbability(800, 500, 50)).toBeGreaterThan(0.99);
  });
});
