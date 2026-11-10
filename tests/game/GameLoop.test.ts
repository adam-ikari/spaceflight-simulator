import { describe, it, expect, beforeEach } from 'vitest';
import { PhysicsDirector } from '../../src/director/PhysicsDirector';
import { GameLoop } from '../../src/game/GameLoop';
import { store } from '../../src/state/store';

function resetStore(): void {
  store.set({
    phase: 'PAD',
    t: 0,
    ploc: 0,
    costUsd: 0,
    fuelPct: 100,
    aborted: false,
    decisions: [],
  });
}

/** Walk the director to a phase without flying the physics. */
function directorAt(phase: PhysicsDirector['phase']): PhysicsDirector {
  const d = new PhysicsDirector();
  while (d.phase !== phase) d.advance();
  return d;
}

beforeEach(resetStore);

describe('store', () => {
  it('merges partial state and notifies subscribers until unsubscribed', () => {
    const seen: number[] = [];
    const off = store.subscribe((s) => seen.push(s.t));
    store.set({ t: 5 });
    off();
    store.set({ t: 9 });
    expect(store.get().t).toBe(9);
    expect(seen).toEqual([5]);
  });
});

describe('GameLoop.tick', () => {
  it('advances mission time and mirrors director telemetry into the store', () => {
    const d = new PhysicsDirector();
    d.setPhase('LIFTOFF');
    const loop = new GameLoop(d);

    loop.tick(1);

    const s = store.get();
    expect(s.phase).toBe('LIFTOFF');
    expect(s.t).toBeGreaterThan(0);
    expect(s.fuelPct).toBeLessThan(100);
    expect(s.ploc).toBeGreaterThan(0);
  });
  it('auto-drives a launch through ascent to ORBIT', () => {
    const d = new PhysicsDirector();
    const loop = new GameLoop(d, 10);
    loop.decide({ type: 'go' });
    for (let i = 0; i < 400 && d.phase !== 'ORBIT'; i++) loop.tick(1);
    expect(d.phase).toBe('ORBIT');
    expect(store.get().phase).toBe('ORBIT');
  });
});

describe('GameLoop.decide', () => {
  it('abort on a lit solid booster does not lower PLOC', () => {
    const d = new PhysicsDirector();
    d.setPhase('LIFTOFF');
    const loop = new GameLoop(d);
    loop.tick(1);
    const before = store.get().ploc;

    loop.decide({ type: 'abort' });

    const s = store.get();
    expect(s.aborted).toBe(true);
    expect(s.decisions).toContain('abort');
    expect(s.ploc).toBeGreaterThanOrEqual(before);
  });

  it('deorbit advances the phase to DEORBIT', () => {
    const loop = new GameLoop(directorAt('RENDEZVOUS'));

    loop.decide({ type: 'deorbit' });

    expect(store.get().phase).toBe('DEORBIT');
    expect(store.get().decisions).toContain('deorbit');
  });

  it('go commits the pad and liftoff begins; no_go holds', () => {
    const d = new PhysicsDirector();
    const loop = new GameLoop(d);

    loop.decide({ type: 'go' });
    expect(store.get().phase).toBe('LIFTOFF');

    const held = new GameLoop(new PhysicsDirector());
    held.decide({ type: 'no_go' });
    expect(store.get().phase).toBe('PAD');
    expect(store.get().decisions).toContain('no_go');
  });

  it('records a burn maneuver and an eclipse load shed', () => {
    const loop = new GameLoop(new PhysicsDirector());

    loop.decide({ type: 'burn', payload: { dvMs: 120 } });
    loop.decide({ type: 'eclipse_load_shed' });

    expect(store.get().decisions).toEqual(['burn', 'eclipse_load_shed']);
  });
});
