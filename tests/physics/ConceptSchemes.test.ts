import { describe, it, expect } from 'vitest';
import {
  CONCEPT_SCHEMES,
  tensileFeasibility,
  laserLaunchFeasibility,
  massDriverFeasibility,
  sailAcceleration,
} from '../../src/physics/ConceptSchemes';

describe('concept schemes', () => {
  it('antimatter is listed and infeasible', () => {
    const antimatter = CONCEPT_SCHEMES.find((s) => s.id === 'antimatter');
    expect(antimatter).toBeDefined();
    expect(antimatter!.feasibility).toBe('infeasible');
    expect(antimatter!.ispS).toBe(1e7);
  });

  it('has every scheme from the design table', () => {
    const ids = CONCEPT_SCHEMES.map((s) => s.id).sort();
    expect(ids).toEqual(
      [
        'antimatter',
        'fusion_direct',
        'laser_launch',
        'mass_driver',
        'ntr_mars',
        'sabre',
        'skyhook',
        'solar_sail',
        'space_elevator',
      ].sort(),
    );
  });

  it('solar_sail is researched, no Isp', () => {
    const s = CONCEPT_SCHEMES.find((x) => x.id === 'solar_sail')!;
    expect(s.feasibility).toBe('researched');
    expect(s.ispS).toBeUndefined();
  });

  it('space elevator bottleneck cites ~50 GPa', () => {
    const s = CONCEPT_SCHEMES.find((x) => x.id === 'space_elevator')!;
    expect(s.feasibility).toBe('concept');
    expect(s.bottleneck).toContain('50');
  });
});

describe('tensileFeasibility', () => {
  it('CNT 63 GPa at taper 1.5 is a concept, not infeasible', () => {
    expect(tensileFeasibility(63, 1.5)).not.toBe('infeasible');
  });

  it('63 GPa at taper 1 meets the 50 GPa requirement', () => {
    expect(tensileFeasibility(63, 1)).toBe('researched');
  });

  it('steel-class 20 GPa is infeasible', () => {
    expect(tensileFeasibility(20, 1)).toBe('infeasible');
  });

  it('far below requirement (<90%) is infeasible', () => {
    expect(tensileFeasibility(30, 1.5)).toBe('infeasible');
  });
});

describe('massDriverFeasibility', () => {
  it('surface launch (0 km) is infeasible: atmospheric plasma', () => {
    expect(massDriverFeasibility(0)).toBe('infeasible');
  });

  it('high-orbit launch (300 km) is flyable', () => {
    expect(massDriverFeasibility(300)).toBe('flyable');
  });

  it('high-altitude ground launcher (100 km) is researched', () => {
    expect(massDriverFeasibility(100)).toBe('researched');
  });

  it('mid atmosphere (30 km) is concept', () => {
    expect(massDriverFeasibility(30)).toBe('concept');
  });
});

describe('sailAcceleration', () => {
  it('1 km² sail, 1000 kg at 1 AU ~ 9 mm/s²', () => {
    // 9 µPa × 1e6 m² = 9 N; /1000 kg = 9e-3 m/s² (mm/s² scale).
    const a = sailAcceleration(1, 1, 1000);
    expect(a).toBeGreaterThan(1e-3);
    expect(a).toBeLessThan(1e-1);
    expect(a).toBeCloseTo(9e-3, 6);
  });

  it('falls with distance² and scales with area', () => {
    const a1 = sailAcceleration(1, 1, 1000);
    expect(sailAcceleration(1, 2, 1000)).toBeCloseTo(a1 / 4, 9);
    expect(sailAcceleration(4, 1, 1000)).toBeCloseTo(a1 * 4, 9);
  });

  it('radiation pressure matches 2S/c ≈ 9 µPa', () => {
    // a * m / area = pressure
    const pressure = (sailAcceleration(1, 1, 1000) * 1000) / 1e6;
    expect(pressure).toBeCloseTo(9e-6, 8);
  });
});

describe('laserLaunchFeasibility', () => {
  it('small payload + GW laser gives orbital-scale dv', () => {
    const { dvMs, feasible } = laserLaunchFeasibility(5, 1);
    expect(dvMs).toBeGreaterThan(1000);
    expect(feasible).toBe('researched');
  });

  it('huge payload is infeasible', () => {
    expect(laserLaunchFeasibility(10000, 1).feasible).toBe('infeasible');
  });

  it('dv decreases with payload', () => {
    expect(laserLaunchFeasibility(10, 1).dvMs).toBeLessThan(
      laserLaunchFeasibility(1, 1).dvMs,
    );
  });
});
