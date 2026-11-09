/**
 * Space radiation dose model — DESIGN §6d.
 *
 * GCR (galactic cosmic rays): chronic, deep-space ~0.7 mSv/day; Earth's
 *   body/geomagnetic field roughly halves the LEO dose.
 * SPE (solar particle events): acute, hundreds of mSv–Sv within hours;
 *   attenuates exponentially through shielding mass.
 * Van Allen belts: trapped protons/electrons, spike during transit.
 *
 * Shielding traceability: polyethylene (high H content) is the best
 *   per-unit-mass shield. Linear attenuation coefficient μ ≈ 0.02 cm²/g
 *   gives ~63% attenuation at 50 g/cm² (≈ e^-1).
 */

/** Deep-space GCR dose rate (mSv/day) with no Earth shielding. */
const GCR_DEEP_SPACE_MSV_PER_DAY = 0.7;

/** Fraction of GCR dose removed by full LEO geomagnetic/body shielding. */
const GCR_LEO_SHIELD_FRACTION = 0.5;

/** Polyethylene linear attenuation coefficient (cm²/g). */
const POLY_ATTENUATION_PER_GMCM2 = 0.02;

/** Acute radiation sickness threshold (mSv). DESIGN §6d: >1 Sv. */
export const ACUTE_SICKNESS_MSV = 1000;

/**
 * Chronic GCR dose rate in mSv/day.
 * @param leoShieldingFactor 0 = deep space, 1 = full LEO earth shielding.
 */
export function gcrDoseRateMsvPerDay(leoShieldingFactor: number): number {
  const f = Math.min(1, Math.max(0, leoShieldingFactor));
  return GCR_DEEP_SPACE_MSV_PER_DAY * (1 - GCR_LEO_SHIELD_FRACTION * f);
}

/**
 * Acute SPE dose in mSv after passing shielding mass.
 * @param eventIntensity unshielded event dose (mSv), e.g. 100–2000.
 * @param shieldingGMcm2 areal shielding mass (g/cm²), e.g. polyethylene.
 */
export function speDoseMsv(eventIntensity: number, shieldingGMcm2: number): number {
  return eventIntensity * Math.exp(-POLY_ATTENUATION_PER_GMCM2 * shieldingGMcm2);
}

/**
 * Van Allen belt transit dose (mSv) per crossing.
 * low: shallow belt graze; high: high-inclination pass;
 * transfer: deep/geostationary transfer through the core.
 */
export function vanAllenDoseMsv(transitProfile: 'low' | 'high' | 'transfer'): number {
  switch (transitProfile) {
    case 'low':
      return 1;
    case 'high':
      return 10;
    case 'transfer':
      return 50;
  }
}

/** Accumulate dose exposure. */
export function accumulate(prevMsv: number, doseMsv: number): number {
  return prevMsv + doseMsv;
}