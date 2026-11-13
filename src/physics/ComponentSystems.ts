/**
 * ComponentSystems — assemble the thermal and structural models for one vehicle
 * and advance them with the mission state.
 *
 * The vehicle is not one body here. Each stage contributes a tank node, an
 * engine-chamber node and a nozzle node; the stack also carries a TPS, an
 * avionics bay and a crew cabin. Every node has its own mass, area, heat
 * capacity, emissivity and service limit.
 *
 * Sources of heat are phase dependent:
 *  - powered flight: regenerative engine wall temperature from the series
 *    resistance model (gas film / copper liner / coolant film);
 *  - entry: Sutton–Graves stagnation flux on the heat shield, with an
 *    ablation sink that holds the surface at the ablator temperature;
 *  - all phases: solar flux, internal dissipation, radiation, convection.
 *
 * Vibration runs in parallel: pogo from the active stage's feed-line mode,
 * first bending of the stack, and Miles' random-vibration response with Miner
 * fatigue on the avionics mode.
 *
 * Coupling to mission risk: every over-limit state becomes a named failure
 * branch (`thermal:<id>`, `pogo`, `tps_flux`, `fatigue`) that RiskModel unions
 * into PLOC. The state is not decorative.
 */
import type { StageSpec } from './RocketEquation';
import { PROPELLANTS } from './propellants';
import { computeEngine } from './PropulsionEngine';
import { density } from './Atmosphere';
import { tpsLimit } from './MaterialThermal';
import {
  LATENT_HEAT_JKG,
  SIGMA,
  SOLAR_CONSTANT_WM2,
  SPACE_SINK_K,
  boiloffRateKgS,
  coolantSideH,
  engineGasSideH,
  radiativeEquilibriumTemp,
  regenerativeWall,
  stepThermalNode,
  suttonGravesHeatFlux,
  type ComponentKind,
  type ThermalNode,
} from './ComponentThermal';
import {
  CREW_POGO_LIMIT_G,
  firstBendingHz,
  minerDamageIncrement,
  naturalFrequencyHz,
  overLimitProbability,
  pogoEffectiveMassKg,
  pogoResponse,
  pogoStiffnessNm,
  randomVibrationGrms,
} from './StructuralDynamics';
import {
  METRES_PER_UNIT,
  SCENE_EXAGGERATION,
  engineCount,
  propellantDensity,
  stageVolume,
} from '../render/vehicleGeometry';

/** Insulation effective conductance for cryogenic tanks, W/(m²·K). */
const INSULATION_U = 0.02;
/** White MLI solar absorptivity / infrared emissivity. */
const MLI_ABSORPTIVITY = 0.3;
const MLI_EMISSIVITY = 0.8;
/** Cryogenic propellant bulk temperature, K. */
const PROPELLANT_TEMP_K: Record<string, number> = {
  LOX_LH2: 20,
  LOX_CH4: 111,
  LOX_RP1: 90,
  NTO_MMH: 293,
};
/** Engine liner: 1.5 mm copper alloy. */
const LINER_THICKNESS_M = 0.0015;
const LINER_K_WMK = 400;
/** Acoustic random-vibration PSD by phase, g²/Hz (measured order). */
const RANDOM_PSD_BY_PHASE: Record<string, number> = {
  liftoff: 0.04,
  ascent: 0.02,
  stage_sep: 0.01,
};
const DEFAULT_RANDOM_PSD = 0.001;
/** Avionics random-vibration mode and amplification. */
const AVIONICS_MODE_HZ = 150;
const AVIONICS_Q = 10;

export interface SystemsFlightState {
  phase: string;
  altitudeKm: number;
  speedMs: number;
  /** Current stack mass, kg. */
  massKg: number;
  /** Thrust currently produced, N (0 when coasting). */
  thrustN: number;
  /** True during powered flight. */
  powered: boolean;
  /** Active stage index, 0 = bottom; -1 when no engine is running. */
  stageIndex: number;
  dynamicPressurePa: number;
  /** Solar illumination at the vehicle (false in eclipse). */
  inSunlight: boolean;
}

