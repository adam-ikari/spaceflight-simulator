import { describe, it, expect } from 'vitest';
import { SCENARIOS, ScenarioState } from '../../src/physics/AccidentScenarios';

const byId = (id: string) => {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
};

describe('SCENARIOS catalog', () => {
  it('holds the five DESIGN §6e accidents with years and Chinese names', () => {
    expect(SCENARIOS.map((s) => [s.id, s.year])).toEqual([
      ['apollo1', 1967],
      ['challenger', 1986],
      ['soyuz11', 1971],
      ['apollo13', 1970],
      ['columbia', 2003],
    ]);
    for (const s of SCENARIOS) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.conditions.length).toBeGreaterThan(0);
      const r = s.triggerFn({});
      expect(r.prob).toBeGreaterThanOrEqual(0);
      expect(r.prob).toBeLessThanOrEqual(1);
      expect(Array.isArray(r.chain)).toBe(true);
    }
  });
});

describe('Challenger 1986 — cold O-ring loses resilience', () => {
  const ch = byId('challenger');

  it('cold launch day is riskier than a warm one', () => {
    const cold = ch.triggerFn({ launchTempC: -1 });
    const warm = ch.triggerFn({ launchTempC: 20 });
    expect(cold.prob).toBeGreaterThan(warm.prob);
    expect(warm.prob).toBeLessThan(0.05);
  });

  it('well below Viton Tg (-20°C) the seal fails with ~0.9 probability', () => {
    const deep = ch.triggerFn({ launchTempC: -30 });
    expect(deep.prob).toBeGreaterThan(0.8);
    expect(deep.prob).toBeLessThanOrEqual(1);
  });

  it('probability is monotone in launch temperature over the flown range', () => {
    const temps = [-30, -20, -10, 0, 10, 20, 30];
    const probs = temps.map((t) => ch.triggerFn({ launchTempC: t }).prob);
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]).toBeLessThanOrEqual(probs[i - 1] + 1e-12);
    }
  });

  it('reports the blow-by chain when the joint leaks', () => {
    expect(ch.triggerFn({ launchTempC: -5 }).chain).toEqual([
      'O-ring低温失弹',
      'SRB场接头燃气泄漏',
      '结构失效→解体',
    ]);
    expect(ch.triggerFn({ launchTempC: 30 }).chain).toEqual([]);
  });
});

describe('Columbia 2003 — foam breach above the TPS limit', () => {
  const col = byId('columbia');

  it('foam strike plus over-limit heat flux destroys the vehicle', () => {
    const r = col.triggerFn({
      foamStrike: true,
      tpsMaterialId: 'silica_tile',
      reentryHeatFluxMWm2: 2.0, // silica tile limit is 1.5 MW/m²
    });
    expect(r.prob).toBeGreaterThan(0.5);
    expect(r.chain).toEqual(['泡沫击穿TPS', '再入热气侵入', '结构/热失效']);
  });

  it('no foam strike means no breach', () => {
    expect(
      col.triggerFn({ reentryHeatFluxMWm2: 2.0, tpsMaterialId: 'silica_tile' })
        .prob,
    ).toBeLessThan(0.05);
  });

  it('a strike whose damage stays inside the limit is survivable', () => {
    const r = col.triggerFn({
      foamStrike: true,
      tpsMaterialId: 'carbon_ablator', // 5 MW/m²
      reentryHeatFluxMWm2: 2.0,
    });
    expect(r.prob).toBeLessThan(0.1);
    expect(r.chain).toEqual([]);
  });

  it('hazard grows with how far the heat flux exceeds the tile limit', () => {
    const at = (q: number) =>
      col.triggerFn({
        foamStrike: true,
        tpsMaterialId: 'silica_tile',
        reentryHeatFluxMWm2: q,
      }).prob;
    expect(at(1.6)).toBeGreaterThan(0.1);
    expect(at(2.5)).toBeGreaterThan(at(1.6));
    expect(at(1.2)).toBeLessThan(0.1); // below the 1.5 MW/m² limit
  });
});

describe('Apollo 1 1967 — pure O2 plus an ignition source', () => {
  const a1 = byId('apollo1');

  it('a pure-oxygen cabin with an ignition source is catastrophic', () => {
    const r = a1.triggerFn({ cabinO2Pct: 1.0, ignitionPresent: true });
    expect(r.prob).toBeGreaterThan(0.5);
    expect(r.chain).toEqual(['纯氧大气', '点火源', '舱火→机组']);
  });

  it('sea-level air in the cabin keeps the fire risk low', () => {
    expect(a1.triggerFn({ cabinO2Pct: 0.21, ignitionPresent: true }).prob)
      .toBeLessThan(0.05);
  });

  it('no ignition source means no fire', () => {
    expect(a1.triggerFn({ cabinO2Pct: 1.0 }).prob).toBeLessThan(0.05);
  });
});

describe('Soyuz 11 1971 — descent-module venting without pressure suits', () => {
  const s11 = byId('soyuz11');

  it('an open cabin valve kills an unsuited crew', () => {
    const r = s11.triggerFn({ cabinLeak: true });
    expect(r.prob).toBeCloseTo(0.8, 1);
    expect(r.chain).toEqual(['再入舱阀失压', '无压力服', '缺氧→机组']);
  });

  it('no leak means no depressurisation', () => {
    expect(s11.triggerFn({}).prob).toBeLessThan(0.05);
  });
});

describe('Apollo 13 1970 — O2 tank arc and ECLSS loss', () => {
  const a13 = byId('apollo13');

  it('a tank fault leaves the crew on a limited O2 budget', () => {
    const r = a13.triggerFn({ tankFault: true });
    expect(r.prob).toBeGreaterThan(0.6);
    expect(r.prob).toBeLessThan(0.8);
    expect(r.chain).toEqual(['O2罐搅拌电弧', '罐爆', 'ECLSS O2失→在轨危机']);
  });

  it('no tank fault means a nominal mission', () => {
    expect(a13.triggerFn({}).prob).toBeLessThan(0.05);
  });
});

describe('scenario purity', () => {
  it('does not mutate the state and is deterministic', () => {
    const state: ScenarioState = {
      launchTempC: -10,
      cabinO2Pct: 1,
      ignitionPresent: true,
      tankFault: true,
      foamStrike: true,
      cabinLeak: true,
    };
    const snapshot = JSON.stringify(state);
    const first = SCENARIOS.map((s) => s.triggerFn(state));
    const second = SCENARIOS.map((s) => s.triggerFn(state));
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(second).toEqual(first);
    for (const r of first) {
      expect(r.prob).toBeGreaterThanOrEqual(0);
      expect(r.prob).toBeLessThanOrEqual(1);
    }
  });
});
