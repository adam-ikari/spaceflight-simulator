/**
 * MissionLibrary — historical crewed missions and programs (DESIGN.md §6f).
 *
 * Orbit/crew/duration values are the historical flight records; the stage
 * stacks reuse the architectural archetypes so PropulsionEngine and
 * RocketEquation recompute performance from combustion physics. Where no
 * archetype exists the closest engine class is approximated with a LOX/RP-1
 * stack and the approximation is noted.
 */
import type { StageSpec } from './RocketEquation';
import type { Scenario } from './AccidentScenarios';
import { ARCHETYPES } from './archetypes';
import { SCENARIOS } from './AccidentScenarios';

export interface MissionPreset {
  id: string;
  agency: string;
  name: string;
  year: number;
  category: 'launch' | 'station' | 'servicing' | 'accident';
  targetOrbitKm: number;
  inclinationDeg: number;
  crew: number;
  durationDays: number;
  stages: StageSpec[];
  events?: Scenario[];
}

/** Fresh copy of an archetype's stages — never alias the shared library. */
function fromArchetype(id: string): StageSpec[] {
  const a = ARCHETYPES.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown archetype: ${id}`);
  return a.stages.map((s) => ({ ...s }));
}

/** Approximate LOX/RP-1 stage for vehicles without a dedicated archetype. */
function rp1Stage(
  propellantMassKg: number,
  dryMassKg: number,
  thrustN: number,
  pcMPa = 6,
  expansionRatio = 16,
): StageSpec {
  return { propellantId: 'LOX_RP1', ofRatio: 2.3, pcMPa, expansionRatio, propellantMassKg, dryMassKg, thrustN };
}

function scenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown accident scenario: ${id}`);
  return s;
}

/** Approximated Chinese Long March 2F stack (Shenzhou / Tiangong). */
const chineseLv = (): StageSpec[] => [
  rp1Stage(4.0e5, 3.0e4, 6.0e6, 8, 16),
  rp1Stage(9.0e4, 5e3, 7.5e5, 8, 50),
];

/** Approximated Energia stack (Buran, crewless test flight). */
const energiaLv = (): StageSpec[] => [
  rp1Stage(1.7e6, 1.2e5, 2.9e7, 8, 16),
  rp1Stage(2.2e5, 2e4, 1.5e6, 8, 40),
];

