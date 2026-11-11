import { describe, it, expect } from 'vitest';
import {
  SIGMA,
  SOLAR_CONSTANT_WM2,
  boiloffRateKgS,
  coolantSideH,
  engineGasSideH,
  radiativeEquilibriumTemp,
  regenerativeWall,
  solarEquilibriumTemp,
  stepThermalNode,
  suttonGravesHeatFlux,
  tankHeatLeakW,
  type ThermalEnvironment,
  type ThermalNode,
} from '../../src/physics/ComponentThermal';

const spaceEnv = (overrides: Partial<ThermalEnvironment> = {}): ThermalEnvironment => ({
  solarWm2: 0,
  sinkK: 3,
  ambientK: 3,
  convectionWm2K: 0,
  imposedHeatW: 0,
  ...overrides,
});

const plate = (overrides: Partial<ThermalNode> = {}): ThermalNode => ({
  id: 'plate',
  label: 'test plate',
  kind: 'avionics',
  massKg: 10,
  areaM2: 1,
  solarAreaM2: 1,
  cpJKgK: 1000,
  emissivity: 0.9,
  absorptivity: 0.9,
  tempK: 300,
  maxTempK: 400,
  minTempK: 200,
  internalW: 0,
  ...overrides,
});

/** Integrate one node to steady state. */
function settle(node: ThermalNode, env: ThermalEnvironment, tMax = 20_000, dt = 20): ThermalNode {
  let n = node;
  for (let t = 0; t < tMax; t += dt) {
    n = { ...n, tempK: stepThermalNode(n, env, dt).tempK };
  }
  return n;
}

describe('radiative equilibrium', () => {
  it('a 1 m² plate in full sunlight with α = ε settles at 394 K', () => {
    const solved = solarEquilibriumTemp(SOLAR_CONSTANT_WM2, 0.9, 0.9);
    // α·S = ε·σ·T⁴  →  T = (S/σ)^0.25 = 393.6 K
    expect(solved).toBeCloseTo(393.6, 0);

    const settled = settle(plate(), spaceEnv({ solarWm2: SOLAR_CONSTANT_WM2 }));
    expect(settled.tempK).toBeGreaterThan(388);
    expect(settled.tempK).toBeLessThan(399);
  });

  it('1 MW/m² with ε = 0.85 gives 2130 K (not 3796 K — that is 10 MW/m²)', () => {
    expect(radiativeEquilibriumTemp(1e6, 0.85)).toBeCloseTo(2130, -1);
    expect(radiativeEquilibriumTemp(1e7, 0.85)).toBeCloseTo(3796, -1);
  });

  it('the carbon-ablator 3500 K limit corresponds to ~7.2 MW/m²', () => {
    const qAtLimit = 0.85 * SIGMA * Math.pow(3500, 4);
    expect(qAtLimit / 1e6).toBeGreaterThan(6.5);
    expect(qAtLimit / 1e6).toBeLessThan(8.0);
    expect(radiativeEquilibriumTemp(qAtLimit, 0.85)).toBeCloseTo(3500, -1);
  });
});

describe('Sutton–Graves entry heating', () => {
  it('60 km, 7.6 km/s, 1 m nose radius gives ~1.4 MW/m²', () => {
    // Exponential-atmosphere density at 60 km ≈ 3.1e-4 kg/m³.
    const q = suttonGravesHeatFlux(3.1e-4, 7600, 1);
    expect(q / 1e6).toBeGreaterThan(1.0);
    expect(q / 1e6).toBeLessThan(1.9);
  });

  it('scales with V³ and with 1/sqrt(R_n)', () => {
    const base = suttonGravesHeatFlux(1e-4, 7000, 1);
    expect(suttonGravesHeatFlux(1e-4, 14_000, 1) / base).toBeCloseTo(8, 6);
    expect(suttonGravesHeatFlux(1e-4, 7000, 4) / base).toBeCloseTo(0.5, 6);
    expect(suttonGravesHeatFlux(0, 7000, 1)).toBe(0);
  });
});

describe('stepThermalNode numerical behaviour', () => {
  it('implicit step is stable and dt-independent for a radiating plate', () => {
    const env = spaceEnv({ solarWm2: SOLAR_CONSTANT_WM2 });
    const a = settle(plate(), env, 20_000, 1);
    const b = settle(plate(), env, 20_000, 120);
    expect(Math.abs(a.tempK - b.tempK)).toBeLessThan(1);
    expect(a.tempK).toBeGreaterThan(390);
  });

  it('never returns a negative or NaN temperature', () => {
    let n = plate({ tempK: 300, emissivity: 0.1, absorptivity: 0.1 });
    for (let i = 0; i < 1000; i++) {
      n = { ...n, tempK: stepThermalNode(n, spaceEnv(), 60).tempK };
      expect(Number.isFinite(n.tempK)).toBe(true);
      expect(n.tempK).toBeGreaterThan(0);
    }
  });

  it('a hot node cools toward the sink in shadow', () => {
    const n = settle(plate({ tempK: 1500 }), spaceEnv(), 20_000, 20);
    expect(n.tempK).toBeLessThan(1500);
    expect(n.tempK).toBeLessThan(400);
  });

  it('over-temperature is visible: the solver may exceed maxTempK', () => {
    const n = settle(plate({ maxTempK: 400 }), spaceEnv({ solarWm2: SOLAR_CONSTANT_WM2 }), 20_000, 20);
    // Equilibrium 394 K is below the limit; now push the flux up 4×.
    const hot = settle(
      plate({ maxTempK: 400 }),
      spaceEnv({ solarWm2: 4 * SOLAR_CONSTANT_WM2 }),
      20_000,
      20,
    );
    expect(n.tempK).toBeLessThan(400);
    expect(hot.tempK).toBeGreaterThan(400);
  });
});

