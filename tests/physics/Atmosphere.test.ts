import { describe, it, expect } from 'vitest';
import { density, dragForce, dynamicPressure } from '../../src/physics/Atmosphere';

describe('atmosphere', () => {
  it('density ~1.225 at sea level', () => {
    expect(density(0)).toBeCloseTo(1.225, 1);
  });

  it('density ~0 at 100km', () => {
    expect(density(100000)).toBeLessThan(1e-5);
  });

  it('matches USSA-1976 at the altitudes that set entry heating', () => {
    // These are the values the old exponential model got wrong by 20-35×.
    expect(density(50_000)).toBeCloseTo(1.027e-3, 6);
    expect(density(60_000)).toBeCloseTo(3.097e-4, 7);
    expect(density(70_000)).toBeCloseTo(8.283e-5, 8);
    expect(density(80_000)).toBeCloseTo(1.846e-5, 8);
    expect(density(90_000)).toBeCloseTo(3.42e-6, 8);
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
