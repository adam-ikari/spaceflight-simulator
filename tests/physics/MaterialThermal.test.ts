import { describe, it, expect } from 'vitest';
import {
  rubberResilience,
  dbttFactor,
  cryoBoiloff,
  tpsLimit,
} from '../../src/physics/MaterialThermal';

describe('rubberResilience', () => {
  it('Viton at -1°C loses resilience vs +20°C (Challenger cold launch)', () => {
    expect(rubberResilience('viton_oring', -1)).toBeLessThan(
      rubberResilience('viton_oring', 20),
    );
  });

  it('Viton is near-full above Tg+20 and collapsed below Tg-10', () => {
    expect(rubberResilience('viton_oring', 20)).toBeGreaterThan(0.95);
    expect(rubberResilience('viton_oring', -30)).toBeLessThan(0.2);
  });

  it('silicone (Tg -60) still resilient at -40°C', () => {
    expect(rubberResilience('silicone', -40)).toBeGreaterThan(0.9);
  });

  it('stays bounded in 0..1', () => {
    for (const t of [-200, -50, 0, 300]) {
      const r = rubberResilience('viton_oring', t);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe('dbttFactor', () => {
  it('steel_4340 embrittles strongly below DBTT (-40°C)', () => {
    expect(dbttFactor('steel_4340', -80)).toBeGreaterThan(0.8);
    expect(dbttFactor('steel_4340', 20)).toBeLessThan(0.05);
  });

  it('ti6al4v (DBTT -200°C) has minimal embrittlement at -100°C', () => {
    expect(dbttFactor('ti6al4v', -100)).toBeLessThan(0.01);
  });

  it('is half-embrittled at the DBTT and bounded in 0..1', () => {
    expect(dbttFactor('steel_4340', -40)).toBeCloseTo(0.5, 2);
    for (const t of [-250, -40, 0, 400]) {
      const f = dbttFactor('ti6al4v', t);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('tpsLimit', () => {
  it('silica_tile (Columbia) maxTempK > 1000', () => {
    expect(tpsLimit('silica_tile').maxTempK).toBeGreaterThan(1000);
  });

  it('silica_tile limit is ~1.5 MW/m² / ~1600 K', () => {
    expect(tpsLimit('silica_tile').maxHeatFluxMWm2).toBeCloseTo(1.5, 5);
    expect(tpsLimit('silica_tile').maxTempK).toBeCloseTo(1600, 0);
  });

  it('carbon_ablator survives more flux and heat than silica tile', () => {
    const c = tpsLimit('carbon_ablator');
    const s = tpsLimit('silica_tile');
    expect(c.maxHeatFluxMWm2).toBeGreaterThan(s.maxHeatFluxMWm2);
    expect(c.maxTempK).toBeGreaterThan(s.maxTempK);
  });
});

describe('cryoBoiloff', () => {
  it('LH2 loses more than a LOX-dominant combo in the same conditions', () => {
    expect(cryoBoiloff('LOX_LH2', 86400, 0.05)).toBeGreaterThan(
      cryoBoiloff('LOX_RP1', 86400, 0.05),
    );
  });

  it('scales linearly with time', () => {
    const oneDay = cryoBoiloff('LOX_LH2', 86400, 0.05);
    const twoDays = cryoBoiloff('LOX_LH2', 2 * 86400, 0.05);
    expect(twoDays).toBeCloseTo(2 * oneDay, 6);
  });

  it('LH2 loses ~0.1% of nominal load per day at typical insulation', () => {
    // nominal 100 t stage → ~100 kg/day
    expect(cryoBoiloff('LOX_LH2', 86400, 0.05)).toBeCloseTo(100, 0);
  });

  it('better insulation (higher factor) reduces losses', () => {
    expect(cryoBoiloff('LOX_LH2', 86400, 0.1)).toBeLessThan(
      cryoBoiloff('LOX_LH2', 86400, 0.05),
    );
  });
});
