/** Minimal mission state and pub/sub — DESIGN.md §9, no framework. */
import type { SystemsSnapshot } from '../physics/ComponentSystems';

export interface GameState {
  phase: string;
  t: number;
  altitudeKm: number;
  speedMs: number;
  ploc: number;
  costUsd: number;
  fuelPct: number;
  aborted: boolean;
  decisions: string[];
  /** Per-component thermal/vibration state; null before a vehicle is set. */
  systems?: SystemsSnapshot | null;
}

export type Listener = (s: GameState) => void;

const INITIAL: GameState = {
  phase: 'PAD',
  t: 0,
  altitudeKm: 0,
  speedMs: 0,
  ploc: 0,
  costUsd: 0,
  fuelPct: 100,
  aborted: false,
  decisions: [],
  systems: null,
};

let state: GameState = INITIAL;
const listeners = new Set<Listener>();

export const store: {
  get(): GameState;
  set(partial: Partial<GameState>): void;
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
