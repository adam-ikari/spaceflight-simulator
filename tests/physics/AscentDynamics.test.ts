import { describe, it, expect } from 'vitest';
import { simulateAscent } from '../../src/physics/AscentDynamics';
import type { StageSpec } from '../../src/physics/RocketEquation';

// Saturn V-class three-stage stack (S-IC / S-II / S-IVB), values from
// Apollo 11 mass breakdown; used inline until archetypes lands.
const SATURN_V: StageSpec[] = [
  {
    propellantId: 'LOX_RP1',
    ofRatio: 2.3,
    pcMPa: 7,
    expansionRatio: 16,
    propellantMassKg: 2_150_000,
    dryMassKg: 131_000,
    thrustN: 34.5e6,
  },
  {
    propellantId: 'LOX_LH2',
    ofRatio: 5.5,
    pcMPa: 7,
    expansionRatio: 60,
    propellantMassKg: 456_000,
    dryMassKg: 36_000,
    thrustN: 5.0e6,
  },
  {
    propellantId: 'LOX_LH2',
    ofRatio: 5.5,
    pcMPa: 7,
    expansionRatio: 60,
    propellantMassKg: 106_000,
    dryMassKg: 10_000,
    thrustN: 1.0e6,
  },
];

const PAYLOAD = 45_000;

describe('ascent dynamics', () => {
  it('peaks at realistic max-q for a Saturn V class stack', () => {
    const r = simulateAscent(SATURN_V, PAYLOAD);
    // 19.6 kPa with the USSA-1976 density table. The old 20 kPa floor was
    // calibrated against a layered exponential that over-predicted density by
    // 20-35× above 20 km, so it masked the atmosphere error instead of
    // catching it. Launch vehicles sit in the 10-40 kPa band.
    expect(r.maxQPa).toBeGreaterThan(15_000);
    expect(r.maxQPa).toBeLessThan(50_000);
  });

  it('reports positive gravity and drag losses under 3 km/s total', () => {
    const r = simulateAscent(SATURN_V, PAYLOAD);
    expect(r.gravityLossMs).toBeGreaterThan(0);
    expect(r.dragLossMs).toBeGreaterThan(0);
    expect(r.gravityLossMs + r.dragLossMs).toBeLessThan(3000);
  });

  it('reaches LEO altitude and near-orbital speed after all stages', () => {
    const r = simulateAscent(SATURN_V, PAYLOAD);
    expect(r.finalState.altitudeKm).toBeGreaterThan(100);
    expect(r.finalState.altitudeKm).toBeLessThan(300);
    expect(r.finalState.speedMs).toBeGreaterThan(7000);
  });

  it('records a state per burned stage and cuts off at orbital speed', () => {
    const r = simulateAscent(SATURN_V, PAYLOAD);
    expect(r.stageStates.length).toBeGreaterThanOrEqual(2);
    expect(r.stageStates.length).toBeLessThanOrEqual(3);
    for (const s of r.stageStates) {
      expect(s.burnTimeS).toBeGreaterThan(0);
      expect(s.endAltitudeKm).toBeGreaterThan(0);
    }
  });
});
