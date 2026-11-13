import { describe, it, expect } from 'vitest';
import {
  dragAreaM2,
  dragCoefficient,
  dragForceN,
  machNumber,
  speedOfSoundMs,
  stackFrontalAreaM2,
} from '../../src/physics/Aerodynamics';
import { computeVehicleGeometry } from '../../src/render/vehicleGeometry';
import { ARCHETYPES } from '../../src/physics/archetypes';
import { density } from '../../src/physics/Atmosphere';

const saturn = ARCHETYPES.find((a) => a.id === 'saturn_v')!.stages;
const geo = computeVehicleGeometry(saturn, false);

describe('speed of sound and Mach', () => {
  it('is ~340 m/s at sea level and drops through the stratosphere', () => {
    expect(speedOfSoundMs(0)).toBeCloseTo(340, 0);
    expect(speedOfSoundMs(11)).toBeCloseTo(295, 0);
    expect(speedOfSoundMs(50)).toBeGreaterThan(295);
  });

  it('machNumber is speed / speed of sound', () => {
    expect(machNumber(340, 0)).toBeCloseTo(1, 2);
    expect(machNumber(0, 20)).toBe(0);
  });
});

describe('shape-derived frontal area', () => {
  it('uses the geometry radius, not a fixed 80 m²', () => {
    expect(geo.frontalAreaM2).toBeCloseTo(Math.PI * geo.radiusM ** 2, 6);
    // The volume-derived Saturn V stack is ~64 m², not the old constant 80.
    expect(geo.frontalAreaM2).toBeGreaterThan(55);
    expect(geo.frontalAreaM2).toBeLessThan(75);
  });

  it('adds the side-booster pair when the geometry has strap-ons', () => {
    const solid = { ...saturn[0], isSolid: true, propellantMassKg: 400_000 };
    const boosted = computeVehicleGeometry([solid, ...saturn.slice(1)], true);
    expect(boosted.strapOn).not.toBeNull();
    const area = stackFrontalAreaM2(boosted);
    expect(area).toBeGreaterThan(boosted.frontalAreaM2);
    expect(area).toBeCloseTo(
      boosted.frontalAreaM2 + 2 * Math.PI * boosted.strapOn!.radiusM ** 2,
      6,
    );
  });
});

describe('drag coefficient vs Mach and shape', () => {
  const cd = (m: number): number =>
    dragCoefficient(m, geo.fineness, geo.wettedAreaM2 / stackFrontalAreaM2(geo));

  it('is subsonic-cheap at M 0.3', () => {
    expect(cd(0.3)).toBeGreaterThan(0.22);
    expect(cd(0.3)).toBeLessThan(0.3);
  });

  it('peaks through the transonic rise near M 1.1', () => {
    expect(cd(1.1)).toBeGreaterThan(0.45);
    expect(cd(1.1)).toBeLessThan(0.55);
    expect(cd(1.1)).toBeGreaterThan(cd(0.3));
    expect(cd(1.1)).toBeGreaterThan(cd(3));
  });

  it('decays in the supersonic regime', () => {
    expect(cd(3)).toBeGreaterThan(0.28);
    expect(cd(3)).toBeLessThan(0.35);
    expect(cd(6)).toBeGreaterThan(0.26);
    expect(cd(6)).toBeLessThan(0.34);
  });

  it('a stubby stack pays more drag than a slender one', () => {
    const ratio = 37;
    const slender = dragCoefficient(0.3, 10, ratio);
    const stubby = dragCoefficient(0.3, 3, ratio);
    expect(stubby).toBeGreaterThan(slender);
  });
});

describe('drag force', () => {
  it('is zero at rest', () => {
    expect(dragForceN(geo, 0, 0)).toBe(0);
  });

  it('scales with dynamic pressure at fixed Mach', () => {
    // 0.05–0.15 Mach: Cd is effectively flat, so doubling speed should
    // quadruple drag.
    const slow = dragForceN(geo, 20, 0);
    const fast = dragForceN(geo, 40, 0);
    expect(fast / slow).toBeGreaterThan(3.8);
    expect(fast / slow).toBeLessThan(4.2);
  });

  it('is the ½ρv²·CdA the trajectory integrates', () => {
    const speed = 200;
    const alt = 3_000;
    const expected = 0.5 * density(alt) * speed * speed * dragAreaM2(geo, machNumber(speed, alt / 1000));
    expect(dragForceN(geo, speed, alt / 1000)).toBeCloseTo(expected, 6);
  });
});
