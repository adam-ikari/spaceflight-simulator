/**
 * PropulsionEngine — combustion chemistry → c* / Cf / Isp.
 *
 * Isp is computed from first principles, never hand-entered.
 *
 * Chain (DESIGN.md §4):
 *   1. Look up chamber T_c, mean molecular weight M and ratio of specific
 *      heats γ from the propellant table. The single table point is used at
 *      the typical O/F (no off-optimal interpolation data exists yet).
 *   2. Characteristic velocity (chamber γ):
 *        c* = sqrt(γ·R_u·T_c / M) / (γ·sqrt((2/(γ+1))^((γ+1)/(γ-1))))
 *      R = R_u / M, M taken as kg/kmol (numeric value of g/mol == kg/kmol).
 *   3. Nozzle thrust coefficient. Combustion gas cools as it expands, so its
 *      isentropic exponent drops from the chamber value γ_c toward ~1 at the
 *      exit; we use the mean exhaust ratio γ_e = 1 + (γ_c − 1)/2 for the
 *      expansion, then solve the supersonic area-ratio relation for the exit
 *      Mach number M_e:
 *        ε = (1/M_e)·[(2/(γ+1))·(1 + (γ−1)/2·M_e²)]^((γ+1)/(2(γ−1)))
 *      exit pressure Pe/Pc = (1 + (γ−1)/2·M_e²)^(−γ/(γ−1))
 *        Cf = sqrt((2γ²/(γ−1))·(2/(γ+1))^((γ+1)/(γ−1))·(1 − (Pe/Pc)^((γ−1)/γ)))
 *             + ((Pe − Pa)/Pc)·ε
 *   4. Isp_vac = c*·Cf_vac / g0  (Pa = 0)
 *      Isp_sl = c*·Cf_sl / g0   (Pa = sea level), Cf evaluated with ambient.
 *      thrustPerMdot (F/ṁ) = c*·Cf_vac = Isp_vac·g0.
 */
import { CONST } from './constants';
import { PROPELLANTS } from './propellants';

export interface CombustionInput {
  propellantId: string;
  ofRatio: number;
  pcMPa: number;
  expansionRatio: number;
  paMPa?: number;
}

export interface EnginePerf {
  cstar: number;
  cf: number;
  ispVac: number;
  ispSl: number;
  thrustPerMdot: number;
}

const PA_SEA_MPA = 0.101325;

/** Isentropic area ratio A/A* as a function of (supersonic) Mach number. */
function areaRatio(me: number, g: number): number {
  const term = (2 / (g + 1)) * (1 + ((g - 1) / 2) * me * me);
  return (1 / me) * Math.pow(term, (g + 1) / (2 * (g - 1)));
}

/** Solve the supersonic root (M_e > 1) of areaRatio(M_e, γ) = ε by bisection. */
function exitMach(eps: number, g: number): number {
  let lo = 1 + 1e-9;
  let hi = 2;
  while (areaRatio(hi, g) < eps) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (areaRatio(mid, g) < eps) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Vacuum/ambient thrust coefficient, exit pressure ratio and exit Mach. */
function thrustCoeff(
  eps: number,
  g: number,
  pcMPa: number,
  paMPa: number,
): { cf: number; peOverPc: number } {
  const me = exitMach(eps, g);
  const peOverPc = Math.pow(1 + ((g - 1) / 2) * me * me, -g / (g - 1));
  const momentum = Math.sqrt(
    ((2 * g * g) / (g - 1)) *
      Math.pow(2 / (g + 1), (g + 1) / (g - 1)) *
      (1 - Math.pow(peOverPc, (g - 1) / g)),
  );
  const pressure = ((peOverPc - paMPa / pcMPa) * eps);
  return { cf: momentum + pressure, peOverPc };
}

export function computeEngine(inp: CombustionInput): EnginePerf {
  const p = PROPELLANTS[inp.propellantId];
  if (!p) {
    throw new Error(`Unknown propellant: ${inp.propellantId}`);
  }

  const gammaC = p.gamma;
  const gammaE = 1 + (gammaC - 1) / 2; // mean exhaust γ over the expansion

  // Characteristic velocity from chamber conditions (γ_c).
  const r = CONST.RU / p.mGmol; // specific gas constant, J/(kg·K)
  const gammaTerm = Math.pow(2 / (gammaC + 1), (gammaC + 1) / (gammaC - 1));
  const cstar =
    Math.sqrt(gammaC * r * p.tcK) / (gammaC * Math.sqrt(gammaTerm));

  // Nozzle thrust coefficient at vacuum and at ambient.
  const cfVac = thrustCoeff(inp.expansionRatio, gammaE, inp.pcMPa, 0).cf;
  const pa = inp.paMPa ?? PA_SEA_MPA;
  const cfSl = thrustCoeff(inp.expansionRatio, gammaE, inp.pcMPa, pa).cf;

  const ispVac = (cstar * cfVac) / CONST.G0;
  const ispSl = (cstar * cfSl) / CONST.G0;

  return {
    cstar,
    cf: cfVac,
    ispVac,
    ispSl,
    thrustPerMdot: cstar * cfVac,
  };
}
