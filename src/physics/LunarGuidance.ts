import { CONST } from './constants';
import type { OrbitState, Vec3 } from './OrbitalIntegrator';

export interface BurnCommand {
  accel: Vec3;
  throttle: number;
  active: boolean;
}

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

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function radialUnit(pos: Vec3): Vec3 {
  const r = Math.max(normVec(pos), 1e-6);
  return [pos[0] / r, pos[1] / r, pos[2] / r];
}

/** Prograde local-horizontal direction, defined even when the craft is at rest. */
function progradeUnit(rhat: Vec3): Vec3 {
  const t: Vec3 = [rhat[1], -rhat[0], 0];
  const n = normVec(t);
  return n > 1e-6 ? scaleVec(t, 1 / n) : [1, 0, 0];
}

/** Convert desired net acceleration into a bounded thrust command (gravity
 * compensation included: thrust = desired net acceleration − gravity). */
function burnForNetAccel(desired: Vec3, pos: Vec3, maxAccelMs2: number): BurnCommand {
  const r = Math.max(normVec(pos), 1e-6);
  const g = CONST.MU_MOON / r ** 2;
  const rhat = radialUnit(pos);
  const thrust = addVec(desired, scaleVec(rhat, g));
  const mag = normVec(thrust);
  if (mag < 1e-9 || maxAccelMs2 <= 0) {
    return { accel: [0, 0, 0], throttle: 0, active: false };
  }
  const limit = Math.min(mag, maxAccelMs2);
  return {
    accel: scaleVec(thrust, limit / mag),
    throttle: limit / maxAccelMs2,
    active: true,
  };
}

/**
 * Closed-loop powered descent in a moon-centred inertial frame.
 * Tracks a height-dependent radial speed profile and brakes horizontal speed,
 * then compensates lunar gravity; thrust is saturated at maxAccelMs2.
 */
export function lunarDescentCommand(
  state: OrbitState,
  _tSec: number,
  maxAccelMs2 = 6,
): BurnCommand {
  const rhat = radialUnit(state.pos);
  const r = Math.max(normVec(state.pos), 1e-6);
  const altitude = r - CONST.R_MOON;
  const vr = dotVec(state.vel, rhat);
  const horizontalVel = subVec(state.vel, scaleVec(rhat, vr));

  const vrTarget = -Math.min(80, 0.04 * altitude + 1);
  const radialAccel = 0.5 * (vrTarget - vr);
  const horizontalAccel = scaleVec(horizontalVel, -1 / 150);
  const desired = addVec(scaleVec(rhat, radialAccel), horizontalAccel);
  return burnForNetAccel(desired, state.pos, maxAccelMs2);
}

/**
 * Closed-loop ascent to a lunar circular orbit. Tracks a capped radial speed
 * that tapers near the target altitude and builds tangential speed towards the
 * local circular velocity; lunar gravity is compensated inside the burn.
 */
export function lunarAscentCommand(
  state: OrbitState,
  _tSec: number,
  targetAltKm = 100,
  maxAccelMs2 = 6,
): BurnCommand {
  const rhat = radialUnit(state.pos);
  const r = Math.max(normVec(state.pos), 1e-6);
  const targetR = CONST.R_MOON + targetAltKm * 1000;
  const gap = targetR - r;
  const vr = dotVec(state.vel, rhat);
  const horizontalVel = subVec(state.vel, scaleVec(rhat, vr));

  const vrTarget = Math.max(-20, Math.min(120, 0.05 * gap));
  const radialAccel = 0.8 * (vrTarget - vr);
  const vCirc = Math.sqrt(CONST.MU_MOON / r);
  const desiredHorizontalVel = scaleVec(progradeUnit(rhat), vCirc);
  const horizontalAccel = scaleVec(subVec(desiredHorizontalVel, horizontalVel), 1 / 250);
  const desired = addVec(scaleVec(rhat, radialAccel), horizontalAccel);
  return burnForNetAccel(desired, state.pos, maxAccelMs2);
}

/** Finite burn: thrust a = T/m and mass flow ṁ = −T/(Isp·g0), integrated exactly. */
export function thrustFromIsp(
  thrustN: number,
  ispSec: number,
  massKg: number,
  dtSec: number,
): { dvMs: number; massKg: number } {
  const exhaustVelocity = ispSec * CONST.G0;
  if (!(thrustN > 0) || !(exhaustVelocity > 0) || !(massKg > 0) || !(dtSec > 0)) {
    return { dvMs: 0, massKg };
  }
  const massFlow = thrustN / exhaustVelocity;
  const burnSec = Math.min(dtSec, massKg / massFlow);
  const finalMass = massKg - massFlow * burnSec;
  return { dvMs: exhaustVelocity * Math.log(massKg / finalMass), massKg: finalMass };
}