export const MISSIONS: MissionPreset[] = [
  {
    id: 'mercury',
    agency: 'NASA',
    name: 'Mercury-Redstone 3 (Freedom 7)',
    year: 1961,
    category: 'launch',
    targetOrbitKm: 200,
    inclinationDeg: 0,
    crew: 1,
    durationDays: 1,
    // Redstone: single-stage LOX/RP-1, approximated.
    stages: [rp1Stage(37_000, 3_000, 3.5e5, 4, 10)],
  },
  {
    id: 'gemini',
    agency: 'NASA',
    name: 'Gemini',
    year: 1965,
    category: 'launch',
    targetOrbitKm: 300,
    inclinationDeg: 28.5,
    crew: 2,
    durationDays: 4,
    // Titan II: storable 2-stage; approximated with LOX/RP-1.
    stages: [rp1Stage(2.15e5, 1.0e4, 1.9e6, 6, 12), rp1Stage(3.0e4, 3_000, 4.6e5, 8, 40)],
  },
  {
    id: 'apollo',
    agency: 'NASA',
    name: 'Apollo lunar program',
    year: 1961,
    category: 'launch',
    targetOrbitKm: 185,
    inclinationDeg: 28.5,
    crew: 3,
    durationDays: 8,
    stages: fromArchetype('saturn_v'),
  },
  {
    id: 'skylab',
    agency: 'NASA',
    name: 'Skylab',
    year: 1973,
    category: 'station',
    targetOrbitKm: 435,
    inclinationDeg: 50,
    crew: 3,
    durationDays: 84,
    // Saturn IB shared the S-IVB upper stage; approximated with the Saturn V stack.
    stages: fromArchetype('saturn_v'),
  },
  {
    id: 'sts_hubble',
    agency: 'NASA',
    name: 'STS Hubble servicing (SM1, STS-61)',
    year: 1993,
    category: 'servicing',
    targetOrbitKm: 540,
    inclinationDeg: 28.5,
    crew: 7,
    durationDays: 13,
    stages: fromArchetype('shuttle'),
  },
  {
    id: 'demo2',
    agency: 'SpaceX',
    name: 'Crew Dragon Demo-2',
    year: 2020,
    category: 'launch',
    targetOrbitKm: 400,
    inclinationDeg: 51.6,
    crew: 2,
    durationDays: 64,
    stages: fromArchetype('falcon9'),
  },
  {
    id: 'vostok',
    agency: 'Soviet Union',
    name: 'Vostok 1',
    year: 1961,
    category: 'launch',
    targetOrbitKm: 200,
    inclinationDeg: 65,
    crew: 1,
    durationDays: 1,
    // Vostok-K: LOX/RP-1 2.5-stage, approximated.
    stages: [rp1Stage(1.6e5, 1.0e4, 1.0e6, 6, 12), rp1Stage(2.5e4, 3_000, 3.5e5, 8, 40)],
  },
  {
    id: 'soyuz',
    agency: 'Soviet Union / Russia',
    name: 'Soyuz',
    year: 1967,
    category: 'launch',
    targetOrbitKm: 200,
    inclinationDeg: 51.6,
    crew: 3,
    durationDays: 2,
    stages: fromArchetype('soyuz'),
  },
  {
    id: 'salyut1',
    agency: 'Soviet Union',
    name: 'Salyut 1',
    year: 1971,
    category: 'station',
    targetOrbitKm: 200,
    inclinationDeg: 51.6,
    crew: 3,
    durationDays: 24,
    stages: fromArchetype('soyuz'),
    events: [scenario('soyuz11')],
  },
  {
    id: 'mir',
    agency: 'Soviet Union / Russia',
    name: 'Mir',
    year: 1986,
    category: 'station',
    targetOrbitKm: 350,
    inclinationDeg: 51.6,
    crew: 3,
    durationDays: 365,
    stages: fromArchetype('soyuz'),
  },
  {
    id: 'buran',
    agency: 'Soviet Union',
    name: 'Buran (uncrewed orbital test)',
    year: 1988,
    category: 'launch',
    targetOrbitKm: 200,
    inclinationDeg: 51.6,
    crew: 0,
    durationDays: 1,
    stages: energiaLv(),
  },
  {
    id: 'shenzhou5',
    agency: 'China',
    name: 'Shenzhou 5',
    year: 2003,
    category: 'launch',
    targetOrbitKm: 343,
    inclinationDeg: 42.4,
    crew: 1,
    durationDays: 1,
    stages: chineseLv(),
  },
  {
    id: 'tiangong',
    agency: 'China',
    name: 'Tiangong',
    year: 2021,
    category: 'station',
    targetOrbitKm: 400,
    inclinationDeg: 41.5,
    crew: 3,
    durationDays: 90,
    stages: chineseLv(),
  },
  {
    id: 'iss',
    agency: 'International',
    name: 'International Space Station',
    year: 1998,
    category: 'station',
    targetOrbitKm: 420,
    inclinationDeg: 51.6,
    crew: 7,
    durationDays: 180,
    stages: fromArchetype('falcon9'),
  },
  {
    id: 'apollo1',
    agency: 'NASA',
    name: 'Apollo 1 (AS-204)',
    year: 1967,
    category: 'accident',
    targetOrbitKm: 0,
    inclinationDeg: 0,
    crew: 3,
    durationDays: 0,
    stages: fromArchetype('saturn_v'),
    events: [scenario('apollo1')],
  },
  {
    id: 'challenger',
    agency: 'NASA',
    name: 'Challenger (STS-51-L)',
    year: 1986,
    category: 'accident',
    targetOrbitKm: 0,
    inclinationDeg: 28.5,
    crew: 7,
    durationDays: 0,
    stages: fromArchetype('shuttle'),
    events: [scenario('challenger')],
  },
  {
    id: 'columbia',
    agency: 'NASA',
    name: 'Columbia (STS-107)',
    year: 2003,
    category: 'accident',
    targetOrbitKm: 0,
    inclinationDeg: 39,
    crew: 7,
    durationDays: 0,
    stages: fromArchetype('shuttle'),
    events: [scenario('columbia')],
  },
];

const BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));

export function getMission(id: string): MissionPreset | undefined {
  return BY_ID.get(id);
}
