import { describe, it, expect } from 'vitest';
import { computeEngine } from '../../src/physics/PropulsionEngine';

describe('PropulsionEngine LOX/RP-1', () => {
  const r = computeEngine({ propellantId: 'LOX_RP1', ofRatio: 2.3, pcMPa: 7, expansionRatio: 16 });

  it('Isp vac in 330–350s', () => {
    expect(r.ispVac).toBeGreaterThanOrEqual(330);
    expect(r.ispVac).toBeLessThanOrEqual(350);
  });

  it('cstar in 1500–1800 m/s', () => {
    expect(r.cstar).toBeGreaterThan(1500);
    expect(r.cstar).toBeLessThan(1800);
  });

  it('Cf ~1.5–1.8', () => {
    expect(r.cf).toBeGreaterThan(1.4);
    expect(r.cf).toBeLessThan(1.9);
  });

  it('sea-level Isp is below vacuum Isp', () => {
    expect(r.ispSl).toBeGreaterThan(0);
    expect(r.ispSl).toBeLessThan(r.ispVac);
  });

  it('specific thrust (F/ṁ) equals Isp_vac · g0', () => {
    expect(r.thrustPerMdot).toBeCloseTo(r.ispVac * 9.80665, 3);
  });

  it('off-optimal O/F costs Isp (mixture-ratio penalty)', () => {
    const opt = computeEngine({ propellantId: 'LOX_RP1', ofRatio: 2.3, pcMPa: 7, expansionRatio: 16 });
    const lean = computeEngine({ propellantId: 'LOX_RP1', ofRatio: 4.0, pcMPa: 7, expansionRatio: 16 });
    const rich = computeEngine({ propellantId: 'LOX_RP1', ofRatio: 1.5, pcMPa: 7, expansionRatio: 16 });

    expect(lean.ispVac).toBeLessThan(opt.ispVac * 0.95);
    expect(rich.ispVac).toBeLessThan(opt.ispVac * 0.95);
    expect(lean.reactedFraction).toBeLessThan(1);
    expect(opt.tcK).toBeCloseTo(3550, 6);
  });
});
