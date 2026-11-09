/**
 * Cost model — DESIGN.md §7.
 *
 * Single-launch cost = hardware (dry mass × $/kg, amortized over reuse)
 *   + propellant (mass × $/kg) + fixed operations
 *   + development amortization (dev budget / planned launches)
 *   + insurance (base rate × (1 + k·PLOC))
 *   + expected failure cost (PLOC × (payload + crew/reputation)).
 * All figures in USD. Cost drivers traceable to DESIGN.md §7.
 */

/** Hardware cost factor, USD/kg of dry structure (launch-vehicle class). */
export const HARDWARE_COST_PER_KG = 1500;

/** Fixed per-launch operations cost, USD. */
export const OPS_COST = 5e6;

/** Insurance base rate per launch, USD. */
export const INSURANCE_BASE_RATE = 2e7;

/** Insurance PLOC sensitivity coefficient k (insurance ∝ 1 + k·PLOC). */
export const INSURANCE_PLOC_K = 10;

/** Monetary value of crew + reputation lost in a failure, USD. */
export const CREW_REPUTATION_VALUE = 5e8;

export interface CostInput {
  stagesDryMassKg: number[];
  propellantMassKg: number[];
  propellantCostPerKg: Record<string, number>;
  reuseCount: number;
  devBudget: number;
  plannedLaunches: number;
  ploc: number;
  payloadValue: number;
}

export interface CostOutput {
  hardware: number;
  propellant: number;
  ops: number;
  amortized: number;
  insurance: number;
  expectedFailure: number;
  total: number;
}

export function computeCost(inp: CostInput): CostOutput {
  const dryMass = inp.stagesDryMassKg.reduce((s, m) => s + m, 0);
  const hardware = (dryMass * HARDWARE_COST_PER_KG) / Math.max(inp.reuseCount, 1);

  const costs = Object.values(inp.propellantCostPerKg);
  const propellant =
    costs.length === inp.propellantMassKg.length
      ? inp.propellantMassKg.reduce((s, m, i) => s + m * costs[i], 0)
      : inp.propellantMassKg.reduce((s, m) => s + m, 0) * (costs[0] ?? 0);

  const ops = OPS_COST;
  const amortized = inp.plannedLaunches > 0 ? inp.devBudget / inp.plannedLaunches : inp.devBudget;
  const insurance = INSURANCE_BASE_RATE * (1 + INSURANCE_PLOC_K * inp.ploc);
  const expectedFailure = inp.ploc * (inp.payloadValue + CREW_REPUTATION_VALUE);

  const total = hardware + propellant + ops + amortized + insurance + expectedFailure;
  return { hardware, propellant, ops, amortized, insurance, expectedFailure, total };
}
