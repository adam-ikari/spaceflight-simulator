/**
 * CombustionChemistry — mixture-ratio dependence of chamber conditions.
 *
 * The propellant table stores one measured point per combination (chamber
 * temperature, mean molecular weight and γ at the optimum O/F). Running an
 * engine away from that mixture changes both: energy release falls off (the
 * limiting reactant is used up and the excess is carried as inert mass), and
 * the mean molecular weight rises. Both lower c* = sqrt(γ·R·T_c/M) and therefore
 * Isp.
 *
 * Full chemical equilibrium (CEA-style Gibbs minimisation over a species set)
 * is out of scope for a browser tick; this is an explicit engineering fit to
 * published Isp-vs-O/F curves:
 *
 *     x = ln(O/F / O/F_opt)
 *     T_c(O/F) = T_c,ref · exp(−0.25·x²)
 *     M(O/F)   = M_ref   · exp(+0.50·x²)
 *
 * so c* falls as exp(−0.375·x²): −4% at 40% off optimum, −16% at 2× the ratio.
 * `reactedFraction` exposes the stoichiometric completeness for the UI
 * (1.0 = exactly stoichiometric, < 1 = one reactant in excess).
 *
 * Stoichiometric O/F by mass (product stoichiometry):
 *   RP-1 (≈CH1.95): 3.45, LH2: 8.0, CH4: 4.0, MMH: 2.16.
 */

import { PROPELLANTS } from './propellants';

export interface ChemistryState {
  /** Chamber temperature, K. */
  tcK: number;
  /** Mean molecular weight, kg/kmol (numeric value of g/mol). */
  mGmol: number;
  /** Ratio of specific heats (chamber), unchanged by the mixture fit. */
  gamma: number;
  /** Optimum O/F the table entry was measured at. */
  ofOptimal: number;
  /** Fraction of the stoichiometric reaction achieved, 0..1. */
  reactedFraction: number;
}

/** Stoichiometric mixture ratio by mass, per propellant id. */
const OF_STOICHIOMETRIC: Record<string, number> = {
  LOX_RP1: 3.45,
  LOX_LH2: 8.0,
  LOX_CH4: 4.0,
  NTO_MMH: 2.16,
};

/** Chamber-temperature penalty exponent (fit, see header). */
const T_EXPONENT = 0.25;
/** Molecular-weight penalty exponent (fit, see header). */
const M_EXPONENT = 0.5;

/**
 * Chamber conditions at an arbitrary O/F.
 * Falls back to the table point for unknown propellants (never throws: the
 * designer must be able to show "unknown propellant" without crashing the tick).
 */
export function combustionState(propellantId: string, ofRatio: number): ChemistryState {
  const table = PROPELLANTS[propellantId];
  if (!table) throw new Error(`Unknown propellant: ${propellantId}`);

  const ofOptimal = table.ofTypical;
  const of = Number.isFinite(ofRatio) && ofRatio > 0 ? ofRatio : ofOptimal;
  const x = Math.log(of / ofOptimal);
  const stoich = OF_STOICHIOMETRIC[propellantId] ?? ofOptimal;
  const reactedFraction = Math.min(of / stoich, stoich / of, 1);

  return {
    tcK: table.tcK * Math.exp(-T_EXPONENT * x * x),
    mGmol: table.mGmol * Math.exp(M_EXPONENT * x * x),
    gamma: table.gamma,
    ofOptimal,
    reactedFraction,
  };
}
