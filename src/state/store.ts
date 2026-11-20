/** Minimal telemetry state and pub/sub — DESIGN.md §9, no framework. */
import type { SystemsSnapshot } from '../physics/ComponentSystems';
import type { ProgramStatus } from '../physics/FlightComputer';
import type { LifeSupportState } from '../physics/LifeSupport';
import type { Body } from '../sim/MissionDirector';

export interface SimState {
  phase: string;
  t: number;
  altitudeKm: number;
  speedMs: number;
  ploc: number;
  costUsd: number;
  fuelPct: number;
  body?: Body;
  ispS?: number;
  dragN?: number;
  pogoG?: number;
  vibrationGrms?: number;
  ascentLossMs?: number;
  /** Per-component thermal/vibration state; null before a vehicle is set. */
  systems?: SystemsSnapshot | null;
  computer?: ProgramStatus[];
  life?: LifeSupportState;
  radiationMsv?: number;
}

export type Listener = (s: SimState) => void;

const INITIAL: SimState = {
  phase: 'PAD',
  t: 0,
  altitudeKm: 0,
  speedMs: 0,
  ploc: 0,
  costUsd: 0,
  fuelPct: 100,
  systems: null,
};

let state: SimState = INITIAL;
const listeners = new Set<Listener>();

export const store: {
  get(): SimState;
  set(partial: Partial<SimState>): void;
  subscribe(l: Listener): () => void;
} = {
  get: () => state,
  set(partial) {
    state = { ...state, ...partial };
    for (const l of listeners) l(state);
  },
  subscribe(l) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
