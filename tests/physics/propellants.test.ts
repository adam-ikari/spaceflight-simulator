import { describe, it, expect } from 'vitest';
import { PROPELLANTS } from '../../src/physics/propellants';
import { CONST } from '../../src/physics/constants';

describe('PROPELLANTS', () => {
  it('LOX_RP1 Isp range is 330–350 s', () => {
    const [lo, hi] = PROPELLANTS.LOX_RP1.ispVacRange;
    expect(lo).toBe(330);
    expect(hi).toBe(350);
  });

  it('LOX_LH2 has the lowest mGmol of all combos', () => {
    const masses = Object.values(PROPELLANTS).map((p) => p.mGmol);
    expect(Math.min(...masses)).toBe(PROPELLANTS.LOX_LH2.mGmol);
  });

  it('contains all four propellant keys', () => {
    expect(Object.keys(PROPELLANTS).sort()).toEqual(
      ['LOX_CH4', 'LOX_LH2', 'LOX_RP1', 'NTO_MMH'].sort(),
    );
  });
});

describe('CONST', () => {
  it('exposes standard gravity and earth constants', () => {
    expect(CONST.G0).toBe(9.80665);
    expect(CONST.MU_EARTH).toBe(3.986004418e14);
    expect(CONST.R_EARTH).toBe(6371e3);
    expect(CONST.J2).toBe(1.08263e-3);
  });
});