export interface ComponentReading {
  id: string;
  label: string;
  kind: ComponentKind;
  tempK: number;
  maxTempK: number;
  /** tempK / maxTempK; > 1 means past the service limit. */
  utilisation: number;
}

export interface SystemsFailure {
  node: string;
  mode: string;
  prob: number;
  detail: string;
}

export interface SystemsSnapshot {
  components: ComponentReading[];
  engineWallK: number | null;
  nozzleK: number | null;
  tankK: number | null;
  tpsK: number;
  avionicsK: number;
  cabinK: number;
  pogoG: number;
  pogoHz: number;
  bendingHz: number;
  randomGrms: number;
  fatigueDamage: number;
  boiloffKg: number;
  boiloffPct: number;
  failures: SystemsFailure[];
  /** Highest-utilisation component, or null before the first step. */
  worst: ComponentReading | null;
}

/** US Standard Atmosphere 1976 temperature approximation, K. */
export function ambientTemperatureK(altitudeKm: number): number {
  const h = Math.max(0, altitudeKm);
  if (h <= 11) return 288.15 - 6.5 * h;
  if (h <= 20) return 216.65;
  if (h <= 32) return 216.65 + (h - 20);
  if (h <= 47) return 228.65 + 2.8 * (h - 32);
  if (h <= 51) return 270.65;
  if (h <= 71) return 270.65 - 2.8 * (h - 51);
  if (h <= 85) return 214.65 - 2.0 * (h - 71);
  return 186.65;
}

/** Free-convection/forced-convection coefficient to ambient, W/(m²·K). */
function ambientConvection(speedMs: number, altitudeKm: number): number {
  if (density(altitudeKm * 1000) < 1e-8) return 0;
  return Math.min(80, 4 + 0.02 * Math.max(0, speedMs));
}

const tankLabel = (i: number): string => `S${i + 1} 贮箱`;
const chamberLabel = (i: number): string => `S${i + 1} 发动机壁`;
const nozzleLabel = (i: number): string => `S${i + 1} 喷管`;

export class ComponentSystems {
  private readonly stages: StageSpec[];
  private readonly hasSolidBooster: boolean;
  private readonly stackRadiusM: number;
  private readonly stackLengthM: number;
  private readonly payloadKg: number;
  /** All thermal nodes, in display order. */
  private nodes: ThermalNode[] = [];
  /** Stage that owns each chamber/nozzle node, by node id. */
  private stageOfNode = new Map<string, number>();
  private stageTankAreaM2: number[] = [];
  private boiloffKg = 0;
  private tpsMassLossKg = 0;
  private fatigueDamage = 0;
  private lastPogoG = 0;
  private lastPogoHz = 0;
  private lastBendingHz = 0;
  private lastGrms = 0;
  private lastSnapshot: SystemsSnapshot | null = null;
  private previousChamberK: number[] = [];

  constructor(stages: StageSpec[], payloadKg: number, hasSolidBooster: boolean) {
    this.stages = stages.map((s) => ({ ...s }));
    this.payloadKg = Math.max(0, payloadKg);
    this.hasSolidBooster = hasSolidBooster;
    this.stackRadiusM = 5;
    this.stackLengthM = 100;

    // Geometry from propellant volume (same source as the renderer).
    const volumes = this.stages.map((s) => stageVolume(s));
    const totalVolume = volumes.reduce((a, b) => a + b, 0);
    // Stack radius from a 10:1 fineness ratio: V/(πr²) + nose ≈ 10·2r.
    this.stackRadiusM = Math.max(
      0.5,
      Math.cbrt(totalVolume / (Math.PI * (20 - 2.4))) || 5,
    );
    this.stackLengthM = Math.max(
      5,
      totalVolume / (Math.PI * this.stackRadiusM * this.stackRadiusM),
    );

    this.buildNodes(volumes);

    // Seed the frequency readouts so a snapshot taken before the first step is
    // already meaningful (the UI shows pogo/bending on the pad).
    const first = this.stages[0];
    if (first) {
      this.lastPogoHz = naturalFrequencyHz(
        pogoEffectiveMassKg(first.propellantMassKg),
        pogoStiffnessNm(first.thrustN),
      );
      const wetMass =
        this.totalDryMass() + this.stages.reduce((m, s) => m + s.propellantMassKg, 0);
      this.lastBendingHz = firstBendingHz(
        this.stackLengthM,
        2.5e12 * Math.pow(this.stackRadiusM / 5, 4),
        wetMass / Math.max(5, this.stackLengthM),
      );
    }
  }

