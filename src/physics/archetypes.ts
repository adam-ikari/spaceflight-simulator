/**
 * Archetype library — historical and concept schemes (DESIGN.md §4a/§4b).
 *
 * Engineering archetypes carry real mass/thrust numbers so PropulsionEngine and
 * RocketEquation recompute Isp/Δv/TWR from combustion physics instead of
 * hand-entered performance. Concept archetypes document the physical feasibility
 * verdict; non-chemical ones (NTR/ion/sail) have no chemical stage stack.
 */
import type { StageSpec } from './RocketEquation';

export interface Archetype {
  id: string;
  name: string;
  era: string;
  category: 'engineering' | 'concept';
  feasibility: 'flyable' | 'researched' | 'concept' | 'infeasible';
  escapeSystem: 'tower' | 'propulsive' | 'none';
  stages: StageSpec[];
  notes?: string;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'saturn_v',
    name: 'Saturn V',
    era: '1967–1973',
    category: 'engineering',
    feasibility: 'flyable',
    escapeSystem: 'tower',
    stages: [
      // S-IC: five F-1, LOX/RP-1, vac Isp ~304 s
      {
        propellantId: 'LOX_RP1',
        ofRatio: 2.27,
        pcMPa: 7,
        expansionRatio: 16,
        propellantMassKg: 2.1e6,
        dryMassKg: 130000,
        thrustN: 3.4e7,
      },
      // S-II: five J-2, LOX/LH2, vac Isp ~421 s
      {
        propellantId: 'LOX_LH2',
        ofRatio: 5.5,
        pcMPa: 5.2,
        expansionRatio: 27.5,
        propellantMassKg: 9.3e5,
        dryMassKg: 36000,
        thrustN: 5.1e6,
      },
      // S-IVB: one J-2, LOX/LH2
      {
        propellantId: 'LOX_LH2',
        ofRatio: 5.5,
        pcMPa: 5.2,
        expansionRatio: 27.5,
        propellantMassKg: 1.1e5,
        dryMassKg: 13000,
        thrustN: 1.0e6,
      },
    ],
    notes: 'Takeoff mass 2965 t, LEO payload 140 t, launch escape tower (solid).',
  },
  {
    id: 'soyuz',
    name: 'Soyuz-FG',
    era: '1966–present',
    category: 'engineering',
    feasibility: 'flyable',
    escapeSystem: 'tower',
    stages: [
      // 4 × RD-107 strap-on boosters (aggregated)
      {
        propellantId: 'LOX_RP1',
        ofRatio: 2.3,
        pcMPa: 6,
        expansionRatio: 11.2,
        propellantMassKg: 158000,
        dryMassKg: 14000,
        thrustN: 4.0e6,
      },
      // Core RD-108
      {
        propellantId: 'LOX_RP1',
        ofRatio: 2.3,
        pcMPa: 6,
        expansionRatio: 11.2,
        propellantMassKg: 90000,
        dryMassKg: 7500,
        thrustN: 1.0e6,
      },
      // Block I upper stage RD-0110
      {
        propellantId: 'LOX_RP1',
        ofRatio: 2.3,
        pcMPa: 6,
        expansionRatio: 30,
        propellantMassKg: 26000,
        dryMassKg: 3000,
        thrustN: 3.0e5,
      },
    ],
    notes: 'Takeoff mass ~308 t, LEO payload ~7 t, launch escape tower; lowest historical LOC rate.',
  },
  {
    id: 'shuttle',
    name: 'Space Shuttle',
    era: '1981–2011',
    category: 'engineering',
    feasibility: 'flyable',
    escapeSystem: 'tower',
    stages: [
      // 2 × SRB (solid HTPB), unfurlable once ignited
      {
        propellantId: 'LOX_RP1', // solid grain approximated by the RP-1 table entry
        ofRatio: 2.3,
        pcMPa: 4,
        expansionRatio: 10,
        propellantMassKg: 5.0e5,
        dryMassKg: 90000,
        thrustN: 1.25e7,
        isSolid: true,
      },
      // Orbiter core SSME fed from the external tank, LOX/LH2
      {
        propellantId: 'LOX_LH2',
        ofRatio: 6.0,
        pcMPa: 20,
        expansionRatio: 69,
        propellantMassKg: 7.35e5,
        dryMassKg: 27000,
        thrustN: 5.3e6,
      },
    ],
    notes:
      'No abort window after solid ignition; 2/135 LOC ≈ 1/67. Takeoff mass ~2000 t, LEO payload 24 t.',
  },
  {
    id: 'falcon9',
    name: 'Falcon 9 + Crew Dragon',
    era: '2010–present',
    category: 'engineering',
    feasibility: 'flyable',
    escapeSystem: 'propulsive',
    stages: [
      // 9 × Merlin 1D
      {
        propellantId: 'LOX_RP1',
        ofRatio: 2.3,
        pcMPa: 9.7,
        expansionRatio: 16,
        propellantMassKg: 4.11e5,
        dryMassKg: 27000,
        thrustN: 7.6e6,
      },
      // Merlin 1D Vacuum
      {
        propellantId: 'LOX_RP1',
        ofRatio: 2.3,
        pcMPa: 9.7,
        expansionRatio: 165,
        propellantMassKg: 93000,
        dryMassKg: 4000,
        thrustN: 9.3e5,
      },
    ],
    notes:
      'Takeoff mass 549 t, LEO payload ~23 t with Dragon; booster reuse reserves ~1.5–2 km/s; SuperDraco launch abort, full-flight abort.',
  },
  {
    id: 'starship',
    name: 'Starship / Super Heavy',
    era: '2023–present',
    category: 'engineering',
    feasibility: 'flyable',
    escapeSystem: 'propulsive',
    stages: [
      // Super Heavy: 33 × Raptor
      {
        propellantId: 'LOX_CH4',
        ofRatio: 3.6,
        pcMPa: 30,
        expansionRatio: 34,
        propellantMassKg: 3.4e6,
        dryMassKg: 2.0e5,
        thrustN: 7.3e7,
      },
      // Ship: 6 × Raptor (vacuum-optimized)
      {
        propellantId: 'LOX_CH4',
        ofRatio: 3.6,
        pcMPa: 30,
        expansionRatio: 90,
        propellantMassKg: 1.2e6,
        dryMassKg: 1.0e5,
        thrustN: 1.2e7,
      },
    ],
    notes:
      'Takeoff mass ~5000 t, LEO payload 100+ t, fully reusable; Raptor Isp ~350 s sl / ~380 s vac; engine-out redundancy plus propulsive abort.',
  },
  {
    id: 'user_custom_methane',
    name: 'Custom methalox launcher',
    era: 'user-defined',
    category: 'engineering',
    feasibility: 'flyable',
    escapeSystem: 'tower',
    stages: [
      {
        propellantId: 'LOX_CH4',
        ofRatio: 3.6,
        pcMPa: 10,
        expansionRatio: 40,
        propellantMassKg: 1.0e5,
        dryMassKg: 8000,
        thrustN: 1.5e6,
      },
    ],
    notes: 'Blank-sheet starting point; all masses/thrust user-editable, Isp from the combustion module.',
  },
  {
    id: 'ntr_nerva',
    name: 'NERVA nuclear thermal',
    era: '1961–1973 (research)',
    category: 'concept',
    feasibility: 'researched',
    escapeSystem: 'none',
    stages: [
      // H2 propellant entered against the LH2 table entry as a density proxy;
      // reactor heating gives Isp ~900 s, far above the chemical table value.
      {
        propellantId: 'LOX_LH2',
        ofRatio: 6.0,
        pcMPa: 7,
        expansionRatio: 100,
        propellantMassKg: 1.0e5,
        dryMassKg: 2.0e4,
        thrustN: 3.3e5,
      },
    ],
    notes: 'Nuclear thermal ~900 s Isp (850–1000 s band); reactor heating of H2, material and radiation limits.',
  },
  {
    id: 'ion',
    name: 'Ion / electric propulsion',
    era: '1998–present',
    category: 'concept',
    feasibility: 'researched',
    escapeSystem: 'none',
    stages: [],
    notes: 'Isp 3000–4000 s, thrust ~mN–N; deep-space only (Dawn flight-proven), no chemical branch.',
  },
  {
    id: 'solar_sail',
    name: 'Solar sail',
    era: '2010–present',
    category: 'concept',
    feasibility: 'researched',
    escapeSystem: 'none',
    stages: [],
    notes: 'Radiation pressure P = 2S/c; acceleration ~9 µPa/m² at 1 AU, demands very large area.',
  },
  {
    id: 'orion_pulse',
    name: 'Project Orion nuclear pulse',
    era: '1958–1963 (research)',
    category: 'concept',
    feasibility: 'researched',
    escapeSystem: 'none',
    stages: [],
    notes: 'Isp ~2000 s class via nuclear pulse units against a pusher plate; feasible in principle but untestable — atmospheric fallout and test-ban treaty.',
  },
  {
    id: 'fusion_daedalus',
    name: 'Project Daedalus fusion propulsion',
    era: '1973–1978 (concept)',
    category: 'concept',
    feasibility: 'concept',
    escapeSystem: 'none',
    stages: [],
    notes: 'Isp ~1e6 s; needs controlled fusion and helium-3 supply — no demonstrated physics path at engineering scale.',
  },
  {
    id: 'planetary_engine',
    name: 'Planetary engine (Wandering Earth)',
    era: 'science fiction',
    category: 'concept',
    feasibility: 'infeasible',
    escapeSystem: 'none',
    stages: [],
    notes:
      'M_earth = 5.972e24 kg; a = 1e-5 m/s² needs F ≈ M·a ≈ 6e19 N. Exhaust at a very optimistic 10 km/s gives ṁ ≈ 6e15 kg/s → ~2e23 kg/yr, ~3% of Earth per year. Crust is only 2.6e22 kg → burns through in weeks; reaction mass is spent before any useful Δv. Infeasible.',
  },
];
