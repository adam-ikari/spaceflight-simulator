import { describe, expect, it } from 'vitest';
import { CONST } from '../../src/physics/constants';
import type { OrbitState, Vec3 } from '../../src/physics/OrbitalIntegrator';
import {
  lunarAscentCommand,
  lunarDescentCommand,
  thrustFromIsp,
} from '../../src/physics/LunarGuidance';

const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** Local test harness: moon gravity + constant thrust over each step, RK4. */
function stepWithThrust(state: OrbitState, dt: number, thrust: Vec3): OrbitState {
  const deriv = (s: OrbitState): { pos: Vec3; vel: Vec3 } => {
    const r2 = s.pos[0] ** 2 + s.pos[1] ** 2 + s.pos[2] ** 2;
    const k = -CONST.MU_MOON / (r2 * Math.sqrt(r2));
    return {
      pos: s.vel,
      vel: [
        k * s.pos[0] + thrust[0],
        k * s.pos[1] + thrust[1],
        k * s.pos[2] + thrust[2],
      ],
    };
  };
  const combine = (s: OrbitState, d: { pos: Vec3; vel: Vec3 }, h: number): OrbitState => ({
    pos: [s.pos[0] + d.pos[0] * h, s.pos[1] + d.pos[1] * h, s.pos[2] + d.pos[2] * h],
    vel: [s.vel[0] + d.vel[0] * h, s.vel[1] + d.vel[1] * h, s.vel[2] + d.vel[2] * h],
    t: s.t + h,
  });
  const k1 = deriv(state);
  const k2 = deriv(combine(state, k1, dt / 2));
  const k3 = deriv(combine(state, k2, dt / 2));
  const k4 = deriv(combine(state, k3, dt));
  const next = combine(state, k1, dt / 6);
  for (const k of [k2, k3, k4]) {
    const w = k === k2 ? 2 / 6 : k === k3 ? 2 / 6 : 1 / 6;
    next.pos[0] += k.pos[0] * dt * w;
    next.pos[1] += k.pos[1] * dt * w;
    next.pos[2] += k.pos[2] * dt * w;
    next.vel[0] += k.vel[0] * dt * w;
    next.vel[1] += k.vel[1] * dt * w;
    next.vel[2] += k.vel[2] * dt * w;
  }
  next.t = state.t + dt;
  return next;
}

describe('月球闭环制导', () => {
  it('100 km 圆轨道下降：3600 s 内触地且触地速度 ≤ 2 m/s', () => {
    const r0 = CONST.R_MOON + 100e3;
    const vc = Math.sqrt(CONST.MU_MOON / r0);
    let state: OrbitState = { pos: [r0, 0, 0], vel: [0, vc, 0], t: 0 };
    const dt = 1;
    let touchdownT = -1;
    let touchdownSpeed = Number.NaN;
    for (let i = 0; i < 3600 / dt; i++) {
      const cmd = lunarDescentCommand(state, state.t);
      expect(norm(cmd.accel)).toBeLessThanOrEqual(6 + 1e-9);
      state = stepWithThrust(state, dt, cmd.accel);
      if (norm(state.pos) <= CONST.R_MOON + 5) {
        touchdownT = state.t;
        touchdownSpeed = norm(state.vel);
        break;
      }
    }
    expect(touchdownT).toBeGreaterThan(0);
    expect(touchdownT).toBeLessThanOrEqual(3600);
    expect(touchdownSpeed).toBeLessThanOrEqual(2);
    console.log('Touchdown:', touchdownT.toFixed(0), 's, speed', touchdownSpeed.toFixed(3), 'm/s');
  });

  it('月面起飞：1200 s 内进入 100±10 km、切向速度接近圆轨道速度', () => {
    let state: OrbitState = { pos: [CONST.R_MOON, 0, 0], vel: [0, 0, 0], t: 0 };
    const dt = 1;
    let reachedT = -1;
    for (let i = 0; i < 1200 / dt; i++) {
      const cmd = lunarAscentCommand(state, state.t, 100);
      expect(Number.isFinite(cmd.accel[0])).toBe(true);
      expect(norm(cmd.accel)).toBeLessThanOrEqual(6 + 1e-9);
      state = stepWithThrust(state, dt, cmd.accel);
      const r = norm(state.pos);
      const vr = (state.vel[0] * state.pos[0] + state.vel[1] * state.pos[1] + state.vel[2] * state.pos[2]) / r;
      const vh = Math.sqrt(Math.max(0, norm(state.vel) ** 2 - vr ** 2));
      const vCirc = Math.sqrt(CONST.MU_MOON / r);
      if (reachedT < 0 && Math.abs(r - CONST.R_MOON - 100e3) <= 10e3 && Math.abs(vh - vCirc) / vCirc <= 0.05) {
        reachedT = state.t;
      }
    }
    expect(reachedT).toBeGreaterThan(0);
    expect(reachedT).toBeLessThanOrEqual(1200);
    console.log('Ascent orbit insertion:', reachedT.toFixed(0), 's, altitude',
      ((norm(state.pos) - CONST.R_MOON) / 1000).toFixed(2), 'km, final speed', norm(state.vel).toFixed(1), 'm/s');
  });

  it('有限燃烧 thrustFromIsp：质量按 Isp 与 g0 守恒', () => {
    const m0 = 1e6;
    const thrust = 1e6;
    const isp = 300;
    const dt = 10;
    const burn = thrustFromIsp(thrust, isp, m0, dt);
    const expectedMass = m0 - (thrust * dt) / (isp * CONST.G0);
    expect(burn.massKg).toBeCloseTo(expectedMass, 6);
    expect(burn.dvMs).toBeCloseTo(isp * CONST.G0 * Math.log(m0 / expectedMass), 6);
    expect(thrustFromIsp(0, isp, m0, dt)).toEqual({ dvMs: 0, massKg: m0 });
    console.log('Finite burn: mass', m0, '→', burn.massKg.toFixed(3), 'kg, Δv', burn.dvMs.toFixed(6), 'm/s');
  });
});
