import { describe, expect, it } from 'vitest';
import { CONST } from '../../src/physics/constants';
import type { OrbitState, Vec3 } from '../../src/physics/OrbitalIntegrator';
import {
  lunarAcceleration,
  moonPositionAt,
  moonRelative,
  moonVelocityAt,
  solveEarthMoonTransfer,
  stepLunarRK4,
} from '../../src/physics/LunarDynamics';

const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const PARKING_ALT_KM = 200;

describe('地月转移物理', () => {
  it('TLI Δv 与飞行时间在真实 Hohmann 转移范围内', () => {
    const sol = solveEarthMoonTransfer(PARKING_ALT_KM);
    expect(sol.tliDvMs).toBeGreaterThan(3000);
    expect(sol.tliDvMs).toBeLessThan(3500);
    expect(sol.tofSec).toBeGreaterThan(4 * 86400);
    expect(sol.tofSec).toBeLessThan(6 * 86400);
    expect(sol.moonPhaseLeadRad).toBeGreaterThan(0);
    expect(sol.moonPhaseLeadRad).toBeLessThan(Math.PI);
    console.log('TLI:', sol);
  });

  it('按解算初态积分至 tof 后进入月球 SOI', () => {
    const sol = solveEarthMoonTransfer(PARKING_ALT_KM);
    const r0 = CONST.R_EARTH + PARKING_ALT_KM * 1000;
    const vc = Math.sqrt(CONST.MU_EARTH / r0);
    let state: OrbitState = {
      pos: [r0, 0, 0],
      vel: [0, vc + sol.tliDvMs, 0],
      t: 0,
    };
    const dt = 60;
    const steps = Math.ceil(sol.tofSec / dt);
    for (let i = 0; i < steps; i++) state = stepLunarRK4(state, dt);

    const rel = moonRelative(state, state.t);
    expect(norm(rel.pos)).toBeLessThan(CONST.MOON_SOI_M);
    expect(Number.isFinite(rel.speedMs)).toBe(true);
    expect(state.t).toBeCloseTo(steps * dt, 6);
    console.log('SOI arrival:', (rel.distM / 1000).toFixed(1), 'km, relative speed', rel.speedMs.toFixed(1), 'm/s');
  });

  it('月球附近月球引力远大于地球引力', () => {
    const moon = moonPositionAt(0);
    const near: Vec3 = [moon[0] + 500e3, moon[1], moon[2]];
    const a = lunarAcceleration(near, 0);
    // 月球对 500 km 高度处的加速度约 2 m/s²，方向应指向月心（-x）。
    expect(norm(a)).toBeGreaterThan(1);
    expect(a[0]).toBeLessThan(-1);
    // 同一点处地球引力只有约 0.003 m/s²。
    const earthOnly = norm([near[0], near[1], near[2]]) ** 2;
    const earthG = CONST.MU_EARTH / earthOnly;
    expect(earthG).toBeLessThan(Math.abs(a[0]) / 100);
    console.log('Near-moon gravity:', norm(a).toFixed(3), 'm/s², earth-only', earthG.toFixed(4), 'm/s²');
  });

  it('月球星历按 SIDEREAL 周期运动且速度大小一致', () => {
    const p0 = moonPositionAt(0);
    const p1 = moonPositionAt(12345);
    const v0 = moonVelocityAt(0);
    expect(norm(p0)).toBeCloseTo(CONST.MOON_SMA_M, 3);
    expect(norm(p1)).toBeCloseTo(CONST.MOON_SMA_M, 3);
    expect(norm(v0)).toBeCloseTo(CONST.MOON_OMEGA * CONST.MOON_SMA_M, 3);
    expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])).toBeGreaterThan(1e6);
    // 数值微分检验速度方向。
    const h = 1;
    const pa = moonPositionAt(12345 - h);
    const pb = moonPositionAt(12345 + h);
    const finite: Vec3 = [(pb[0] - pa[0]) / (2 * h), (pb[1] - pa[1]) / (2 * h), (pb[2] - pa[2]) / (2 * h)];
    const v = moonVelocityAt(12345);
    expect(norm(finite)).toBeGreaterThan(0);
    expect(norm([finite[0] - v[0], finite[1] - v[1], finite[2] - v[2]])).toBeLessThan(1e-6);
    console.log('Moon orbital speed:', norm(v0).toFixed(1), 'm/s');
  });
});
