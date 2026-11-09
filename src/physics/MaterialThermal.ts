/**
 * MaterialThermal — temperature-dependent material properties.
 *
 * Physical references (see DESIGN.md §6c):
 *  - Viton O-ring glass transition Tg ≈ -20°C; below Tg the elastomer loses
 *    resilience (seal rebound fails). Root cause of the Challenger joint
 *    blow-by on a cold launch day.
 *  - Silicone rubber Tg ≈ -60°C (low-temp elastomer).
 *  - Ductile–brittle transition temperature (DBTT): steel 4340 ≈ -40°C,
 *    titanium Ti-6Al-4V ≈ -200°C (minimal cryo embrittlement).
 *  - Cryogenic propellant boil-off: LH2 ~0.1%/day, LOX-dominant ~0.02%/day
 *    at typical insulation; scales with 1/insulation · time.
 *  - TPS limits: carbon ablator ~5 MW/m² / ~3500 K; silica (Shuttle) tile
 *    ~1.5 MW/m² / ~1600 K (Columbia root cause: breach of this limit).
 */

/** Elastomer glass-transition table (°C). */
const RUBBERS: Record<string, { tgC: number }> = {
  viton_oring: { tgC: -20 },
  silicone: { tgC: -60 },
};

/** Ductile–brittle transition table (°C, logistic width °C). */
const METALS: Record<string, { dbttC: number; widthC: number }> = {
  steel_4340: { dbttC: -40, widthC: 15 },
  ti6al4v: { dbttC: -200, widthC: 15 },
};

/** Thermal-protection-system limits. */
const TPS: Record<string, { maxHeatFluxMWm2: number; maxTempK: number }> = {
  carbon_ablator: { maxHeatFluxMWm2: 5, maxTempK: 3500 },
  silica_tile: { maxHeatFluxMWm2: 1.5, maxTempK: 1600 },
};

/**
 * Cryogenic boil-off model.
 * `fracPerDay` = fraction of the propellant load lost per day at the reference
 * insulation (REF_INSULATION). `nominalLoadKg` is a representative stage load
 * used to express the loss in kg; the result scales linearly with load.
 */
const REF_INSULATION = 0.05; // W/m²K-equivalent "typical" insulation quality
const CRYO: Record<string, { fracPerDay: number; nominalLoadKg: number }> = {
  LOX_LH2: { fracPerDay: 0.001, nominalLoadKg: 100000 }, // 0.1%/day, 100 t stage
  LOX_RP1: { fracPerDay: 0.0002, nominalLoadKg: 100000 }, // 0.02%/day (LOX side)
  LOX_CH4: { fracPerDay: 0.0003, nominalLoadKg: 100000 },
  NTO_MMH: { fracPerDay: 0.00005, nominalLoadKg: 10000 }, // storable, near-zero
};
const SEC_PER_DAY = 86400;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Elastomer resilience in 0..1.
 *
 * Logistic centred at Tg + 5°C (matching the observed reseal-failure margin
 * near 0°C for Viton): ~1 above Tg+20, ~0.1 below Tg-10.
 *
 *     r(T) = 0.1 + 0.9 · σ((T − (Tg+5)) / 5)
 */
export function rubberResilience(materialId: string, tempC: number): number {
  const r = RUBBERS[materialId];
  if (!r) throw new Error(`unknown rubber material: ${materialId}`);
  const center = r.tgC + 5;
  const width = 5;
  const x = (tempC - center) / width;
  const sigma = 1 / (1 + Math.exp(-x));
  return clamp01(0.1 + 0.9 * sigma);
}

/**
 * Embrittlement factor in 0..1 (0 = fully ductile, 1 = fully brittle).
 *
 *     f(T) = σ((DBTT − T) / w)
 *
 * Above the DBTT the factor tends to 0 (ductile); well below it tends to 1
 * (brittle); exactly at the DBTT it is 0.5.
 */
export function dbttFactor(metalId: string, tempC: number): number {
  const m = METALS[metalId];
  if (!m) throw new Error(`unknown metal: ${metalId}`);
  const x = (m.dbttC - tempC) / m.widthC;
  return clamp01(1 / (1 + Math.exp(-x)));
}

/**
 * Cryogenic propellant boil-off (kg lost).
 *
 *     m_loss = fracPerDay · (REF_INSULATION / insulationWm2K) · (dtSec / 86400) · nominalLoadKg
 *
 * `insulationWm2K` is the insulation quality factor (higher = better
 * insulation → less loss), per the implementation plan.
 */
export function cryoBoiloff(
  propellantId: string,
  dtSec: number,
  insulationWm2K: number,
): number {
  const c = CRYO[propellantId];
  if (!c) throw new Error(`unknown cryogenic propellant: ${propellantId}`);
  if (insulationWm2K <= 0) {
    throw new Error(`insulationWm2K must be positive, got ${insulationWm2K}`);
  }
  const frac = c.fracPerDay * (REF_INSULATION / insulationWm2K) * (dtSec / SEC_PER_DAY);
  return frac * c.nominalLoadKg;
}

/** TPS allowable heat flux and temperature. */
export function tpsLimit(materialId: string): {
  maxHeatFluxMWm2: number;
  maxTempK: number;
} {
  const t = TPS[materialId];
  if (!t) throw new Error(`unknown TPS material: ${materialId}`);
  return { maxHeatFluxMWm2: t.maxHeatFluxMWm2, maxTempK: t.maxTempK };
}
