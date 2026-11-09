/**
 * Life support consumables (ECLSS) — traceable to DESIGN.md §6b.
 * Per-person daily loads: O2 0.84 kg, water 2.7 kg, food 0.62 kg,
 * LiOH 2.0 kg (CO2 absorbent). Metabolic heat 100 W/person (80–100 W band).
 * CO2 production ~1.0 kg/person/day drives a rising cabin CO2 volume
 * fraction, capped at the 1 % crew-health limit.
 */

export interface CrewConfig {
  crew: number;
  durationDays: number;
}

export interface Consumables {
  o2Kg: number;
  waterKg: number;
  foodKg: number;
  liohKg: number;
  totalKg: number;
}

/** Daily per-crew-member consumption, kg. */
const O2_KG_PER_DAY = 0.84;
const WATER_KG_PER_DAY = 2.7;
const FOOD_KG_PER_DAY = 0.62;
const LIOH_KG_PER_DAY = 2.0;

export function computeConsumables(c: CrewConfig): Consumables {
  const crewDays = c.crew * c.durationDays;
  const o2Kg = O2_KG_PER_DAY * crewDays;
  const waterKg = WATER_KG_PER_DAY * crewDays;
  const foodKg = FOOD_KG_PER_DAY * crewDays;
  const liohKg = LIOH_KG_PER_DAY * crewDays;
  return {
    o2Kg,
    waterKg,
    foodKg,
    liohKg,
    totalKg: o2Kg + waterKg + foodKg + liohKg,
  };
}

export interface LifeSupportState {
  o2RemainKg: number;
  waterRemainKg: number;
  co2Pct: number;
  metabolicHeatW: number;
  failures: string[];
}

/** CO2 generation and cabin mixing (DESIGN.md §6b). */
const CO2_KG_PER_DAY = 1.0;
const CO2_DENSITY_KG_M3 = 1.98; // STP
const CABIN_VOLUME_M3 = 20;
const CO2_MAX_PCT = 1.0; // crew-health limit (~7.6 mmHg ppCO2)
const METABOLIC_W_PER_PERSON = 100;
const SEC_PER_DAY = 86400;

/**
 * Advance life support by dtSec. Pure: returns a new state, never mutates
 * the input. Decrements O2/water, accumulates CO2 volume fraction (capped),
 * and records irreversible failures.
 */
export function stepLifeSupport(
  s: LifeSupportState,
  crew: number,
  dtSec: number,
): LifeSupportState {
  const days = dtSec / SEC_PER_DAY;

  const o2RemainKg = s.o2RemainKg - O2_KG_PER_DAY * crew * days;
  const waterRemainKg = s.waterRemainKg - WATER_KG_PER_DAY * crew * days;

  const co2VolM3 = (CO2_KG_PER_DAY * crew * days) / CO2_DENSITY_KG_M3;
  const co2Pct = Math.min(
    s.co2Pct + (co2VolM3 / CABIN_VOLUME_M3) * 100,
    CO2_MAX_PCT,
  );

  const failures = [...s.failures];
  if (o2RemainKg <= 0 && !failures.includes('o2_depleted')) {
    failures.push('o2_depleted');
  }

  return {
    o2RemainKg,
    waterRemainKg,
    co2Pct,
    metabolicHeatW: METABOLIC_W_PER_PERSON * crew,
    failures,
  };
}