import { describe, it, expect } from 'vitest';
import { LunarDirector, LUNAR_PHASES } from '../../src/sim/LunarDirector';

describe('LunarDirector full mission', () => {
  it('reaches lunar landing and Earth return through every phase', () => {
    const d = new LunarDirector();
    const seen: string[] = [];
    let landingSpeedMs = Infinity;
    let lunarAltitudeKm = Infinity;
    let returnAltKm = Infinity;
    let computerCycles = 0;

    for (let i = 0; i < 200_000 && !d.finished; i++) {
      d.step(5, 0.1);
      const phase = d.phase;
      if (seen[seen.length - 1] !== phase) seen.push(phase);
      const t = d.telemetry();
      if (phase === 'MOON_LANDING') landingSpeedMs = Math.min(landingSpeedMs, t.speedMs);
      if (t.body === 'MOON') lunarAltitudeKm = Math.min(lunarAltitudeKm, t.altitudeKm);
      if (phase === 'EARTH_ENTRY') returnAltKm = Math.min(returnAltKm, t.altitudeKm);
      if (t.computer?.length) computerCycles = t.computer[0].cycles;
    }

    expect(seen).toEqual(LUNAR_PHASES);
    expect(lunarAltitudeKm).toBeLessThanOrEqual(1);
    expect(landingSpeedMs).toBeLessThanOrEqual(2);
    expect(returnAltKm).toBeLessThanOrEqual(120);
    expect(computerCycles).toBeGreaterThan(1000);
    expect(d.finished).toBe(true);
  });
});
