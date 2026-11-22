import { describe, it, expect } from 'vitest';
import { LunarDirector } from '../../src/sim/LunarDirector';
import { ARCHETYPES } from '../../src/physics/archetypes';

function run(until: (d: LunarDirector) => boolean, limit = 200_000): LunarDirector {
  const d = new LunarDirector();
  for (let i = 0; i < limit && !d.finished && !until(d); i++) d.step(5, 0.1);
  return d;
}

describe('Apollo mission phases', () => {
  it('separates the spent first stage before parking orbit', () => {
    const d = new LunarDirector();
    const seen: string[] = [];
    let massBefore = 0;
    let massAfter = 0;
    for (let i = 0; i < 200_000 && d.phase !== 'PARK'; i++) {
      if (d.phase === 'ASCENT' && !massBefore) massBefore = d.telemetry().fuelPct;
      d.step(5, 0.1);
      if (seen[seen.length - 1] !== d.phase) seen.push(d.phase);
      if (d.phase === 'STAGE_SEP') massAfter = d.telemetry().fuelPct;
    }
    expect(seen).toContain('STAGE_SEP');
    expect(massAfter).toBeLessThan(massBefore);
  });

  it('descends continuously to the lunar surface', () => {
    const d = new LunarDirector();
    let previousAlt = Infinity;
    let maxDropM = 0;
    for (let i = 0; i < 200_000 && d.phase !== 'MOON_LANDING'; i++) {
      d.step(5, 0.1);
      const alt = d.telemetry().altitudeKm * 1000;
      if (d.phase === 'DESCENT' && Number.isFinite(previousAlt)) {
        maxDropM = Math.max(maxDropM, previousAlt - alt);
      }
      previousAlt = alt;
    }
    expect(d.phase).toBe('MOON_LANDING');
    expect(d.telemetry().altitudeKm).toBeLessThan(0.05);
    expect(d.telemetry().speedMs).toBeLessThanOrEqual(2);
    // 5 s of guided descent cannot cover a kilometre in one step.
    expect(maxDropM).toBeLessThan(200);
  });

  it('coasts from lunar orbit to Earth entry', () => {
    const d = new LunarDirector();
    let returnStart = 0;
    let entryStart = 0;
    for (let i = 0; i < 600_000 && d.phase !== 'EARTH_ENTRY'; i++) {
      if (d.phase === 'EARTH_RETURN' && !returnStart) {
        returnStart = d.telemetry().t;
      }
      d.step(5, 0.1);
      if (d.phase === 'EARTH_ENTRY' && !entryStart) entryStart = d.telemetry().t;
    }
    expect(entryStart - returnStart).toBeGreaterThan(60_000);
  });

  it('decelerates through aerodynamic drag during entry', () => {
    const d = new LunarDirector();
    const saturn = ARCHETYPES.find((a) => a.id === 'saturn_v')!;
    d.setVehicle('tower', false, saturn.stages, 45_000);
    while (d.phase !== 'EARTH_ENTRY' && !d.finished) d.step(5, 0.1);
    let peakDrag = 0;
    let startSpeed = d.telemetry().speedMs;
    for (let i = 0; i < 10_000 && d.phase === 'EARTH_ENTRY'; i++) {
      d.step(1, 0.1);
      peakDrag = Math.max(peakDrag, d.telemetry().dragN ?? 0);
    }
    expect(peakDrag).toBeGreaterThan(10_000);
    expect(d.telemetry().speedMs).toBeLessThan(startSpeed);
  });
});
