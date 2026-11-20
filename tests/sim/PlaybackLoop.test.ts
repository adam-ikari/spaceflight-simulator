import { describe, it, expect, beforeEach } from 'vitest';
import { PlaybackLoop } from '../../src/sim/PlaybackLoop';
import { store } from '../../src/state/store';

describe('PlaybackLoop', () => {
  beforeEach(() => new PlaybackLoop().reset());

  it('mirrors director telemetry into the store', () => {
    const loop = new PlaybackLoop(10);
    loop.tick(0.1);
    const s = store.get();
    expect(s.phase).toBe('LIFTOFF');
    expect(s.t).toBeGreaterThan(0);
    expect(s.altitudeKm).toBeGreaterThanOrEqual(0);
    expect(s.fuelPct).toBeLessThanOrEqual(100);
  });

  it('reaches LANDING automatically and stops after the landing dwell', () => {
    const loop = new PlaybackLoop(10);
    for (let i = 0; i < 4000 && loop.phase !== 'LANDING'; i++) loop.tick(0.1);
    expect(loop.phase).toBe('LANDING');
    for (let i = 0; i < 60; i++) loop.tick(0.1); // 6 s wall > 4 s dwell
    const t = store.get().t;
    for (let i = 0; i < 100; i++) loop.tick(0.1);
    expect(store.get().t).toBe(t);
  });

  it('keeps orbit dwell in wall time at warp 50', () => {
    const loop = new PlaybackLoop(50);
    for (let i = 0; i < 4000 && loop.phase !== 'ORBIT'; i++) loop.tick(0.1);
    expect(loop.phase).toBe('ORBIT');
    for (let i = 0; i < 50; i++) loop.tick(0.1); // 5 s wall < 8 s dwell
    expect(loop.phase).toBe('ORBIT');
  });

  it('pause freezes physics, resume continues', () => {
    const loop = new PlaybackLoop(10);
    loop.tick(0.1);
    const t = store.get().t;
    loop.pause();
    loop.tick(0.1);
    expect(store.get().t).toBe(t);
    loop.resume();
    loop.tick(0.1);
    expect(store.get().t).toBeGreaterThan(t);
  });

  it('reset after finish clears the stopped flag and replays', () => {
    const loop = new PlaybackLoop(10);
    for (let i = 0; i < 4000 && loop.phase !== 'LANDING'; i++) loop.tick(0.1);
    for (let i = 0; i < 60; i++) loop.tick(0.1);
    expect(loop.finished).toBe(true);
    loop.reset();
    expect(loop.finished).toBe(false);
    expect(loop.phase).toBe('LIFTOFF');
    loop.tick(0.1);
    expect(store.get().t).toBeGreaterThan(0);
  });

  it('setVehicle restarts playback from LIFTOFF', () => {
    const loop = new PlaybackLoop(10);
    for (let i = 0; i < 20; i++) loop.tick(0.1);
    loop.setVehicle('tower', false);
    expect(loop.phase).toBe('LIFTOFF');
    expect(store.get().t).toBe(0);
  });
});
