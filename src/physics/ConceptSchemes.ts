/**
 * Concept schemes — feasibility verification for advanced launch/propulsion
 * architectures (DESIGN.md §6h).
 *
 * Each scheme is graded by real physics:
 * - solar sail: P = 2S/c ≈ 9 µPa at 1 AU (radiation pressure on area).
 * - space elevator: cable tension needs ~50 GPa (CNT theory ~63 GPa).
 * - mass driver: 11.2 km/s at sea level = atmospheric plasma, so only
 *   orbital/mountain-class altitude staging is viable.
 * - laser launch: E = P·η·t coupled into payload, Δv = √(2E/m).
 * - antimatter: ~µg/year production, no annihilation control.
 */

export type Feasibility = 'flyable' | 'researched' | 'concept' | 'infeasible';

export interface ConceptScheme {
  id: string;
  name: string;
  ispS?: number;
  feasibility: Feasibility;
  bottleneck: string;
}

export const CONCEPT_SCHEMES: ConceptScheme[] = [
  {
    id: 'solar_sail',
    name: 'Solar sail (interstellar)',
    feasibility: 'researched',
    bottleneck:
      'Radiation pressure only 9 µPa at 1 AU; km²-scale sail needed for mm/s². Flown: IKAROS, LightSail.',
  },
  {
    id: 'ntr_mars',
    name: 'Nuclear thermal Mars crew (NERVA-class)',
    ispS: 900,
    feasibility: 'researched',
    bottleneck:
      'Reactor shielding and hydrogen boiloff; Isp ~900 s vs ~450 s chemical. Ground-tested (NERVA).',
  },
  {
    id: 'fusion_direct',
    name: 'Direct fusion drive',
    ispS: 1e5,
    feasibility: 'concept',
    bottleneck:
      'Controlled fusion with net energy gain + magnetic nozzle not yet demonstrated.',
  },
  {
    id: 'sabre',
    name: 'SABRE/Skylon air-breathing',
    feasibility: 'researched',
    bottleneck:
      'Precooler validated on ground; full engine never flown. Air-breathing saves LOX, raises effective Isp.',
  },
  {
    id: 'laser_launch',
    name: 'Ground-based laser launch',
    feasibility: 'researched',
    bottleneck:
      'Atmospheric transmission and laser array power; only kg-class payloads.',
  },
  {
    id: 'mass_driver',
    name: 'Electromagnetic mass driver',
    feasibility: 'infeasible',
    bottleneck:
      'Infeasible at the surface: 11.2 km/s in atmosphere = plasma ablation of the projectile. Viable from high altitude / Moon.',
  },
  {
    id: 'space_elevator',
    name: 'Space elevator',
    feasibility: 'concept',
    bottleneck:
      'Cable needs ~50 GPa tensile at taper ~1 (CNT theory ~63 GPa, macroscopic unrealized); large taper ratio.',
  },
  {
    id: 'skyhook',
    name: 'Skyhook / momentum-exchange tether',
    feasibility: 'researched',
    bottleneck:
      'Tether strength requirement below elevator; captures suborbital payloads incrementally.',
  },
  {
    id: 'antimatter',
    name: 'Antimatter propulsion',
    ispS: 1e7,
    feasibility: 'infeasible',
    bottleneck:
      'Antimatter production ~µg/year; storage and annihilation control unsolved.',
  },
];

/** Required cable tensile strength for a space elevator at 1 g: ~50 GPa. */
const ELEVATOR_REQUIRED_GPA = 50;

/**
 * Space-elevator cable feasibility.
 * required = 50 GPa × taper × 0.9 (10% design margin).
 * Meeting it → researched; within a further 10% → concept; else infeasible
 * (steel/aramid class, <30 GPa, always lands here).
 */
export function tensileFeasibility(
  materialTensileGPa: number,
  taperRequired: number,
): Feasibility {
  const required = ELEVATOR_REQUIRED_GPA * taperRequired * 0.9;
  if (materialTensileGPa >= required) return 'researched';
  if (materialTensileGPa >= required * 0.9) return 'concept';
  return 'infeasible';
}

/** Fraction of laser power absorbed by the ablator / heat exchanger. */
const LASER_COUPLING = 0.05;
/** Effective coupling duration for one launch shot (s). */
const LASER_PULSE_S = 10;

/**
 * Laser launch: Δv = √(2·P·η·t/m) from absorbed laser energy.
 * Feasible only for kg-class payloads (researched for ≤10 kg at ≥1 GW).
 */
export function laserLaunchFeasibility(
  payloadKg: number,
  laserPowerGW: number,
): { dvMs: number; feasible: Feasibility } {
  const energyJ = laserPowerGW * 1e9 * LASER_COUPLING * LASER_PULSE_S;
  const dvMs = Math.sqrt((2 * energyJ) / payloadKg);

  let feasible: Feasibility;
  if (payloadKg <= 10 && laserPowerGW >= 1) feasible = 'researched';
  else if (payloadKg <= 50 && laserPowerGW >= 0.5) feasible = 'concept';
  else feasible = 'infeasible';

  return { dvMs, feasible };
}

/**
 * Mass driver by launch altitude.
 * ≤10 km: 11.2 km/s into dense air → plasma/ablation, infeasible.
 * >50 km: above most atmosphere → researched; >200 km (from orbit) flyable.
 */
export function massDriverFeasibility(altitudeKm: number): Feasibility {
  if (altitudeKm <= 10) return 'infeasible';
  if (altitudeKm > 200) return 'flyable';
  if (altitudeKm > 50) return 'researched';
  return 'concept';
}

/**
 * Solar-sail acceleration (m/s²): a = P·A/m, P = 2S/c ≈ 9 µPa at 1 AU,
 * scaling as 1/distance². Area in km², mass in kg.
 */
export function sailAcceleration(
  areaKm2: number,
  distanceAU: number,
  payloadKg: number,
): number {
  const pressurePa = 9e-6; // 2·1361/299792458 ≈ 9.08 µPa
  return (pressurePa * areaKm2 * 1e6) / (payloadKg * distanceAU * distanceAU);
}
