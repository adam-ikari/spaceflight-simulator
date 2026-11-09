import { describe, it, expect } from 'vitest';
import {
  stepRK4,
  circularOrbitVelocity,
  type OrbitState,
} from '../../src/physics/OrbitalIntegrator';
import { CONST } from '../../src/physics/constants';

describe('circularOrbitVelocity', () => {
  it('400 km circular ≈ 7672 m/s (±5)', () => {
    const v = circularOrbitVelocity(400_000);
    expect(v).toBeGreaterThan(7672 - 5);
    expect(v).toBeLessThan(7672 + 5);
  });

  it('decreases with altitude', () => {
    expect(circularOrbitVelocity(500_000)).toBeLessThan(
      circularOrbitVelocity(400_000),
    );
  });
});

describe('stepRK4 with J2', () => {
  it('400 km circular orbit: radial drift < 0.1% over one period', () => {
    const r = CONST.R_EARTH + 400_000;
    const v = circularOrbitVelocity(400_000);
    const T = 2 * Math.PI * Math.sqrt(r ** 3 / CONST.MU_EARTH);
    const dt = 1;

    let s: OrbitState = { pos: [r, 0, 0], vel: [0, v, 0], t: 0 };
    const steps = Math.round(T / dt);
    for (let i = 0; i < steps; i++) {
      s = stepRK4(s, dt);
    }

    const rFinal = Math.hypot(s.pos[0], s.pos[1], s.pos[2]);
    const drift = Math.abs(rFinal - r) / r;
    expect(drift).toBeLessThan(0.001);
  });

  it('preserves energy approximately (no blow-up)', () => {
    const r = CONST.R_EARTH + 400_000;
    const v = circularOrbitVelocity(400_000);
    const T = 2 * Math.PI * Math.sqrt(r ** 3 / CONST.MU_EARTH);
    const dt = 1;

    let s: OrbitState = { pos: [r, 0, 0], vel: [0, v, 0], t: 0 };
    const steps = Math.round(T / dt);
    for (let i = 0; i < steps; i++) s = stepRK4(s, dt);

    const rFinal = Math.hypot(s.pos[0], s.pos[1], s.pos[2]);
    const vFinal = Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
    const E0 = v * v / 2 - CONST.MU_EARTH / r;
    const E1 = vFinal * vFinal / 2 - CONST.MU_EARTH / rFinal;
    expect(Math.abs((E1 - E0) / E0)).toBeLessThan(0.01);
  });
});
