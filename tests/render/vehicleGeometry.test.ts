import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from '../../src/physics/archetypes';
import type { StageSpec } from '../../src/physics/RocketEquation';
import {
  FINENESS,
  computeVehicleGeometry,
  engineCount,
  propellantDensity,
  splitStack,
  stageVolume,
} from '../../src/render/vehicleGeometry';

const saturn = (): StageSpec[] => ARCHETYPES.find((a) => a.id === 'saturn_v')!.stages.map((s) => ({ ...s }));
const shuttle = (): StageSpec[] => ARCHETYPES.find((a) => a.id === 'shuttle')!.stages.map((s) => ({ ...s }));

describe('propellantDensity', () => {
  it('LOX/RP-1 bulk density is close to 1 t/m³', () => {
    const s = saturn()[0];
    expect(propellantDensity(s)).toBeGreaterThan(950);
    expect(propellantDensity(s)).toBeLessThan(1060);
  });

  it('LOX/LH2 is far less dense than LOX/RP-1', () => {
    const stages = saturn();
    expect(propellantDensity(stages[1])).toBeLessThan(propellantDensity(stages[0]) * 0.45);
  });

  it('solid motors use the APCP density', () => {
    expect(propellantDensity({ ...saturn()[0], isSolid: true })).toBe(1800);
  });
});

describe('stageVolume', () => {
  it('equal propellant mass needs more volume as LH2 than as RP-1', () => {
    const rp1 = { ...saturn()[0], propellantMassKg: 100_000, dryMassKg: 10_000 };
    const lh2 = { ...saturn()[1], propellantMassKg: 100_000, dryMassKg: 10_000 };
    expect(stageVolume(lh2)).toBeGreaterThan(stageVolume(rp1) * 2);
  });
});

describe('computeVehicleGeometry', () => {
  it('Saturn V stack has a realistic fineness ratio (L/D ≈ 10)', () => {
    const geo = computeVehicleGeometry(saturn(), false);
    expect(geo.fineness).toBeCloseTo(FINENESS, 1);
    // Sanity: not a stubby cone — L/D must be far from the old 3–4 look.
    expect(geo.height / (2 * geo.radius)).toBeGreaterThan(9);
  });

  it('scales uniformly: 8× the propellant gives 2× linear size, same L/D', () => {
    const base = computeVehicleGeometry(saturn(), false);
    const heavy = saturn().map((s) => ({
      ...s,
      propellantMassKg: s.propellantMassKg * 8,
      dryMassKg: s.dryMassKg * 8,
    }));
    const big = computeVehicleGeometry(heavy, false);
    expect(big.radius / base.radius).toBeCloseTo(2, 1);
    expect(big.height / base.height).toBeCloseTo(2, 1);
    expect(big.fineness).toBeCloseTo(base.fineness, 2);
  });

  it('heavier stages are longer: stage heights follow tank volume', () => {
    const geo = computeVehicleGeometry(saturn(), false);
    expect(geo.stageHeights).toHaveLength(3);
    // S-IC carries the most propellant, S-IVB the least.
    expect(geo.stageHeights[0]).toBeGreaterThan(geo.stageHeights[2]);
    expect(geo.stageHeights.every((h) => h > 0)).toBe(true);
  });

  it('Shuttle: the solid first stage becomes a side booster pair, not a core stage', () => {
    const { core, strapOn } = splitStack(shuttle(), true);
    expect(core).toHaveLength(1);
    expect(strapOn?.isSolid).toBe(true);

    const geo = computeVehicleGeometry(shuttle(), true);
    expect(geo.strapOn).not.toBeNull();
    // SRB runs nearly the length of the core stack, like the real 45 m vs 47 m.
    const srLength = geo.strapOn!.height;
    const coreLength = geo.height;
    expect(srLength / coreLength).toBeGreaterThan(0.5);
    expect(srLength / coreLength).toBeLessThan(1.5);
  });

  it('no strap-on pair for a purely inline vehicle', () => {
    expect(computeVehicleGeometry(saturn(), false).strapOn).toBeNull();
  });
});

describe('engineCount', () => {
  it('Saturn V: 5 F-1, 5 J-2, 1 J-2', () => {
    const stages = saturn();
    expect(engineCount(stages[0])).toBe(5);
    expect(engineCount(stages[1])).toBe(5);
    expect(engineCount(stages[2])).toBe(1);
  });
});
