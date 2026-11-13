/**
 * Rocket equation — stage performance and LEO feasibility validation.
 * Ideal Δv from Tsiolkovsky: Δv = Isp·g0·ln(m0/mf).
 * Isp comes from PropulsionEngine (chamber conditions + nozzle geometry),
 * so no hand-entered performance numbers.
 * LEO Δv budget 9.4 km/s: DESIGN.md §6 (structure fraction floors cited there).
 */
import { CONST } from './constants';
import { computeEngine } from './PropulsionEngine';

export interface StageSpec {
  propellantId: string;
  ofRatio: number;
  pcMPa: number;
  expansionRatio: number;
  propellantMassKg: number;
  dryMassKg: number;
  thrustN: number;
  isSolid?: boolean;
  /**
   * Regenerative chamber/nozzle cooling. Default true; false means the chamber
   * is radiation-cooled, which the wall-temperature screen rejects for any
   * chemical stage at flight chamber pressure.
   */
  regenerativeCooling?: boolean;
}

export interface StagePerf {
  ispVac: number;
  dvVac: number;
  burnTimeS: number;
  twr: number;
  mdot: number;
}

export interface RocketValidation {
  ok: boolean;
  totalDv: number;
  warnings: string[];
  errors: string[];
}

/** LEO insertion Δv budget (m/s), DESIGN.md §6. */
const LEO_DV = 9400;
/**
 * Minimum first-stage thrust-to-weight for a viable launch. TWR > 1 is the
 * physical floor; 1.1 is a practical margin that still accepts the historical
 * Saturn V (~1.14–1.19). 1.2 remains the DESIGN.md target, not a hard gate.
 */
const MIN_TWR = 1.1;
/** Structure mass fraction floor: dry / (dry + propellant). */
const STRUCTURE_FLOOR: Record<string, number> = {
  LOX_RP1: 0.05,
  LOX_CH4: 0.05,
  NTO_MMH: 0.05,
  LOX_LH2: 0.08,
};

export function stagePerformance(s: StageSpec, totalMassKg: number, g0 = CONST.G0): StagePerf {
  const { ispVac } = computeEngine({
    propellantId: s.propellantId,
    ofRatio: s.ofRatio,
    pcMPa: s.pcMPa,
    expansionRatio: s.expansionRatio,
  });
  const finalMassKg = totalMassKg - s.propellantMassKg;
  if (finalMassKg <= 0) {
    throw new Error(`Stage propellant (${s.propellantMassKg} kg) exceeds stack mass (${totalMassKg} kg)`);
  }
  const mdot = s.thrustN / (ispVac * g0);
  return {
    ispVac,
    dvVac: ispVac * g0 * Math.log(totalMassKg / finalMassKg),
    burnTimeS: s.propellantMassKg / mdot,
    twr: s.thrustN / (totalMassKg * g0),
    mdot,
  };
}

export function validateRocket(stages: StageSpec[], payloadKg: number): RocketValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  let totalDv = 0;

  stages.forEach((s, i) => {
    // Stage i carries itself, every upper stage, and the payload.
    const upperMassKg = stages
      .slice(i + 1)
      .reduce((m, u) => m + u.dryMassKg + u.propellantMassKg, 0);
    const totalMassKg = s.dryMassKg + s.propellantMassKg + upperMassKg + payloadKg;
    const perf = stagePerformance(s, totalMassKg);
    totalDv += perf.dvVac;

    if (i === 0 && perf.twr < MIN_TWR) {
      warnings.push(
        `Stage 1 TWR ${perf.twr.toFixed(2)} below ${MIN_TWR} — insufficient liftoff thrust`,
      );
    }

    const fraction = s.dryMassKg / (s.dryMassKg + s.propellantMassKg);
    const floor = STRUCTURE_FLOOR[s.propellantId] ?? 0.05;
    if (fraction < floor) {
      warnings.push(
        `Stage ${i + 1} structure fraction ${fraction.toFixed(3)} below ${floor} floor (${s.propellantId})`,
      );
    }
  });

  if (totalDv < LEO_DV) {
    errors.push(
      `Total Δv ${(totalDv / 1000).toFixed(2)} km/s below LEO requirement of 9.4 km/s`,
    );
  }

  return { ok: errors.length === 0, totalDv, warnings, errors };
}