describe('ablative TPS', () => {
  it('holds the surface at ablation temperature and loses mass', () => {
    const tps = plate({
      kind: 'tps',
      massKg: 50,
      areaM2: 1,
      solarAreaM2: 1,
      emissivity: 0.85,
      absorptivity: 0.85,
      tempK: 300,
      maxTempK: 3500,
      ablationTempK: 3200,
      ablationHeatJKg: 3.0e7,
    });
    // 10 MW/m² would radiate at 3796 K without ablation; the surface heats to
    // the ablation temperature in seconds, after which mass loss carries the
    // excess energy and the temperature stays pinned.
    const env = spaceEnv({ imposedHeatW: 1.0e7 });
    let n = tps;
    let massLoss = 0;
    for (let i = 0; i < 120; i++) {
      const r = stepThermalNode(n, env, 1);
      n = { ...n, tempK: r.tempK };
      massLoss += r.massLossKg;
    }
    expect(n.tempK).toBeCloseTo(3200, 0);
    expect(massLoss).toBeGreaterThan(0);
  });

  it('does not ablate below the ablation temperature', () => {
    const tps = plate({
      kind: 'tps',
      emissivity: 0.85,
      absorptivity: 0.85,
      tempK: 300,
      ablationTempK: 3200,
      ablationHeatJKg: 3.0e7,
    });
    const r = stepThermalNode(tps, spaceEnv({ imposedHeatW: 1e6 }), 1);
    expect(r.massLossKg).toBe(0);
    expect(r.tempK).toBeLessThan(3200);
  });
});

describe('engine wall (series resistance)', () => {
  const wallAt = (pcMPa: number, mdotKgS: number) => {
    const gasH = engineGasSideH({ pcMPa, throatDiameterM: 0.2, cstar: 1750 });
    const coolH = coolantSideH(mdotKgS);
    return regenerativeWall({
      tAdiabaticK: 3400,
      tCoolantK: 300,
      gasHWm2K: gasH,
      linerThicknessM: 0.0015,
      linerKWmK: 400, // copper alloy
      coolantHWm2K: coolH,
    });
  };

  it('LOX/RP-1 at 7 MPa and 100 kg/s sits in the 600–900 K wall band', () => {
    const w = wallAt(7, 100);
    expect(w.heatFluxWm2 / 1e6).toBeGreaterThan(25);
    expect(w.heatFluxWm2 / 1e6).toBeLessThan(36);
    expect(w.wallHotK).toBeGreaterThan(600);
    expect(w.wallHotK).toBeLessThan(900);
  });

  it('SSME-class 20 MPa and 500 kg/s stays in the same band at higher flux', () => {
    const ref = wallAt(7, 100);
    const ssme = wallAt(20, 500);
    expect(ssme.heatFluxWm2).toBeGreaterThan(2 * ref.heatFluxWm2);
    expect(ssme.wallHotK).toBeGreaterThan(600);
    expect(ssme.wallHotK).toBeLessThan(900);
  });

  it('reducing coolant flow raises the wall temperature', () => {
    const full = wallAt(7, 100);
    const half = wallAt(7, 50);
    expect(half.wallHotK).toBeGreaterThan(full.wallHotK);
    expect(half.heatFluxWm2).toBeLessThan(full.heatFluxWm2);
  });

  it('gas-side conductance follows p_c^0.8 and c*^-0.8', () => {
    const h7 = engineGasSideH({ pcMPa: 7, throatDiameterM: 0.2, cstar: 1750 });
    const h14 = engineGasSideH({ pcMPa: 14, throatDiameterM: 0.2, cstar: 1750 });
    expect(h14 / h7).toBeCloseTo(Math.pow(2, 0.8), 6);
    const hLowCstar = engineGasSideH({ pcMPa: 7, throatDiameterM: 0.2, cstar: 875 });
    expect(hLowCstar).toBeGreaterThan(h7);
  });
});

describe('cryogenic boil-off', () => {
  it('200 W into LH2 gives 38.7 kg/day (0.039 %/day of a 100 t stage)', () => {
    const w = 200;
    const kgPerS = boiloffRateKgS(w, 446_000);
    const kgPerDay = kgPerS * 86400;
    expect(kgPerDay).toBeCloseTo(38.7, 0);
    expect((kgPerDay / 100_000) * 100).toBeCloseTo(0.039, 2);
  });

  it('insulation heat leak scales with area and ΔT', () => {
    const leak = tankHeatLeakW(100, 0.005, 280, 20);
    // 100 m² · 0.005 W/m²K · 260 K = 130 W
    expect(leak).toBeCloseTo(130, 6);
    expect(boiloffRateKgS(leak, 446_000) * 86400).toBeCloseTo(25.2, 0);
  });
});
