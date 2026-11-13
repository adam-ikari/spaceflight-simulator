import { describe, it, expect } from 'vitest';
import { ComponentSystems, ambientTemperatureK, type SystemsFlightState } from '../../src/physics/ComponentSystems';
import { ARCHETYPES } from '../../src/physics/archetypes';
import type { StageSpec } from '../../src/physics/RocketEquation';

const saturn = ARCHETYPES.find((a) => a.id === 'saturn_v')!.stages;

const flight = (overrides: Partial<SystemsFlightState> = {}): SystemsFlightState => ({
  phase: 'LIFTOFF',
  altitudeKm: 0,
  speedMs: 0,
  massKg: 2.9e6,
  thrustN: 3.4e7,
  powered: true,
  stageIndex: 0,
  dynamicPressurePa: 0,
  inSunlight: true,
  ...overrides,
});

const powered = (stages: StageSpec[], overrides: Partial<SystemsFlightState> = {}) => {
  const sys = new ComponentSystems(stages, 140_000, stages.some((s) => s.isSolid));
  sys.step(flight(overrides), 10);
  return sys.snapshot();
};

describe('ambientTemperatureK', () => {
  it('follows the standard-atmosphere layers', () => {
    expect(ambientTemperatureK(0)).toBeCloseTo(288.15, 2);
    expect(ambientTemperatureK(11)).toBeCloseTo(216.65, 1);
    expect(ambientTemperatureK(20)).toBeCloseTo(216.65, 1);
    expect(ambientTemperatureK(50)).toBeCloseTo(270.65, 1);
    expect(ambientTemperatureK(90)).toBeLessThan(200);
  });
});

describe('ComponentSystems — Saturn V powered ascent', () => {
  const snap = powered(saturn);

  it('builds one tank/chamber/nozzle per stage plus TPS, avionics and cabin', () => {
    expect(snap.components).toHaveLength(saturn.length * 3 + 3);
    expect(snap.components.map((c) => c.kind)).toContain('tps');
    expect(snap.components.map((c) => c.kind)).toContain('avionics');
    expect(snap.components.map((c) => c.kind)).toContain('cabin');
  });

  it('engine wall sits between coolant and material limit', () => {
    expect(snap.engineWallK).not.toBeNull();
    expect(snap.engineWallK!).toBeGreaterThan(300);
    expect(snap.engineWallK!).toBeLessThan(1000);
  });

  it('nozzle is hot but below its service limit', () => {
    expect(snap.nozzleK).not.toBeNull();
    expect(snap.nozzleK!).toBeGreaterThan(500);
    expect(snap.nozzleK!).toBeLessThan(1500);
  });

  it('pogo frequency is in the 5–6 Hz band and nominal ripple stays under 0.5 g', () => {
    expect(snap.pogoHz).toBeGreaterThan(5.0);
    expect(snap.pogoHz).toBeLessThan(6.0);
    expect(snap.pogoG).toBeGreaterThan(0);
    expect(snap.pogoG).toBeLessThan(0.5);
  });

  it('first bending is in the control-interaction band', () => {
    expect(snap.bendingHz).toBeGreaterThan(0.1);
    expect(snap.bendingHz).toBeLessThan(1.5);
  });

  it('avionics random vibration is in the qualification band', () => {
    expect(snap.randomGrms).toBeGreaterThan(5);
    expect(snap.randomGrms).toBeLessThan(12);
  });

  it('has no failures at nominal ascent', () => {
    expect(snap.failures).toEqual([]);
  });

  it('cabin stays near its set point and below the limit', () => {
    expect(snap.cabinK).toBeGreaterThan(250);
    expect(snap.cabinK).toBeLessThanOrEqual(300);
  });
});

describe('ComponentSystems — cryogenic boil-off', () => {
  it('accumulates mass over time at a small fraction of the load', () => {
    const sys = new ComponentSystems(saturn, 140_000, false);
    sys.step(flight(), 600);
    const snap = sys.snapshot();
    expect(snap.boiloffKg).toBeGreaterThan(0);
    expect(snap.boiloffPct).toBeGreaterThan(0);
    // One minute of boil-off must not be a mission-ending loss.
    expect(snap.boiloffPct).toBeLessThan(0.05);
  });
});

describe('ComponentSystems — entry heating', () => {
  it('heats the TPS at 60 km / 7.6 km/s without burning through', () => {
    const sys = new ComponentSystems(saturn, 140_000, false);
    const entry = flight({
      phase: 'ENTRY',
      altitudeKm: 60,
      speedMs: 7600,
      massKg: 1.2e5,
      thrustN: 0,
      powered: false,
      stageIndex: -1,
    });
    for (let i = 0; i < 120; i++) sys.step(entry, 1);
    const snap = sys.snapshot();
    expect(snap.tpsK).toBeGreaterThan(800);
    expect(snap.tpsK).toBeLessThanOrEqual(3200);
    expect(snap.failures.filter((f) => f.node === 'tps_flux')).toEqual([]);
  });

  it('a 10 MW/m² entry exceeds the carbon-ablator flux limit and raises a branch', () => {
    const sys = new ComponentSystems(saturn, 140_000, false);
    // ~20 km/s at 40 km gives a flux above 5 MW/m².
    const entry = flight({
      phase: 'ENTRY',
      altitudeKm: 40,
      speedMs: 11_000,
      massKg: 1e5,
      thrustN: 0,
      powered: false,
      stageIndex: -1,
    });
    for (let i = 0; i < 60; i++) sys.step(entry, 1);
    const snap = sys.snapshot();
    expect(snap.failures.some((f) => f.node === 'tps_flux')).toBe(true);
  });
});

describe('ComponentSystems — over-limit coupling', () => {
  it('a high-thrust solid stage drives pogo past the crew limit', () => {
    const hot: StageSpec = {
      propellantId: 'LOX_RP1',
      ofRatio: 2.3,
      pcMPa: 6,
      expansionRatio: 12,
      propellantMassKg: 4e5,
      dryMassKg: 20000,
      thrustN: 1.0e7,
      isSolid: true,
    };
    const sys = new ComponentSystems([hot], 5000, true);
    sys.step(
      flight({
        massKg: 5e5,
        thrustN: 1.0e7,
        dynamicPressurePa: 30_000,
        stageIndex: 0,
      }),
      5,
    );
    const snap = sys.snapshot();
    expect(snap.pogoG).toBeGreaterThan(0.5);
    expect(snap.failures.some((f) => f.node === 'pogo')).toBe(true);
  });
});
