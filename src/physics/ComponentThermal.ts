/**
 * ComponentThermal — lumped thermal network for individual vehicle components.
 *
 * Each component is a node with its own mass, heat capacity, area, emissivity
 * and temperature limit. Heat enters from combustion (engine), aerothermal
 * heating (TPS), solar flux and internal dissipation; it leaves by radiation to
 * the environment, convection in atmosphere, regenerative cooling (coolant
 * flow) and ablation (TPS above its ablation temperature).
 *
 * The temperature update solves the lumped-capacitance balance implicitly:
 *
 *     C·(T − T0)/dt = Q_in − ε·σ·A·(T⁴ − T_sink⁴) − h·A·(T − T_amb)
 *
 * Newton iteration on the scalar T makes the step stable at the mission
 * integrator's coarse dt (warped seconds), which an explicit scheme is not.
 *
 * Anchors used by the tests (all independently reproducible):
 *  - Solar equilibrium: α·S = ε·σ·T⁴; S = 1361 W/m², α = ε → 394 K.
 *  - Radiative equilibrium at 1 MW/m² with ε = 0.85 → 2130 K.
 *  - Carbon ablator limit 3500 K corresponds to ≈ 7.2 MW/m² net flux.
 *  - Sutton–Graves at 60 km, 7.6 km/s, 1 m nose radius → ≈ 1.4 MW/m².
 *  - Engine wall: gas-side conductance from a Bartz-scaled fit, coolant-side
 *    conductance from Dittus–Boelter scaling, liner conduction in series. At
 *    LOX/RP-1 7 MPa / 100 kg/s the wall lands at 600–900 K; at SSME-class
 *    20 MPa / 500 kg/s it stays in the same band.
 */

export const SIGMA = 5.670374419e-8; // Stefan–Boltzmann, W/m²K⁴
export const SOLAR_CONSTANT_WM2 = 1361;
/** Deep-space sink temperature, K (cosmic microwave background ≈ 2.7 K). */
export const SPACE_SINK_K = 3;

/** Latent heat of vaporisation, J/kg (NIST values). */
export const LATENT_HEAT_JKG: Record<string, number> = {
  LOX_LH2: 446_000, // hydrogen
  LOX_CH4: 511_000, // methane
  LOX_RP1: 213_000, // oxygen-dominated (LOX boils first)
  NTO_MMH: 800_000, // storable, high-boiling
};

/** Component classes that carry distinct thermal behaviour. */
export type ComponentKind = 'chamber' | 'nozzle' | 'tank' | 'tps' | 'avionics' | 'cabin';

export interface ThermalNode {
  id: string;
  label: string;
  kind: ComponentKind;
  /** Structural mass of the node, kg. */
  massKg: number;
  /** Total surface area that radiates and convects, m². */
  areaM2: number;
  /** Projected area that absorbs solar flux, m². */
  solarAreaM2: number;
  /** Specific heat, J/(kg·K). */
  cpJKgK: number;
  emissivity: number;
  absorptivity: number;
  /** Current temperature, K. */
  tempK: number;
  /** Material/service limit, K. */
  maxTempK: number;
  /** Lower service limit (cryogenic seals, electronics), K. */
  minTempK: number;
  /** Internal dissipation (electronics, crew, pumps), W. */
  internalW: number;
  /** TPS only: surface temperature at which ablation starts, K. */
  ablationTempK?: number;
  /** TPS only: effective heat of ablation, J/kg. */
  ablationHeatJKg?: number;
}

export interface ThermalEnvironment {
  /** Solar flux at the vehicle's position, W/m² (0 in eclipse). */
  solarWm2: number;
  /** Radiating sink temperature, K. */
  sinkK: number;
  /** Ambient gas temperature, K. */
  ambientK: number;
  /** Convective coefficient to ambient (0 in vacuum), W/(m²·K). */
  convectionWm2K: number;
  /** Externally imposed heat into this node (combustion, aero), W. */
  imposedHeatW: number;
}

