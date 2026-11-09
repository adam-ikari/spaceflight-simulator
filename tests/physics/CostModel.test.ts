import { describe, it, expect } from 'vitest';
import { computeCost } from '../../src/physics/CostModel';

describe('cost', () => {
  const base = {
    stagesDryMassKg: [8000],
    propellantMassKg: [100000],
    propellantCostPerKg: { LOX_RP1: 0.5 },
    reuseCount: 1,
    devBudget: 1e9,
    plannedLaunches: 20,
    ploc: 0.005,
    payloadValue: 1e8,
  };

  it('higher PLOC raises insurance + total', () => {
    const a = computeCost(base);
    const b = computeCost({ ...base, ploc: 0.02 });
    expect(b.insurance).toBeGreaterThan(a.insurance);
    expect(b.total).toBeGreaterThan(a.total);
  });
});
