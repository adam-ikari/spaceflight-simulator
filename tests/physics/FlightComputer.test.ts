import { describe, expect, it } from 'vitest';
import { FlightComputer, type FlightComputerInput } from '../../src/physics/FlightComputer';

const base: FlightComputerInput = {
  phase: 'ASCENT',
  body: 'EARTH',
  timeSec: 0,
  altitudeM: 0,
  speedMs: 0,
  radialSpeedMs: 0,
  tangentialSpeedMs: 0,
  targetAltitudeM: 190_000,
  targetSpeedMs: 7800,
  dvRemainingMs: 9400,
  massKg: 2.9e6,
  faults: [],
};

describe('FlightComputer', () => {
  it('closes the loop and advances all programs every step', () => {
    const computer = new FlightComputer();
    for (let i = 0; i < 20; i++) computer.step(1, base);
    const command = computer.step(1, { ...base, altitudeM: 190_000, speedMs: 7800 });
    expect(command.programs).toHaveLength(5);
    expect(command.programs.every((p) => p.cycles === 21)).toBe(true);
    expect(command.throttle).toBeGreaterThan(0.6);
    expect((command.pitchRad * 180) / Math.PI).toBeGreaterThan(75);
  });

  it('reports a fault branch when propellant or Δv is exhausted', () => {
    const computer = new FlightComputer();
    const command = computer.step(1, { ...base, dvRemainingMs: 0, faults: ['thermal:chamber'] });
    expect(command.throttle).toBe(0);
    expect(command.programs.some((p) => p.lastOutput.includes('DV_EMPTY'))).toBe(true);
    expect(command.programs.every((p) => !p.healthy)).toBe(true);
  });
});
