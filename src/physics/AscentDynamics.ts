/**
 * Ascent dynamics — 2D gravity-turn trajectory with gravity and drag losses.
 *
 * Thrust direction follows a prescribed pitch program, quoted as the angle from
 * vertical: vertical to 1 km, 45° from vertical by 40 km, and horizontal above
 * 190 km. Speed and flight-path angle are integrated in the vertical plane with
 * thrust, drag, gravity and the centrifugal term (v/r), using fixed-step Euler
 * at dt = 1 s.
 *
 * Losses are the velocity increments spent against gravity and drag rather than
 * added to inertial speed:
 *   gravityLoss = ∫ g·sin(γ) dt   (γ = flight path angle above the horizon)
 *   dragLoss    = ∫ (D/m) dt
 * so the ideal Δv splits approximately as Δv = v_final + gravityLoss + dragLoss.
 *
 * Burn stops when the vehicle reaches local circular speed (orbital insertion),
 * so upper-stage propellant need not all be spent.
 *
 * This is a feasibility/trajectory model, not a closed-loop guidance law.
 */
import { CONST } from './constants';
import { StageSpec, stagePerformance } from './RocketEquation';
import { dragForce, dynamicPressure } from './Atmosphere';

export interface StageAscentState {
  index: number;
  burnTimeS: number;
  startSpeedMs: number;
  endSpeedMs: number;
  endAltitudeKm: number;
  endFlightPathDeg: number;
}

export interface AscentResult {
  maxQPa: number;
  gravityLossMs: number;
  dragLossMs: number;
  finalState: { altitudeKm: number; speedMs: number };
  stageStates: StageAscentState[];
}

/** Integration step, s. */
const DT = 1;
/** Drag coefficient and frontal area (Saturn V class). */
const CD = 0.3;
const AREA_M2 = 80;

const DEG = Math.PI / 180;

/** Pitch program: thrust angle from vertical (rad) versus altitude, km. */
function pitchFromVertical(altKm: number): number {
  if (altKm <= 1) return 0;
  if (altKm <= 40) return ((altKm - 1) / 39) * 45 * DEG;
  if (altKm <= 140) return 45 * DEG + ((altKm - 40) / 100) * 15 * DEG;
  if (altKm <= 190) return 60 * DEG + ((altKm - 140) / 50) * 30 * DEG;
  return 90 * DEG;
}

export function simulateAscent(stages: StageSpec[], payloadKg: number): AscentResult {
  let altitude = 0;
  let speed = 0;
  /** Flight-path angle above the local horizon, rad. */
  let gamma = 90 * DEG;
  let maxQPa = 0;
  let gravityLossMs = 0;
  let dragLossMs = 0;

  const stageStates: StageAscentState[] = [];

  const result = (): AscentResult => ({
    maxQPa,
    gravityLossMs,
    dragLossMs,
    finalState: { altitudeKm: altitude / 1000, speedMs: speed },
    stageStates,
  });

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    // Stack mass at ignition: own dry + propellant plus all later stages + payload.
    let totalMassKg = payloadKg;
    for (let j = i; j < stages.length; j++) {
      totalMassKg += stages[j].dryMassKg + stages[j].propellantMassKg;
    }

    const perf = stagePerformance(stage, totalMassKg);
    let mass = totalMassKg;
    const startSpeed = speed;

    for (let t = 0; t < perf.burnTimeS && mass > 0; t += DT) {
      const dt = Math.min(DT, perf.burnTimeS - t);
      const r = CONST.R_EARTH + altitude;
      const g = CONST.MU_EARTH / (r * r);
      const drag = dragForce(speed, altitude, CD, AREA_M2);
      const q = dynamicPressure(speed, altitude);
      if (q > maxQPa) maxQPa = q;

      // Thrust axis above the horizon from the pitch program; alpha is the
      // angle of attack between thrust and the velocity vector.
      const thrustAngle = Math.PI / 2 - pitchFromVertical(altitude / 1000);
      const alpha = thrustAngle - gamma;
      const thrustAccel = stage.thrustN / mass;
      const dragAccel = drag / mass;

      speed += (thrustAccel * Math.cos(alpha) - dragAccel - g * Math.sin(gamma)) * dt;
      gamma +=
        ((thrustAccel * Math.sin(alpha)) / Math.max(speed, 1) +
          (speed / r - g / Math.max(speed, 1)) * Math.cos(gamma)) *
        dt;
      altitude += speed * Math.sin(gamma) * dt;
      if (altitude < 0) altitude = 0;
      mass -= perf.mdot * dt;

      if (speed >= Math.sqrt(CONST.MU_EARTH / r)) {
        // Orbital insertion: engine cutoff.
        stageStates.push({
          index: i,
          burnTimeS: perf.burnTimeS,
          startSpeedMs: startSpeed,
          endSpeedMs: speed,
          endAltitudeKm: altitude / 1000,
          endFlightPathDeg: gamma / DEG,
        });
        return result();
      }

      if (Math.sin(gamma) > 0) gravityLossMs += g * Math.sin(gamma) * dt;
      dragLossMs += dragAccel * dt;
    }

    stageStates.push({
      index: i,
      burnTimeS: perf.burnTimeS,
      startSpeedMs: startSpeed,
      endSpeedMs: speed,
      endAltitudeKm: altitude / 1000,
      endFlightPathDeg: gamma / DEG,
    });
  }

  return result();
}
