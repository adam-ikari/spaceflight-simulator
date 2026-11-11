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

  it('is step-size converged: one orbit at dt=10 s vs dt=0.5 s agree <0.01%', () => {
    const r = CONST.R_EARTH + 400_000;
    const v = circularOrbitVelocity(400_000);
    const T = 2 * Math.PI * Math.sqrt(r ** 3 / CONST.MU_EARTH);

    const run = (dt: number): OrbitState => {
      let s: OrbitState = { pos: [r, 0, 0], vel: [0, v, 0], t: 0 };
      const steps = Math.round(T / dt);
      for (let i = 0; i < steps; i++) s = stepRK4(s, dt);
      return s;
    };

    const coarse = run(10);
    const fine = run(0.5);
    const rC = Math.hypot(coarse.pos[0], coarse.pos[1], coarse.pos[2]);
    const rF = Math.hypot(fine.pos[0], fine.pos[1], fine.pos[2]);
    const vC = Math.hypot(coarse.vel[0], coarse.vel[1], coarse.vel[2]);
    const vF = Math.hypot(fine.vel[0], fine.vel[1], fine.vel[2]);
    expect(Math.abs(rC - rF) / rF).toBeLessThan(1e-4);
    expect(Math.abs(vC - vF) / vF).toBeLessThan(1e-4);
  });
});
