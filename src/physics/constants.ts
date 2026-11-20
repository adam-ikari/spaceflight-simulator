/**
 * Physical constants — traceable to standard references.
 * g0: WMO standard gravity (9.80665 m/s²).
 * R_u: universal gas constant (8314.46 J/(kmol·K)).
 * μ_earth: GRACE-derived GM (3.986004418e14 m³/s²).
 * R_earth: mean radius (6371 km → m).
 * J2: Earth's second zonal harmonic (1.08263e-3).
 * ρ0: sea-level air density (1.225 kg/m³, US Std Atm 1976).
 * Solar constant (1361 W/m², Kopp & Lean 2011).
 * Stefan-Boltzmann (5.67e-8 W/(m²·K⁴)).
 * μ_moon: lunar GM (4.9048695e12 m³/s²).
 * R_moon: mean lunar radius (1737.4 km).
 * Moon SMA / sidereal period / SOI: mean Earth–Moon orbit values.
 */
export const CONST = {
  G0: 9.80665,
  RU: 8314.46,
  MU_EARTH: 3.986004418e14,
  R_EARTH: 6371e3,
  J2: 1.08263e-3,
  RHO0: 1.225,
  SOLAR_CONSTANT: 1361,
  SB: 5.67e-8,
  MU_MOON: 4.9048695e12,
  R_MOON: 1737.4e3,
  MOON_SMA_M: 384400e3,
  MOON_OMEGA: (2 * Math.PI) / (27.321661 * 86400),
  MOON_SOI_M: 66100e3,
} as const;

export type Const = typeof CONST;

export const MU_MOON = CONST.MU_MOON;
export const R_MOON = CONST.R_MOON;
export const MOON_SMA_M = CONST.MOON_SMA_M;
export const MOON_OMEGA = CONST.MOON_OMEGA;
export const MOON_SOI_M = CONST.MOON_SOI_M;
