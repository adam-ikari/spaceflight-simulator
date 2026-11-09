import { CONST } from './constants';

export type Vec3 = [number, number, number];

export interface OrbitState {
  pos: Vec3;
  vel: Vec3;
  t: number;
}

/**
 * Circular orbit speed at given altitude (m above Earth's surface).
 * v = sqrt(μ / (R_earth + h))
 */
export function circularOrbitVelocity(altitudeM: number): number {
  return Math.sqrt(CONST.MU_EARTH / (CONST.R_EARTH + altitudeM));
}

/**
 * Total gravitational acceleration including J2 perturbation.
 * Equatorial frame: z = Earth spin axis.
 *
 * a = -μ r/r³  (central term)
 * a_J2 = -(3/2)·J2·μ·R²/r⁵ · [ (1 - 5(z/r)²)·x,
 *                               (1 - 5(z/r)²)·y,
 *                               (3 - 5(z/r)²)·z ]
 */
function accel(pos: Vec3): Vec3 {
  const [x, y, z] = pos;
  const r2 = x * x + y * y + z * z;
  const r = Math.sqrt(r2);
  const r3 = r2 * r;

  // Central gravity
  const muOverR3 = CONST.MU_EARTH / r3;
  const ax = -muOverR3 * x;
  const ay = -muOverR3 * y;
  const az = -muOverR3 * z;

  // J2 perturbation
  const zr = z / r; // cos(colatitude)
  const zr2 = zr * zr;
  const k = -1.5 * CONST.J2 * CONST.MU_EARTH * CONST.R_EARTH * CONST.R_EARTH / (r2 * r3);
  // r²·r³ = r⁵
  const j2x = k * (1 - 5 * zr2) * x;
  const j2y = k * (1 - 5 * zr2) * y;
  const j2z = k * (3 - 5 * zr2) * z;

  return [ax + j2x, ay + j2y, az + j2z];
}

/**
 * Derivative of state: [vel, accel, 1].
 * Returns a tuple suitable for RK4 combining.
 */
function deriv(s: OrbitState): { dPos: Vec3; dVel: Vec3; dT: number } {
  return { dPos: s.vel, dVel: accel(s.pos), dT: 1 };
}

/** Combine two OrbitState-like for RK4 (weighted). */
function addStates(
  base: OrbitState,
  k: { dPos: Vec3; dVel: Vec3; dT: number },
  h: number,
): OrbitState {
  return {
    pos: [base.pos[0] + k.dPos[0] * h, base.pos[1] + k.dPos[1] * h, base.pos[2] + k.dPos[2] * h],
    vel: [base.vel[0] + k.dVel[0] * h, base.vel[1] + k.dVel[1] * h, base.vel[2] + k.dVel[2] * h],
    t: base.t + k.dT * h,
  };
}

/**
 * Single RK4 integration step (includes J2).
 */
export function stepRK4(s: OrbitState, dt: number): OrbitState {
  const k1 = deriv(s);
  const k2 = deriv(addStates(s, k1, dt / 2));
  const k3 = deriv(addStates(s, k2, dt / 2));
  const k4 = deriv(addStates(s, k3, dt));

  return {
    pos: [
      s.pos[0] + (dt / 6) * (k1.dPos[0] + 2 * k2.dPos[0] + 2 * k3.dPos[0] + k4.dPos[0]),
      s.pos[1] + (dt / 6) * (k1.dPos[1] + 2 * k2.dPos[1] + 2 * k3.dPos[1] + k4.dPos[1]),
      s.pos[2] + (dt / 6) * (k1.dPos[2] + 2 * k2.dPos[2] + 2 * k3.dPos[2] + k4.dPos[2]),
    ],
    vel: [
      s.vel[0] + (dt / 6) * (k1.dVel[0] + 2 * k2.dVel[0] + 2 * k3.dVel[0] + k4.dVel[0]),
      s.vel[1] + (dt / 6) * (k1.dVel[1] + 2 * k2.dVel[1] + 2 * k3.dVel[1] + k4.dVel[1]),
      s.vel[2] + (dt / 6) * (k1.dVel[2] + 2 * k2.dVel[2] + 2 * k3.dVel[2] + k4.dVel[2]),
    ],
    t: s.t + dt,
  };
}
