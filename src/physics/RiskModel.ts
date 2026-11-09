/**
 * RiskModel — fault tree, PLOC (probability of loss of crew) and abort rescue.
 * DESIGN.md §6: baseline launch-vehicle failure ≈ 1/100 per launch; abort
 * success depends on escape system and dynamic pressure; solid boosters cannot
 * be shut down, so abort success is 0 until separation (Challenger lesson).
 */

export interface RiskInput {
  solidBoosterLit: boolean;
  mach: number;
  dynamicPressurePa: number;
  escapeSystem: 'tower' | 'propulsive' | 'none';
  phase: string;
  crewed: boolean;
}

export interface RiskOutput {
  ploc: number;
  contributors: { node: string; prob: number }[];
}

/** Abort tower peak effectiveness (Apollo/Soyuz-class tractor tower). */
const TOWER_BASE = 0.95;
/**
 * Dynamic-pressure e-folding scale for a tractor tower: tower thrust margin
 * shrinks as drag/aerodynamic load grows, so rescue probability falls
 * exponentially through the max-q region. 40 kPa ≈ max-q transonic band.
 */
const TOWER_Q_SCALE_PA = 40_000;
/** Propulsive (pusher) escape is sized for the full ascent envelope. */
const PROPULSIVE_BASE = 0.95;
/** Mild q attenuation: SuperDraco-class pushers remain >0.5 up to ~100 kPa. */
const PROPULSIVE_Q_SCALE_PA = 400_000;
/** No escape system: only lucky low-altitude separations survive. */
const NO_ESCAPE_RATE = 0.05;

const ASCENT_PHASES: Record<string, true> = {
  pad: true,
  liftoff: true,
  ascent: true,
  stage_sep: true,
  orbit_insert: true,
};
const ORBIT_PHASES: Record<string, true> = {
  orbit_insert: true,
  orbit: true,
  rendezvous: true,
};
const ENTRY_PHASES: Record<string, true> = { deorbit: true, entry: true };

/**
 * Launch-vehicle catastrophic-failure branches, per launch, total = 0.01.
 * Split follows historical propulsion/staging/guidance/plumbing failure shares
 * (DESIGN.md §6 baseline ~1/100).
 */
const LV_BRANCHES: { node: string; prob: number }[] = [
  { node: 'engine_failure', prob: 0.004 },
  { node: 'stage_sep_failure', prob: 0.002 },
  { node: 'gnc_deviation', prob: 0.002 },
  { node: 'propellant_leak', prob: 0.002 },
];

/** Non-abortable mission risk branches (crew-loss probabilities per mission). */
const MMOD_PROB = 0.002; // ~1/500 catastrophic penetration, Orion-class
const RADIATION_BELT_PROB = 0.0005; // Van Allen transit dose, LEO-mission share
const REENTRY_ABLATION_PROB = 0.002; // TPS burn-through (Columbia-class)
const LANDING_IMPACT_PROB = 0.001; // parachute/retro-propulsive landing failure

/**
 * Probability that a crewed abort attempted now saves the crew.
 * 0 while a solid booster is burning and cannot be shut down; otherwise
 * escape-system dependent, with dynamic pressure degrading tractor towers.
 */
export function abortSuccessRate(inp: RiskInput): number {
  if (inp.solidBoosterLit && inp.phase.toLowerCase() !== 'orbit') return 0;

  const q = Math.max(0, inp.dynamicPressurePa);
  switch (inp.escapeSystem) {
    case 'tower':
      return Math.min(1, TOWER_BASE * Math.exp(-q / TOWER_Q_SCALE_PA));
    case 'propulsive':
      return Math.min(1, PROPULSIVE_BASE * Math.exp(-q / PROPULSIVE_Q_SCALE_PA));
    case 'none':
      return NO_ESCAPE_RATE;
  }
}

/**
 * PLOC = union of independent crew-loss branches:
 * P = 1 - Π(1 - p_i). Launch-vehicle branches are multiplied by the
 * conditional crew-loss probability (1 - abort success).
 */
export function computePLOC(inp: RiskInput): RiskOutput {
  if (!inp.crewed) return { ploc: 0, contributors: [] };

  const phase = inp.phase.toLowerCase();
  const abort = abortSuccessRate(inp);
  const contributors: { node: string; prob: number }[] = [];

  if (ASCENT_PHASES[phase]) {
    for (const branch of LV_BRANCHES) {
      contributors.push({ node: branch.node, prob: branch.prob * (1 - abort) });
    }
  }
  if (phase !== 'pad') {
    contributors.push({ node: 'mmod', prob: MMOD_PROB });
  }
  if (ORBIT_PHASES[phase]) {
    contributors.push({ node: 'radiation_belt_transit', prob: RADIATION_BELT_PROB });
  }
  if (ENTRY_PHASES[phase]) {
    contributors.push({ node: 'reentry_ablation', prob: REENTRY_ABLATION_PROB });
  }
  if (phase === 'landing') {
    contributors.push({ node: 'landing_impact', prob: LANDING_IMPACT_PROB });
  }

  const ploc = 1 - contributors.reduce((acc, c) => acc * (1 - c.prob), 1);
  return { ploc, contributors };
}
