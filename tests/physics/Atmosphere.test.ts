import { describe, it, expect } from 'vitest';
import { density, dragForce, dynamicPressure } from '../../src/physics/Atmosphere';

describe('atmosphere', () => {
  it('density ~1.225 at sea level', () => {
    expect(density(0)).toBeCloseTo(1.225, 1);
  });

  it('density ~0 at 100km', () => {
    expect(density(100000)).toBeLessThan(1e-5);
  });

  it('max-q > 10 kPa in realistic ascent region', () => {
    expect(dynamicPressure(300, 11000)).toBeGreaterThan(10000);
  });

  it('density decreases monotonically over ascent layer', () => {
    let prev = density(0);
    for (let h = 1000; h <= 80000; h += 1000) {
      const rho = density(h);
      expect(rho).toBeLessThan(prev);
      prev = rho;
    }
  });

  it('dynamicPressure = ½ρv²', () => {
    const v = 250;
    const h = 5000;
    expect(dynamicPressure(v, h)).toBeCloseTo(0.5 * density(h) * v * v, 6);
  });

  it('dragForce = ½ρv²CdA', () => {
    const v = 200;
    const h = 3000;
    const Cd = 0.3;
    const A = 10;
    expect(dragForce(v, h, Cd, A)).toBeCloseTo(
      dynamicPressure(v, h) * Cd * A,
      6,
    );
  });
});