  private buildNodes(volumes: number[]): void {
    const r = this.stackRadiusM;
    const nodes: ThermalNode[] = [];

    this.stages.forEach((stage, i) => {
      const lengthM = Math.max(1, volumes[i] / (Math.PI * r * r));
      const tankArea = 2 * Math.PI * r * lengthM;
      this.stageTankAreaM2[i] = tankArea;
      const propTemp = PROPELLANT_TEMP_K[stage.propellantId] ?? 293;

      const tank: ThermalNode = {
        id: `stage${i}_tank`,
        label: tankLabel(i),
        kind: 'tank',
        massKg: Math.max(50, 0.25 * stage.dryMassKg),
        areaM2: tankArea,
        solarAreaM2: tankArea * 0.5,
        cpJKgK: 900,
        emissivity: MLI_EMISSIVITY,
        absorptivity: MLI_ABSORPTIVITY,
        tempK: Math.min(320, Math.max(propTemp + 40, 280)),
        maxTempK: 350,
        minTempK: Math.max(20, propTemp - 10),
        internalW: 0,
      };
      nodes.push(tank);
      this.stageOfNode.set(tank.id, i);

      const count = engineCount(stage);
      const chamber: ThermalNode = {
        id: `stage${i}_chamber`,
        label: chamberLabel(i),
        kind: 'chamber',
        massKg: Math.max(120, 0.02 * stage.dryMassKg),
        areaM2: 1.2 * count,
        solarAreaM2: 0.6 * count,
        cpJKgK: 500,
        emissivity: 0.35,
        absorptivity: 0.5,
        tempK: 300,
        maxTempK: 1000,
        minTempK: 150,
        internalW: 0,
      };
      nodes.push(chamber);
      this.stageOfNode.set(chamber.id, i);

      const nozzle: ThermalNode = {
        id: `stage${i}_nozzle`,
        label: nozzleLabel(i),
        kind: 'nozzle',
        massKg: Math.max(80, 0.012 * stage.dryMassKg),
        areaM2: 2.5 * count,
        solarAreaM2: 1.0 * count,
        cpJKgK: 500,
        emissivity: 0.7,
        absorptivity: 0.6,
        tempK: 300,
        maxTempK: 1500,
        minTempK: 120,
        internalW: 0,
      };
      nodes.push(nozzle);
      this.stageOfNode.set(nozzle.id, i);
    });

    const tpsLimits = tpsLimit('carbon_ablator');
    const shieldArea = Math.PI * r * r;
    nodes.push({
      id: 'tps',
      label: '热防护',
      kind: 'tps',
      massKg: Math.max(200, 0.02 * this.totalDryMass()),
      areaM2: shieldArea,
      solarAreaM2: shieldArea,
      cpJKgK: 1000,
      emissivity: 0.85,
      absorptivity: 0.85,
      tempK: 300,
      maxTempK: tpsLimits.maxTempK,
      minTempK: 100,
      internalW: 0,
      ablationTempK: 3200,
      ablationHeatJKg: 3.0e7,
    });

    nodes.push({
      id: 'avionics',
      label: '电子舱',
      kind: 'avionics',
      massKg: 60,
      areaM2: 1.5,
      solarAreaM2: 0.5,
      cpJKgK: 900,
      emissivity: 0.9,
      absorptivity: 0.4,
      tempK: 293,
      maxTempK: 340,
      minTempK: 250,
      internalW: 500,
    });

    nodes.push({
      id: 'cabin',
      label: '乘员舱',
      kind: 'cabin',
      massKg: 2500,
      areaM2: 30,
      solarAreaM2: 10,
      cpJKgK: 1000,
      emissivity: 0.9,
      absorptivity: 0.4,
      tempK: 293,
      maxTempK: 300,
      minTempK: 280,
      // Crew + systems heat: balances radiation at ≈288 K, the cabin set point.
      internalW: 10_000,
    });

    this.nodes = nodes;
    this.previousChamberK = this.stages.map(() => 300);
  }

