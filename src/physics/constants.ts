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
} as const;

export type Const = typeof CONST;
