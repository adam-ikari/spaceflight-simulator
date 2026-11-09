import { describe, it, expect } from 'vitest';
import { MISSIONS, getMission } from '../../src/physics/MissionLibrary';
import { SCENARIOS } from '../../src/physics/AccidentScenarios';

describe('mission library', () => {
  it('ISS sits at 420 km / 51.6°', () => {
    const iss = getMission('iss')!;
    expect(iss.targetOrbitKm).toBe(420);
    expect(iss.inclinationDeg).toBe(51.6);
  });

  it('Hubble servicing mission reaches 540 km', () => {
    const hubble = getMission('sts_hubble')!;
    expect(hubble.category).toBe('servicing');
    expect(hubble.targetOrbitKm).toBe(540);
  });

  it('Salyut 1 carries the Soyuz 11 scenario', () => {
    const salyut = getMission('salyut1')!;
    expect(salyut.events?.map((e) => e.id)).toContain('soyuz11');
  });

  it('Mercury flew a single crew member', () => {
    expect(getMission('mercury')!.crew).toBe(1);
  });

  it('Apollo 1 is an accident mission', () => {
    expect(getMission('apollo1')!.category).toBe('accident');
  });

  it('mission ids are unique and resolvable', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getMission(id)?.id).toBe(id);
  });

  it('every event references a known accident scenario', () => {
    const known = new Set(SCENARIOS.map((s) => s.id));
    for (const m of MISSIONS) for (const e of m.events ?? []) expect(known.has(e.id)).toBe(true);
  });

  it('every mission has at least one physical stage', () => {
    for (const m of MISSIONS) {
      expect(m.stages.length).toBeGreaterThan(0);
      for (const s of m.stages) expect(s.propellantMassKg).toBeGreaterThan(0);
    }
  });

  it('reusing archetype stages does not alias the library', () => {
    const saturn = MISSIONS.find((m) => m.id === 'apollo')!;
    const apolloStage = saturn.stages[0];
    apolloStage.propellantMassKg = 1;
    expect(getMission('skylab')!.stages[0].propellantMassKg).not.toBe(1);
  });

  it('unknown id resolves to undefined', () => {
    expect(getMission('nope')).toBeUndefined();
  });
});
