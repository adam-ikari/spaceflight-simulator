import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from '../../src/physics/archetypes';
import { validateRocket } from '../../src/physics/RocketEquation';

const archetypeById = (id: string) => ARCHETYPES.find((a) => a.id === id);

describe('archetype library', () => {
  it('saturn_v is engineering with 3 stages', () => {
    const saturn = archetypeById('saturn_v')!;
    expect(saturn.category).toBe('engineering');
    expect(saturn.stages.length).toBe(3);
  });

  it('shuttle carries a solid booster', () => {
    const shuttle = archetypeById('shuttle')!;
    expect(shuttle.stages.some((s) => s.isSolid === true)).toBe(true);
  });

  it('planetary engine is physically infeasible', () => {
    expect(archetypeById('planetary_engine')!.feasibility).toBe('infeasible');
  });

  it('saturn_v closes the LEO dv budget', () => {
    expect(validateRocket(archetypeById('saturn_v')!.stages, 140000).ok).toBe(true);
  });

  it('every archetype id is unique and non-empty', () => {
    const ids = ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ARCHETYPES.length).toBeGreaterThanOrEqual(12);
  });
});
