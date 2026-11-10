import { describe, it, expect } from 'vitest';
import { PHASE_ORDER } from '../../src/director/phases';
import { PhysicsDirector } from '../../src/director/PhysicsDirector';

describe('PHASE_ORDER', () => {
  it('lists the ten mission phases in flight order', () => {
    expect(PHASE_ORDER).toEqual([
      'PAD',
      'LIFTOFF',
      'ASCENT',
      'STAGE_SEP',
      'ORBIT_INSERT',
      'ORBIT',
      'RENDEZVOUS',
      'DEORBIT',
      'ENTRY',
      'LANDING',
    ]);
  });
});

describe('PhysicsDirector phase machine', () => {
  it('starts on the pad', () => {
    expect(new PhysicsDirector().phase).toBe('PAD');
  });

  it('advances through every phase in order', () => {
    const d = new PhysicsDirector();
    for (const p of PHASE_ORDER.slice(1)) {
      d.advance();
      expect(d.phase).toBe(p);
    }
  });

  it('holds on LANDING when advanced again', () => {
    const d = new PhysicsDirector();
    for (let i = 0; i < PHASE_ORDER.length + 3; i++) d.advance();
    expect(d.phase).toBe('LANDING');
  });

  it('accepts setting the next forward phase and the same phase', () => {
    const d = new PhysicsDirector();
    expect(() => d.setPhase('LIFTOFF')).not.toThrow();
    expect(() => d.setPhase('LIFTOFF')).not.toThrow();
    expect(d.phase).toBe('LIFTOFF');
  });

  it('rejects backward jumps', () => {
    const d = new PhysicsDirector();
    for (const p of PHASE_ORDER.slice(1, 6)) d.setPhase(p);
    expect(d.phase).toBe('ORBIT');
    expect(() => d.setPhase('ASCENT')).toThrow(/Invalid phase transition/);
    expect(d.phase).toBe('ORBIT');
  });

  it('rejects skipping forward phases', () => {
    const d = new PhysicsDirector();
    expect(() => d.setPhase('ORBIT')).toThrow(/Invalid phase transition/);
  });

  it('allows PAD as a restart from any phase', () => {
    const d = new PhysicsDirector();
    d.setPhase('LIFTOFF');
    d.setPhase('PAD');
    expect(d.phase).toBe('PAD');
  });
});

/** Fly the director through ascent to a circular LEO insertion. */
function insertIntoOrbit(): PhysicsDirector {
  const d = new PhysicsDirector();
  d.setPhase('LIFTOFF');
  for (let i = 0; i < 60; i++) d.step(1);
  d.setPhase('ASCENT');
  for (let i = 0; i < 600; i++) d.step(1);
  d.setPhase('STAGE_SEP');
  d.step(10);
  d.setPhase('ORBIT_INSERT');
  d.step(1);
  return d;
}

describe('PhysicsDirector telemetry', () => {
  it('reports all fields matching the current phase', () => {
    const d = new PhysicsDirector();
    const t = d.telemetry();
    expect(t.phase).toBe('PAD');
    expect(t.t).toBe(0);
    expect(t.speedMs).toBe(0);
    expect(t.altitudeKm).toBeCloseTo(0, 6);
    expect(t.dvRemainingMs).toBeGreaterThan(0);
    expect(t.fuelPct).toBeCloseTo(100, 6);
    expect(t.ploc).toBeGreaterThanOrEqual(0);
    expect(t.ploc).toBeLessThan(1);
    expect(t.costUsd).toBeGreaterThan(0);
  });

  it('accumulates altitude, speed and fuel burn during ascent', () => {
    const d = new PhysicsDirector();
    d.setPhase('LIFTOFF');
    for (let i = 0; i < 100; i++) d.step(1);
    const t = d.telemetry();
    expect(t.t).toBeCloseTo(100, 6);
    expect(t.altitudeKm).toBeGreaterThan(1);
    expect(t.speedMs).toBeGreaterThan(0);
    expect(t.dvRemainingMs).toBeLessThan(9400);
    expect(t.fuelPct).toBeLessThan(100);
  });

  it('inserts into a circular orbit at orbital speed', () => {
    const t = insertIntoOrbit().telemetry();
    expect(t.phase).toBe('ORBIT_INSERT');
    expect(t.altitudeKm).toBeGreaterThan(50);
    expect(t.speedMs).toBeGreaterThan(7000);
    expect(t.speedMs).toBeLessThan(8200);
  });

  it('propagates an orbit under RK4', () => {
    const d = insertIntoOrbit();
    d.setPhase('ORBIT');
    d.step(1);
    const a = d.telemetry();
    d.step(60);
    const b = d.telemetry();
    expect(b.t - a.t).toBeCloseTo(60, 6);
    expect(b.altitudeKm).toBeGreaterThan(50);
    expect(b.speedMs).toBeGreaterThan(7000);
  });

  it('lands with reduced speed and zero altitude', () => {
    const d = insertIntoOrbit();
    d.setPhase('ORBIT');
    for (let i = 0; i < 30; i++) d.step(1);
    d.setPhase('RENDEZVOUS');
    for (let i = 0; i < 30; i++) d.step(1);
    d.setPhase('DEORBIT');
    for (let i = 0; i < 60; i++) d.step(1);
    d.setPhase('ENTRY');
    for (let i = 0; i < 200; i++) d.step(1);
    d.setPhase('LANDING');
    for (let i = 0; i < 200; i++) d.step(1);
    const t = d.telemetry();
    expect(t.phase).toBe('LANDING');
    expect(t.altitudeKm).toBeLessThan(0.1);
    expect(t.speedMs).toBeLessThan(10);
  });
});

describe('PhysicsDirector vehicle-aware PLOC', () => {
  it('reports higher lift-off PLOC for a lit solid booster than propulsive escape', () => {
    const solid = new PhysicsDirector();
    solid.setVehicle('tower', true);
    solid.setPhase('LIFTOFF');
    solid.step(1);
    const solidPloc = solid.telemetry().ploc;

    const propulsive = new PhysicsDirector();
    propulsive.setVehicle('propulsive', false);
    propulsive.setPhase('LIFTOFF');
    propulsive.step(1);
    const propPloc = propulsive.telemetry().ploc;

    expect(propPloc).toBeLessThan(solidPloc);
  });
});
