import { CONST } from './constants';
import type { OrbitState, Vec3 } from './OrbitalIntegrator';

export interface TransferSolution {
  tliDvMs: number;
  tofSec: number;
  moonPhaseLeadRad: number;
}

/** Parking orbit used to anchor the moon ephemeris phase at t = 0 (TLI). */
const REFERENCE_PARKING_ALT_KM = 200;
/** Aim point offset at arrival: keeps the flyby outside the lunar point-mass singularity. */
const ARRIVAL_LEAD_BIAS_RAD = 0.05;

const REFERENCE_TRANSFER = solveEarthMoonTransfer(REFERENCE_PARKING_ALT_KM);

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function normVec(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/**
 * Hohmann transfer from circular Earth parking orbit to the moon's mean orbit.
 * Phase lead is the moon's angle at TLI relative to the spacecraft's perigee
 * position, biased so arrival is a flyby rather than a point-mass collision.
 */
export function solveEarthMoonTransfer(parkingAltKm: number): TransferSolution {
  const r1 = CONST.R_EARTH + parkingAltKm * 1000;
  const r2 = CONST.MOON_SMA_M;
  const sma = (r1 + r2) / 2;
  const vCircular = Math.sqrt(CONST.MU_EARTH / r1);
  const vPerigee = Math.sqrt(CONST.MU_EARTH * (2 / r1 - 1 / sma));
  const tofSec = Math.PI * Math.sqrt(sma ** 3 / CONST.MU_EARTH);
  const moonPhaseLeadRad = Math.PI - CONST.MOON_OMEGA * tofSec + ARRIVAL_LEAD_BIAS_RAD;
  return { tliDvMs: vPerigee - vCircular, tofSec, moonPhaseLeadRad };
}

/** Moon position in ECI metres; t = 0 is the reference TLI epoch. */
export function moonPositionAt(tSec: number): Vec3 {
  const theta = REFERENCE_TRANSFER.moonPhaseLeadRad + CONST.MOON_OMEGA * tSec;
  return [
    CONST.MOON_SMA_M * Math.cos(theta),
    CONST.MOON_SMA_M * Math.sin(theta),
    0,
  ];
}

/** Moon velocity in ECI m/s (circular prograde orbit). */
export function moonVelocityAt(tSec: number): Vec3 {
  const theta = REFERENCE_TRANSFER.moonPhaseLeadRad + CONST.MOON_OMEGA * tSec;
  const speed = CONST.MOON_OMEGA * CONST.MOON_SMA_M;
  return [-speed * Math.sin(theta), speed * Math.cos(theta), 0];
}

/** Earth point mass + moon point mass; no J2 (transfer apogee is far outside it). */
export function lunarAcceleration(pos: Vec3, tSec: number): Vec3 {
  const r = Math.max(normVec(pos), 1e-6);
  const earth = scaleVec(pos, -CONST.MU_EARTH / r ** 3);
  const moonOffset = subVec(pos, moonPositionAt(tSec));
  const d = Math.max(normVec(moonOffset), 1e-3);
  const moon = scaleVec(moonOffset, -CONST.MU_MOON / d ** 3);
  return addVec(earth, moon);
}

/** RK4 step with the acceleration re-evaluated at each intermediate epoch. */
export function stepLunarRK4(state: OrbitState, dtSec: number): OrbitState {
  const deriv = (s: OrbitState): { dPos: Vec3; dVel: Vec3; dT: number } => ({
    dPos: s.vel,
    dVel: lunarAcceleration(s.pos, s.t),
    dT: 1,
  });
  const advance = (
    s: OrbitState,
    k: { dPos: Vec3; dVel: Vec3; dT: number },
    h: number,
  ): OrbitState => ({
    pos: addVec(s.pos, scaleVec(k.dPos, h)),
    vel: addVec(s.vel, scaleVec(k.dVel, h)),
    t: s.t + k.dT * h,
  });
  const k1 = deriv(state);
  const k2 = deriv(advance(state, k1, dtSec / 2));
  const k3 = deriv(advance(state, k2, dtSec / 2));
  const k4 = deriv(advance(state, k3, dtSec));
  const next = advance(state, k1, dtSec / 6);
  for (const [k, weight] of [[k2, 2 / 6], [k3, 2 / 6], [k4, 1 / 6]] as const) {
    next.pos = addVec(next.pos, scaleVec(k.dPos, dtSec * weight));
    next.vel = addVec(next.vel, scaleVec(k.dVel, dtSec * weight));
    next.t += k.dT * dtSec * weight;
  }
  next.t = state.t + dtSec;
  return next;
}

/** Moon-relative position, velocity, distance and speed at a given epoch. */
export function moonRelative(
  state: OrbitState,
  tSec: number,
): { pos: Vec3; vel: Vec3; distM: number; speedMs: number } {
  const pos = subVec(state.pos, moonPositionAt(tSec));
  const vel = subVec(state.vel, moonVelocityAt(tSec));
  return {
    pos,
    vel,
    distM: normVec(pos),
    speedMs: normVec(vel),
  };
}