  private totalDryMass(): number {
    return this.stages.reduce((m, s) => m + s.dryMassKg, 0) + this.payloadKg;
  }

  private node(id: string): ThermalNode {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`unknown component node: ${id}`);
    return n;
  }

  /** Advance every component by `dtSec` under the current flight state. */
  step(state: SystemsFlightState, dtSec: number): void {
    const dt = Math.max(0, dtSec);
    if (dt === 0) return;

    const ambientK = ambientTemperatureK(state.altitudeKm);
    const hConv = ambientConvection(state.speedMs, state.altitudeKm);
    const solar = state.inSunlight ? SOLAR_CONSTANT_WM2 : 0;
    const rho = density(state.altitudeKm * 1000);

    // Engine heat: quasi-steady wall temperature while the engine runs. The
    // wall's own time constant is seconds, below the mission tick, so this is
    // the steady solution rather than a bypass of the physics.
    if (state.powered && state.stageIndex >= 0 && state.stageIndex < this.stages.length) {
      const stage = this.stages[state.stageIndex];
      const engine = computeEngine({
        propellantId: stage.propellantId,
        ofRatio: stage.ofRatio,
        pcMPa: stage.pcMPa,
        expansionRatio: stage.expansionRatio,
      });
      const engines = engineCount(stage);
      const mdot = engine.ispVac > 0 ? state.thrustN / (engine.ispVac * 9.80665) : 0;
      const gasH = engineGasSideH({
        pcMPa: stage.pcMPa,
        throatDiameterM: 0.2,
        cstar: engine.cstar,
        gamma: 1.2,
      });
      const coolH = coolantSideH(mdot / Math.max(1, engines));
      // The chamber coolant is the fuel side: RP-1 enters near 300 K, cryogens
      // near their storage temperature. LOX is the oxidiser, not the coolant.
      const coolant =
        stage.propellantId === 'LOX_RP1'
          ? 300
          : PROPELLANT_TEMP_K[stage.propellantId] ?? 293;
      const wall = regenerativeWall({
        // Turbulent boundary layer: adiabatic wall ≈ 0.9 × chamber temperature.
        tAdiabaticK: 0.9 * engine.tcK,
        tCoolantK: Math.min(coolant, 300),
        gasHWm2K: gasH,
        linerThicknessM: LINER_THICKNESS_M,
        linerKWmK: LINER_K_WMK,
        coolantHWm2K: coolH,
      });

      const chamber = this.node(`stage${state.stageIndex}_chamber`);
      chamber.tempK = wall.wallHotK;
      this.previousChamberK[state.stageIndex] = wall.wallHotK;

      // Radiation-cooled nozzle extension: flux falls with area ratio; the
      // exponent 2 is the engineering fit that puts a 16:1 nozzle near 1.2 kK.
      const qExit = wall.heatFluxWm2 / Math.pow(Math.max(1, stage.expansionRatio), 2);
      const nozzle = this.node(`stage${state.stageIndex}_nozzle`);
      nozzle.tempK = radiativeEquilibriumTemp(qExit, nozzle.emissivity, SPACE_SINK_K);
    }

    // Entry heating on the shield.
    const entryFlux =
      rho > 1e-9 && state.speedMs > 0
        ? suttonGravesHeatFlux(rho, state.speedMs, 1.0)
        : 0;
    const shield = this.node('tps');

    for (const node of this.nodes) {
      const isActiveChamber =
        state.powered &&
        node.kind === 'chamber' &&
        this.stageOfNode.get(node.id) === state.stageIndex;
      const isActiveNozzle =
        state.powered &&
        node.kind === 'nozzle' &&
        this.stageOfNode.get(node.id) === state.stageIndex;
      if (isActiveChamber || isActiveNozzle) continue; // quasi-steady above

      let imposed = 0;
      if (node.kind === 'tps') imposed = entryFlux * node.areaM2;

      const result = stepThermalNode(
        node,
        {
          solarWm2: solar,
          sinkK: SPACE_SINK_K,
          ambientK,
          convectionWm2K: hConv,
          imposedHeatW: imposed,
        },
        dt,
      );
      node.tempK = result.tempK;
      if (node.kind === 'tps') this.tpsMassLossKg += result.massLossKg;
    }

    this.stepBoiloff(state, dt, ambientK);
    this.stepVibration(state, dt);
    this.lastSnapshot = this.snapshotFromState(state, entryFlux);
  }

  private stepBoiloff(state: SystemsFlightState, dt: number, ambientK: number): void {
    this.stages.forEach((stage, i) => {
      const latent = LATENT_HEAT_JKG[stage.propellantId];
      const propTemp = PROPELLANT_TEMP_K[stage.propellantId];
      if (!latent || propTemp === undefined || propTemp >= 250) return;
      // The warm side is the structure/insulation, not the 3 K sky.
      const warmSide = Math.max(250, ambientK);
      const leak = INSULATION_U * this.stageTankAreaM2[i] * Math.max(0, warmSide - propTemp);
      this.boiloffKg += boiloffRateKgS(leak, latent) * dt;
    });
    void state;
  }

  private stepVibration(state: SystemsFlightState, dt: number): void {
    const stageIdx = state.stageIndex >= 0 ? state.stageIndex : 0;
    const stage = this.stages[stageIdx];
    if (!stage) return;

    if (state.powered) {
      const mEff = pogoEffectiveMassKg(stage.propellantMassKg);
      const stiffness = pogoStiffnessNm(stage.thrustN);
      const fn = naturalFrequencyHz(mEff, stiffness);
      const ofOpt = PROPELLANTS[stage.propellantId]?.ofTypical ?? stage.ofRatio;
      const ofDev = Math.abs(Math.log(Math.max(1e-6, stage.ofRatio) / ofOpt));
      const qRatio = Math.min(1, Math.max(0, state.dynamicPressurePa) / 30_000);
      const base = stage.isSolid ? 0.025 : 0.01;
      const ripple = base * (1 + 0.5 * qRatio) * (1 + 1.5 * ofDev);
      const pogo = pogoResponse({
        thrustN: state.thrustN,
        vehicleMassKg: state.massKg,
        pumpOscillationFrac: ripple,
        excitationHz: fn,
        naturalHz: fn,
        qFactor: stage.isSolid ? 15 : 20,
      });
      this.lastPogoG = pogo.structuralAccelG;
      this.lastPogoHz = fn;
    } else {
      this.lastPogoG = 0;
      this.lastPogoHz = naturalFrequencyHz(
        pogoEffectiveMassKg(stage.propellantMassKg),
        pogoStiffnessNm(stage.thrustN),
      );
    }

    const massPerLength = state.massKg / Math.max(5, this.stackLengthM);
    const ei = 2.5e12 * Math.pow(this.stackRadiusM / 5, 4);
    this.lastBendingHz = firstBendingHz(this.stackLengthM, ei, massPerLength);

    const psd = RANDOM_PSD_BY_PHASE[state.phase.toLowerCase()] ?? DEFAULT_RANDOM_PSD;
    this.lastGrms = randomVibrationGrms(psd, AVIONICS_MODE_HZ, AVIONICS_Q);
    this.fatigueDamage += minerDamageIncrement(this.lastGrms, AVIONICS_MODE_HZ, dt);
  }

  private snapshotFromState(state: SystemsFlightState, entryFlux: number): SystemsSnapshot {
    const readings = this.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      tempK: n.tempK,
      maxTempK: n.maxTempK,
      utilisation: n.maxTempK > 0 ? n.tempK / n.maxTempK : 0,
    }));
    const worst = readings.reduce<ComponentReading | null>(
      (best, r) => (best === null || r.utilisation > best.utilisation ? r : best),
      null,
    );

    const failures: SystemsFailure[] = [];
    const add = (node: string, mode: string, prob: number, detail: string): void => {
      if (prob > 0.005) failures.push({ node, mode, prob, detail });
    };

    for (const n of this.nodes) {
      if (n.kind === 'tps') continue;
      const scale = 0.1 * n.maxTempK;
      add(
        `thermal:${n.id}`,
        'overtemp',
        overLimitProbability(n.tempK, n.maxTempK, scale),
        `${n.label} ${n.tempK.toFixed(0)} K > ${n.maxTempK.toFixed(0)} K`,
      );
      if (n.minTempK > 0) {
        add(
          `thermal:${n.id}`,
          'undertemp',
          overLimitProbability(n.minTempK - n.tempK, 0, 0.05 * n.minTempK),
          `${n.label} ${n.tempK.toFixed(0)} K < ${n.minTempK.toFixed(0)} K`,
        );
      }
    }

    const tps = this.node('tps');
    add(
      'tps_flux',
      'heat_flux',
      overLimitProbability(entryFlux / 1e6, 5, 1),
      `热防护 ${(entryFlux / 1e6).toFixed(2)} MW/m² > 5 MW/m²`,
    );
    add(
      'thermal:tps',
      'burn_through',
      overLimitProbability(tps.tempK, tps.maxTempK, 150),
      `热防护 ${tps.tempK.toFixed(0)} K > ${tps.maxTempK.toFixed(0)} K`,
    );
    add(
      'pogo',
      'crew_acceleration',
      overLimitProbability(this.lastPogoG, CREW_POGO_LIMIT_G, 0.15),
      `pogo ${this.lastPogoG.toFixed(2)} g > ${CREW_POGO_LIMIT_G} g`,
    );
    add(
      'random_vibration',
      'avionics',
      overLimitProbability(this.lastGrms, 12, 3),
      `随机振动 ${this.lastGrms.toFixed(1)} g_rms > 12 g_rms`,
    );
    add(
      'fatigue',
      'structure',
      overLimitProbability(this.fatigueDamage, 1, 0.2),
      `Miner 损伤 ${this.fatigueDamage.toFixed(3)} > 1`,
    );

    const propTotal = this.stages.reduce((m, s) => m + s.propellantMassKg, 0);
    return {
      components: readings,
      engineWallK: this.chamberTemps()[0] ?? null,
      nozzleK: this.nozzleTemps()[0] ?? null,
      tankK: readings.find((r) => r.kind === 'tank')?.tempK ?? null,
      tpsK: tps.tempK,
      avionicsK: this.node('avionics').tempK,
      cabinK: this.node('cabin').tempK,
      pogoG: this.lastPogoG,
      pogoHz: this.lastPogoHz,
      bendingHz: this.lastBendingHz,
      randomGrms: this.lastGrms,
      fatigueDamage: this.fatigueDamage,
      boiloffKg: this.boiloffKg,
      boiloffPct: propTotal > 0 ? (100 * this.boiloffKg) / propTotal : 0,
      failures,
      worst,
    };
  }

  private chamberTemps(): number[] {
    return this.stages.map((_, i) => this.node(`stage${i}_chamber`).tempK);
  }

  private nozzleTemps(): number[] {
    return this.stages.map((_, i) => this.node(`stage${i}_nozzle`).tempK);
  }

  /** Latest snapshot; a zero state before the first step. */
  snapshot(): SystemsSnapshot {
    if (this.lastSnapshot) return this.lastSnapshot;
    this.lastSnapshot = this.snapshotFromState(
      {
        phase: 'PAD',
        altitudeKm: 0,
        speedMs: 0,
        massKg: this.totalDryMass() + this.stages.reduce((m, s) => m + s.propellantMassKg, 0),
        thrustN: 0,
        powered: false,
        stageIndex: -1,
        dynamicPressurePa: 0,
        inSunlight: true,
      },
      0,
    );
    return this.lastSnapshot;
  }
}
