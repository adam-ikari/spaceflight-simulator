/**
 * Atmosphere model — US Standard Atmosphere 1976 density table.
 *
 * The previous layered exponential approximation used scale heights that are
 * valid near the ground but wrong above 20 km: at 50 km it returned
 * 3.6e-2 kg/m³ against the standard 1.03e-3 (35× high), which inflated entry
 * heating and dynamic pressure. This table is log-linearly interpolated between
 * standard values, so q̇ and q match the reference profile.
 *
 * Density table: altitude in km, density in kg/m³ (USSA-1976, 0–120 km).
 */

import { CONST } from './constants';

const TABLE: readonly [number, number][] = [
  [0, 1.225], [2, 1.0065], [4, 0.81935], [6, 0.66011], [8, 0.52579],
  [10, 0.41351], [12, 0.31194], [14, 0.22790], [16, 0.16646], [18, 0.12165],
  [20, 0.088910], [24, 0.046940], [28, 0.025076], [32, 0.013549],
  [36, 0.007257], [40, 0.003996], [44, 0.002259], [48, 0.001317],
  [50, 0.001027], [54, 0.0006389], [58, 0.0004075], [60, 0.0003097],
  [64, 0.0001859], [68, 0.0001146], [70, 0.00008283], [74, 0.00004585],
  [78, 0.00002580], [80, 0.00001846], [84, 0.000009518], [88, 0.000004974],
  [90, 0.000003420], [94, 0.000001630], [98, 0.0000007920],
  [100, 0.0000005596], [105, 0.0000002062], [110, 0.0000000974],
  [115, 0.0000000506], [120, 0.0000000249],
];

const CEILING_KM = 120;

/** Air density in kg/m³ at geometric altitude hMeters. */
export function density(hMeters: number): number {
  const hKm = hMeters / 1000;
  if (hKm <= 0) return CONST.RHO0;
  if (hKm >= CEILING_KM) return 0;

  // Log-linear interpolation preserves the exponential character between
  // tabulated points and is exact at the nodes.
  let lo = 0;
  let hi = TABLE.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (TABLE[mid][0] <= hKm) lo = mid;
    else hi = mid;
  }
  const [h0, r0] = TABLE[lo];
  const [h1, r1] = TABLE[hi];
  const f = (hKm - h0) / (h1 - h0);
  return Math.exp(Math.log(r0) + f * (Math.log(r1) - Math.log(r0)));
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
