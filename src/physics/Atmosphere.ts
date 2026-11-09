/**
 * Atmosphere model — US Standard Atmosphere 1976 layered exponential approximation.
 *
 * Density within a layer: ρ(h) = ρ(base)·exp(-(h-base)/H), with ρ(base) carried
 * over from the top of the layer below so the profile stays continuous.
 * Layer scale heights (0–11 km 8434 m, 11–25 km 12716 m, 25–50 km 22416 m,
 * 50–85 km 6000 m) approximate the 1976 standard. Above 85 km density is
 * treated as zero (below 1e-5 kg/m³, negligible for ascent/descent).
 *
 * Sea-level density ρ0 = 1.225 kg/m³ (CONST.RHO0).
 */

import { CONST } from './constants';

interface Layer {
  base: number;
  H: number;
}

const LAYERS: readonly Layer[] = [
  { base: 0, H: 8434 },
  { base: 11000, H: 12716 },
  { base: 25000, H: 22416 },
  { base: 50000, H: 6000 },
];

const CEILING = 85000;

// Density at each layer base, propagated upward for continuity.
const BASE_RHO: number[] = [];
for (let i = 0; i < LAYERS.length; i++) {
  if (i === 0) {
    BASE_RHO.push(CONST.RHO0);
  } else {
    const below = LAYERS[i - 1];
    const dh = LAYERS[i].base - below.base;
    BASE_RHO.push(BASE_RHO[i - 1] * Math.exp(-dh / below.H));
  }
}

/** Air density in kg/m³ at geometric altitude hMeters. */
export function density(hMeters: number): number {
  if (hMeters >= CEILING) return 0;
  if (hMeters <= 0) return CONST.RHO0;

  for (let i = LAYERS.length - 1; i >= 0; i--) {
    const { base, H } = LAYERS[i];
    if (hMeters >= base) {
      return BASE_RHO[i] * Math.exp(-(hMeters - base) / H);
    }
  }
  return CONST.RHO0;
}

/** Dynamic pressure q = ½ρv² in Pa. */
export function dynamicPressure(vMs: number, hMeters: number): number {
  return 0.5 * density(hMeters) * vMs * vMs;
}

/** Aerodynamic drag force F = ½ρv²CdA in N. */
export function dragForce(
  vMs: number,
  hMeters: number,
  Cd: number,
  A_m2: number,
): number {
  return dynamicPressure(vMs, hMeters) * Cd * A_m2;
}
