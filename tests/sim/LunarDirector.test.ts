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

    expect([...new Set(seen)]).toEqual(LUNAR_PHASES);
    expect(lunarAltitudeKm).toBeLessThanOrEqual(1);
    expect(landingSpeedMs).toBeLessThanOrEqual(2);
    expect(returnAltKm).toBeLessThanOrEqual(120);
    expect(computerCycles).toBeGreaterThan(1000);
    expect(d.finished).toBe(true);
  });

  it('keeps the moon ephemeris continuous across clock resets', () => {
    const d = new LunarDirector();
    let previousMoon = d.moonPositionKm();
    let previousCraft = d.positionKm();
    let previousPhase = d.phase;
    let maxMoonJumpKm = 0;
    let maxCraftJumpKm = 0;

    for (let i = 0; i < 200_000 && !d.finished; i++) {
      d.step(5, 0.1);
      const moon = d.moonPositionKm();
      const craft = d.positionKm();
      maxMoonJumpKm = Math.max(
        maxMoonJumpKm,
        Math.hypot(
          moon[0] - previousMoon[0],
          moon[1] - previousMoon[1],
          moon[2] - previousMoon[2],
        ),
      );
      const craftJumpKm = Math.hypot(
        craft[0] - previousCraft[0],
        craft[1] - previousCraft[1],
        craft[2] - previousCraft[2],
      );
      if (d.phase === previousPhase) {
        maxCraftJumpKm = Math.max(maxCraftJumpKm, craftJumpKm);
      }
      previousMoon = moon;
      previousCraft = craft;
      previousPhase = d.phase;
    }

    // At dt = 5 s the moon moves about 5 km; a reset would jump hundreds.
    expect(maxMoonJumpKm).toBeLessThan(20);
    // Geocentric craft positions must stay continuous across frame changes.
    expect(maxCraftJumpKm).toBeLessThan(100);
  });
});
