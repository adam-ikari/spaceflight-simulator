import { describe, expect, it } from 'vitest';
import { LEVEL_1, validateLevelDesign, type LevelStage } from '../../src/game/levels';
import { ARCHETYPES } from '../../src/physics/archetypes';

/**
 * Reference launcher for Level 1: two LOX/RP-1 stages, 220 t + 50 t propellant,
 * 25 t dry structure, 10 t payload, propulsive abort. Δv lands ~6 m/s above the
 * 9.4 km/s gate — deliberately tight, because the control case below is a 5 %
 * mixture-ratio drift and the Isp penalty at 5 % is only ~0.1 %.
 */
function referenceStages(): LevelStage[] {
  return [
    {
      propellantId: 'LOX_RP1',
      ofRatio: 2.3,
      pcMPa: 7,
      expansionRatio: 16,
      propellantMassKg: 220_000,
      dryMassKg: 20_000,
      thrustN: 3.8e6,
    },
    {
      propellantId: 'LOX_RP1',
      ofRatio: 2.3,
      pcMPa: 6,
      expansionRatio: 40,
      propellantMassKg: 50_000,
      dryMassKg: 5_000,
      thrustN: 6.0e5,
    },
  ];
}

const referenceDesign = () => ({
  stages: referenceStages(),
  payloadKg: LEVEL_1.payloadKg,
  escapeSystem: 'propulsive' as const,
});

describe('Level 1 — 200 km crewed LEO', () => {
  it('accepts the reference two-stage LOX/RP-1 design', () => {
    const result = validateLevelDesign(LEVEL_1, referenceDesign());

    expect(result.reasons).toEqual([]);
    expect(result.feasible).toBe(true);
    expect(result.physicallyFeasible).toBe(true);
    expect(result.physicalReasons).toEqual([]);
    expect(result.metrics?.totalDvMs).toBeGreaterThanOrEqual(LEVEL_1.requiredDvMs);
    expect(result.metrics?.ploc).toBeLessThanOrEqual(LEVEL_1.maxPloc);
    expect(result.metrics?.costUsd).toBeLessThanOrEqual(LEVEL_1.budgetUsd);
  });

  it('rejects a 5 % mixture-ratio drift because the Δv gap opens', () => {
    const stages = referenceStages().map((s) => ({ ...s, ofRatio: s.ofRatio * 1.05 }));
    const result = validateLevelDesign(LEVEL_1, { ...referenceDesign(), stages });

    expect(result.feasible).toBe(false);
    expect(result.physicallyFeasible).toBe(false);
    // The failure must name the physical quantity, not just a boolean.
    expect(result.physicalReasons.some((r) => r.includes('Δv'))).toBe(true);
    expect(result.physicalReasons.some((r) => r.includes('缺口'))).toBe(true);
    expect(result.metrics?.totalDvMs).toBeLessThan(LEVEL_1.requiredDvMs);
  });

  it('rejects a chamber without regenerative cooling on wall temperature', () => {
    const stages = referenceStages().map((s, i) => ({
      ...s,
      regenerativeCooling: i === 0 ? false : s.regenerativeCooling,
    }));
    const result = validateLevelDesign(LEVEL_1, { ...referenceDesign(), stages });

    expect(result.feasible).toBe(false);
    expect(result.physicallyFeasible).toBe(false);
    expect(result.physicalReasons.some((r) => r.includes('壁温') && r.includes('1000 K'))).toBe(true);
    expect(result.metrics?.wallTempsK[0]).toBeGreaterThan(1000);
  });

  it('rejects a design that misses the reliability gate', () => {
    const result = validateLevelDesign(LEVEL_1, {
      ...referenceDesign(),
      escapeSystem: 'none',
    });

    expect(result.feasible).toBe(false);
    expect(result.physicallyFeasible).toBe(true);
    expect(result.physicalReasons).toEqual([]);
    expect(result.levelReasons.some((r) => r.includes('PLOC'))).toBe(true);
    expect(result.metrics?.ploc).toBeGreaterThan(LEVEL_1.maxPloc);
  });

  it('reports a physical design that only misses the budget', () => {
    const result = validateLevelDesign(
      { ...LEVEL_1, budgetUsd: 100e6 },
      referenceDesign(),
    );

    expect(result.physicallyFeasible).toBe(true);
    expect(result.feasible).toBe(false);
    expect(result.physicalReasons).toEqual([]);
    expect(result.levelReasons.some((r) => r.includes('预算'))).toBe(true);
  });

  it('keeps a historical Saturn V physically feasible while it misses the modern contract', () => {
    const saturn = ARCHETYPES.find((a) => a.id === 'saturn_v')!;
    const result = validateLevelDesign(LEVEL_1, {
      stages: saturn.stages,
      payloadKg: LEVEL_1.payloadKg,
      escapeSystem: 'tower',
    });

    expect(result.physicallyFeasible).toBe(true);
    expect(result.physicalReasons).toEqual([]);
    expect(result.feasible).toBe(false);
    expect(result.levelReasons.some((r) => r.includes('PLOC'))).toBe(true);
    expect(result.levelReasons.some((r) => r.includes('预算'))).toBe(true);
  });
});
