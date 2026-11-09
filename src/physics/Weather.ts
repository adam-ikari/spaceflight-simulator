/**
 * Weather — launch-site conditions, go/no-go commit criteria and ascent wind load.
 * DESIGN.md §6g: ground gusts >10 m/s, wind shear >30 m/s·km, ambient temperature
 * below the O-ring cold limit (Challenger, 51-L), lightning risk, cloud ceiling and
 * recovery sea state each block launch. Wind load feeds structure bending moment.
 */

import { density } from './Atmosphere';

export interface WeatherState {
  groundWindMs: number;
  windShearPerKm: number;
  tempC: number;
  lightningRisk: number;
  cloudCeilingM: number;
  seaWaveM: number;
}

export interface LaunchCommit {
  go: boolean;
  violations: string[];
}

/** Ground gust limit for a crewed vehicle on the pad (m/s). */
const WIND_LIMIT_MS = 10;
/** Vertical wind-shear limit (m/s per km). */
const SHEAR_LIMIT_PER_KM = 30;
/**
 * O-ring cold limit (°C). Challenger launched at 2 °C after a night below
 * freezing; the joint lost resilience below ~-1 °C.
 */
const TEMP_FLOOR_C = -1;
/** Field-mill / thunderstorm launch-commit probability limit. */
const LIGHTNING_LIMIT = 0.3;
/** Cloud ceiling for visual range/tracking (m). */
const CLOUD_FLOOR_M = 1000;
/** Recovery sea-state limit (significant wave height, m). */
const WAVE_LIMIT_M = 3;

/** Launch commit criteria: any violated constraint grounds the vehicle. */
export function evaluateLaunch(w: WeatherState): LaunchCommit {
  const violations: string[] = [];

  if (w.groundWindMs > WIND_LIMIT_MS) {
    violations.push(`wind: ground ${w.groundWindMs.toFixed(1)} m/s > ${WIND_LIMIT_MS} m/s`);
  }
  if (w.windShearPerKm > SHEAR_LIMIT_PER_KM) {
    violations.push(
      `shear: ${w.windShearPerKm.toFixed(1)} m/s/km > ${SHEAR_LIMIT_PER_KM} m/s/km`,
    );
  }
  if (w.tempC < TEMP_FLOOR_C) {
    violations.push(`temp: ${w.tempC.toFixed(1)} °C < ${TEMP_FLOOR_C} °C (O-ring cold limit)`);
  }
  if (w.lightningRisk > LIGHTNING_LIMIT) {
    violations.push(`lightning: risk ${w.lightningRisk.toFixed(2)} > ${LIGHTNING_LIMIT}`);
  }
  if (w.cloudCeilingM < CLOUD_FLOOR_M) {
    violations.push(`cloud: ceiling ${w.cloudCeilingM} m < ${CLOUD_FLOOR_M} m`);
  }
  if (w.seaWaveM > WAVE_LIMIT_M) {
    violations.push(`wave: ${w.seaWaveM.toFixed(1)} m > ${WAVE_LIMIT_M} m`);
  }

  return { go: violations.length === 0, violations };
}

/**
 * Bending-moment proxy from wind load at altKm: the vehicle is treated as a
 * cantilever with distributed lateral pressure q = ½ρv² integrated over the
 * lever arm, so M ≈ ½·ρ·v²·h. Wind speed follows a linear profile
 * v(h) = groundWind + shear·h (shear in m/s per km, h in km).
 */
export function windLoadMoment(w: WeatherState, altKm: number): number {
  const hM = altKm * 1000;
  const v = w.groundWindMs + w.windShearPerKm * altKm;
  return 0.5 * density(hM) * v * v * hM;
}
