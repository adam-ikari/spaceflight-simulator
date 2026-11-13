import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../../src/physics/archetypes';
import { computeVehicleGeometry } from '../../src/render/vehicleGeometry';
import {
  EARTH_RADIUS_UNITS,
  METRES_PER_UNIT,
  UNITS_PER_KM,
} from '../../src/render/sceneScale';
import { METRES_PER_UNIT as VEHICLE_METRES_PER_UNIT } from '../../src/render/vehicleGeometry';

describe('scene scale', () => {
  it('one scene unit is 100 m everywhere', () => {
    expect(METRES_PER_UNIT).toBe(100);
    expect(VEHICLE_METRES_PER_UNIT).toBe(METRES_PER_UNIT);
    expect(UNITS_PER_KM).toBe(10);
  });

  it('Earth radius is 63,710 scene units', () => {
    expect(EARTH_RADIUS_UNITS).toBe(63_710);
  });

  it('Saturn V is roughly 1/77,000 of the Earth radius, not 1/78', () => {
    const stages = ARCHETYPES.find((a) => a.id === 'saturn_v')!.stages.map((s) => ({ ...s }));
    const model = computeVehicleGeometry(stages, false);
    const ratio = model.height / EARTH_RADIUS_UNITS;
    expect(ratio).toBeGreaterThan(1 / 100_000);
    expect(ratio).toBeLessThan(1 / 50_000);
  });
});