export interface ThermalStepResult {
  tempK: number;
  /** Ablated mass during the step, kg (0 for non-ablative nodes). */
  massLossKg: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Equilibrium temperature of a surface absorbing `solarWm2` and radiating. */
export function solarEquilibriumTemp(
  solarWm2: number,
  absorptivity: number,
  emissivity: number,
  sinkK = 0,
): number {
  if (emissivity <= 0) throw new Error('emissivity must be positive');
  const absorbed = absorptivity * Math.max(0, solarWm2);
  const emitted = emissivity * SIGMA;
  return Math.pow(absorbed / emitted + Math.pow(sinkK, 4), 0.25);
}

/** Temperature at which a surface radiates `heatFluxWm2` (per m²). */
export function radiativeEquilibriumTemp(
  heatFluxWm2: number,
  emissivity: number,
  sinkK = SPACE_SINK_K,
): number {
  if (emissivity <= 0) throw new Error('emissivity must be positive');
  const q = Math.max(0, heatFluxWm2);
  return Math.pow(q / (emissivity * SIGMA) + Math.pow(sinkK, 4), 0.25);
}

/**
 * Sutton–Graves stagnation-point heat flux, W/m².
 *
 *     q = k·sqrt(ρ / R_n)·V³,  k = 1.83e-4 (Earth air)
 *
 * ρ in kg/m³, R_n in m, V in m/s. This is the standard engineering correlation
 * used for entry-body sizing; it neglects ablation, which is applied separately
 * by the node's ablation sink.
 */
export function suttonGravesHeatFlux(
  densityKgM3: number,
  speedMs: number,
  noseRadiusM: number,
): number {
  if (densityKgM3 <= 0 || speedMs <= 0) return 0;
  const rn = Math.max(1e-3, noseRadiusM);
  return 1.83e-4 * Math.sqrt(densityKgM3 / rn) * Math.pow(speedMs, 3);
}

/** Boil-off mass flow from a heat leak, kg/s. */
export function boiloffRateKgS(heatLeakW: number, latentHeatJKg: number): number {
  if (latentHeatJKg <= 0) throw new Error('latentHeatJKg must be positive');
  return Math.max(0, heatLeakW) / latentHeatJKg;
}

/**
 * Gas-side convective conductance at the throat, W/(m²·K).
 *
 * Bartz correlation reduces to h_g ∝ p_c^0.8 · d_t^-0.2 · c*^-0.8. The
 * prefactor is calibrated so LOX/RP-1 at 7 MPa, 0.2 m throat and c* = 1750 m/s
 * gives h_g = 1.11e4 W/(m²·K), the value that reproduces the measured
 * 30 MW/m² throat flux at a 3400 K adiabatic wall.
 */
export function engineGasSideH(inp: {
  pcMPa: number;
  throatDiameterM: number;
  cstar: number;
  gamma?: number;
}): number {
  const pc = Math.max(0.1, inp.pcMPa);
  const d = Math.max(0.01, inp.throatDiameterM);
  const cstar = Math.max(100, inp.cstar);
  const gamma = inp.gamma ?? 1.2;
  const h = 1.11e4 * Math.pow(pc / 7, 0.8) * Math.pow(0.2 / d, 0.2) * Math.pow(1750 / cstar, 0.8);
  // Bartz's property correction rises weakly with γ; keep the effect explicit.
  return h * Math.pow(gamma / 1.2, 0.2);
}

/**
 * Coolant-side conductance, W/(m²·K).
 *
 * Dittus–Boelter scaling h ∝ ṁ^0.8 / d_h^0.2; calibrated at 100 kg/s to
 * 9.23e4 W/(m²·K) for a 5 mm hydraulic diameter channel.
 */
export function coolantSideH(mdotKgS: number, hydraulicDiameterM = 0.005): number {
  const mdot = Math.max(0, mdotKgS);
  const dh = Math.max(1e-4, hydraulicDiameterM);
  return 9.23e4 * Math.pow(mdot / 100, 0.8) * Math.pow(0.005 / dh, 0.2);
}

export interface RegenWallInput {
  /** Adiabatic wall temperature of the combustion gas, K. */
  tAdiabaticK: number;
  /** Coolant inlet temperature, K. */
  tCoolantK: number;
  /** Gas-side conductance, W/(m²·K). */
  gasHWm2K: number;
  /** Liner thickness, m. */
  linerThicknessM: number;
  /** Liner conductivity, W/(m·K) (copper alloy ≈ 400). */
  linerKWmK: number;
  /** Coolant-side conductance, W/(m²·K). */
  coolantHWm2K: number;
}

export interface RegenWallResult {
  /** Heat flux into the coolant, W/m². */
  heatFluxWm2: number;
  /** Hot-gas-side wall temperature, K. */
  wallHotK: number;
  /** Coolant-side wall temperature, K. */
  wallColdK: number;
}

/**
 * One-dimensional series-resistance wall: gas film → liner → coolant film.
 *
 *     q = (T_aw − T_cool) / (1/h_g + t/k + 1/h_c)
 *
 * This is the model that sets engine wall temperature; it is not a CFD solve,
 * but every term is a measured or tabulated quantity.
 */
export function regenerativeWall(inp: RegenWallInput): RegenWallResult {
  const rGas = 1 / Math.max(1e-6, inp.gasHWm2K);
  const rLiner = Math.max(0, inp.linerThicknessM) / Math.max(1e-6, inp.linerKWmK);
  const rCool = 1 / Math.max(1e-6, inp.coolantHWm2K);
  const rTotal = rGas + rLiner + rCool;
  const q = (inp.tAdiabaticK - inp.tCoolantK) / rTotal;
  return {
    heatFluxWm2: q,
    wallHotK: inp.tAdiabaticK - q * rGas,
    wallColdK: inp.tCoolantK + q * rCool,
  };
}

/**
 * Advance one thermal node by `dtSec` and return its new temperature.
 * Pure: the caller owns the node state.
 */
export function stepThermalNode(
  node: ThermalNode,
  env: ThermalEnvironment,
  dtSec: number,
): ThermalStepResult {
  const dt = Math.max(0, dtSec);
  if (dt === 0) return { tempK: node.tempK, massLossKg: 0 };

  const C = Math.max(node.massKg * node.cpJKgK, 1);
  const qSolar = node.absorptivity * Math.max(0, env.solarWm2) * Math.max(0, node.solarAreaM2);
  const qIn = node.internalW + env.imposedHeatW + qSolar;

  const epsA = node.emissivity * SIGMA * Math.max(0, node.areaM2);
  const hA = Math.max(0, env.convectionWm2K) * Math.max(0, node.areaM2);
  const sink4 = Math.pow(Math.max(0, env.sinkK), 4);

  // The service limits (minTempK/maxTempK) are risk thresholds, not physical
  // ceilings: the solver must be allowed to exceed them, or over-temperature
  // failures could never be detected.
  const T0 = Math.max(1, node.tempK);
  let T = T0;

  // Newton solve of the implicit balance; monotone in T so it converges fast.
  for (let i = 0; i < 8; i++) {
    const f = (C / dt) * (T - T0) + epsA * (Math.pow(T, 4) - sink4) + hA * (T - env.ambientK) - qIn;
    const fp = C / dt + 4 * epsA * Math.pow(T, 3) + hA;
    const d = f / fp;
    T = clamp(T - d, 1, 6000);
    if (Math.abs(d) < 1e-6) break;
  }
  T = clamp(T, 1, 6000);

  let massLossKg = 0;
  const ablT = node.ablationTempK;
  const ablH = node.ablationHeatJKg;
  if (T > (ablT ?? Infinity) && ablH && ablH > 0) {
    const holding = epsA * (Math.pow(ablT as number, 4) - sink4) + hA * (ablT! - env.ambientK);
    const excessW = qIn - holding;
    if (excessW > 0) {
      T = ablT as number;
      massLossKg = (excessW / ablH) * dt;
    }
  }

  return { tempK: T, massLossKg };
}

/**
 * Tank wall heat leak through insulation, W.
 * U is the effective conductance (MLI blankets ≈ 0.005–0.02 W/m²K).
 */
export function tankHeatLeakW(
  areaM2: number,
  conductanceWm2K: number,
  ambientK: number,
  tankK: number,
): number {
  return Math.max(0, areaM2) * Math.max(0, conductanceWm2K) * Math.max(0, ambientK - tankK);
}
