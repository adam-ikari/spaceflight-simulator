/**
 * LunarDirector —观赏用载人登月推演。动力段采用与 LEO 一致的运动学积分，
 * 地月滑行段保留 RK4 两体引力；燃烧、Isp、阻力与结构响应仍来自物理模块。
 */
import { CONST } from '../physics/constants';
import { dragForceN } from '../physics/Aerodynamics';
import { ComponentSystems, type SystemsSnapshot } from '../physics/ComponentSystems';
import { computeEngine } from '../physics/PropulsionEngine';
import type { StageSpec } from '../physics/RocketEquation';
import {
  pogoResponse,
  pogoEffectiveMassKg,
  pogoStiffnessNm,
  naturalFrequencyHz,
  randomVibrationGrms,
} from '../physics/StructuralDynamics';
import { simulateAscent, type AscentResult } from '../physics/AscentDynamics';
import {
  moonPositionAt,
  moonRelative,
  moonVelocityAt,
  solveEarthMoonTransfer,
  stepLunarRK4,
  type TransferSolution,
} from '../physics/LunarDynamics';
import { thrustFromIsp } from '../physics/LunarGuidance';
import { FlightComputer, type FlightCommand, type ProgramStatus } from '../physics/FlightComputer';
import { computeConsumables, stepLifeSupport, type LifeSupportState } from '../physics/LifeSupport';
import { accumulate, gcrDoseRateMsvPerDay } from '../physics/Radiation';
import { computePLOC } from '../physics/RiskModel';
import { computeCost } from '../physics/CostModel';
import type { OrbitState, Vec3 } from '../physics/OrbitalIntegrator';
import { computeVehicleGeometry, type VehicleGeometry } from '../render/vehicleGeometry';
import type { MissionDirector, MissionTelemetry, Body } from './MissionDirector';

type Phase =
  | 'PAD' | 'LIFTOFF' | 'ASCENT' | 'PARK' | 'TLI' | 'TRANSFER'
  | 'LOI' | 'LUNAR_ORBIT' | 'DESCENT' | 'MOON_LANDING'
  | 'LUNAR_LAUNCH' | 'RENDEZVOUS' | 'TEI' | 'EARTH_RETURN'
  | 'EARTH_ENTRY' | 'LANDING' | 'DONE';

export const LUNAR_PHASES: Phase[] = [
  'PAD', 'LIFTOFF', 'ASCENT', 'PARK', 'TLI', 'TRANSFER', 'LOI', 'LUNAR_ORBIT',
  'DESCENT', 'MOON_LANDING', 'LUNAR_LAUNCH', 'RENDEZVOUS', 'TEI',
  'EARTH_RETURN', 'EARTH_ENTRY', 'LANDING', 'DONE',
];

const PAD_DWELL_S = 2;
const PARK_DWELL_S = 2;
const ORBIT_DWELL_S = 3;
const SURFACE_DWELL_S = 3;
const RENDEZVOUS_DWELL_S = 3;
const TEI_DWELL_S = 3;
const RETURN_DWELL_S = 3;
const LANDING_DWELL_S = 3;

const ASCENT_DV_MS = 9400;
const ASCENT_ACCEL_MS2 = 18;
const PITCHOVER_KM = 190;
const LAUNCH_THRUST_N = 3.5e7;
const SIVB_THRUST_N = 1e6;
const SIVB_ISP_S = 450;
const INITIAL_MASS_KG = 2.9e6;
const MOON_ORBIT_ALT_KM = 100;
const EARTH_ENTRY_ALT_KM = 120;
const ENTRY_TARGET_M = 3000;
const TLI_ACCEL_MS2 = 8;

const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function circularVelocity(mu: number, radiusM: number): number {
  return Math.sqrt(mu / Math.max(radiusM, 1));
}

export class LunarDirector implements MissionDirector {
  private p: Phase = 'PAD';
  private s: OrbitState = { pos: [CONST.R_EARTH, 0, 0], vel: [0, 0, 0], t: 0 };
  private body: Body = 'EARTH';
  private massKg = INITIAL_MASS_KG;
  private missionTime = 0;
  private wallDwell = 0;
  /** Absolute TLI-relative epoch; `s.t` resets at frame changes but this does not. */
  private epochSec = 0;
  private burnDv = 0;
  private ascentDvRemaining = ASCENT_DV_MS;
  private transfer: TransferSolution | null = null;
  private stopped = false;
  private systems: ComponentSystems | null = null;
  private systemsSnapshot: SystemsSnapshot | null = null;
  private stages: StageSpec[] = [];
  private payloadKg = 0;
  private geometry: VehicleGeometry | null = null;
  private ascentPlan: AscentResult | null = null;
  private ispLaunchS = 300;
  private ispUpperS = SIVB_ISP_S;
  private pogoG = 0;
  private vibrationGrms = 0;
  private dragN = 0;
  private computer = new FlightComputer();
  private command: FlightCommand | null = null;
  private programs: ProgramStatus[] = [];
  private lifeState: LifeSupportState;
  private radiationMsv = 0;
  private costUsd = 0;
  private ploc = 0.006;
  private escapeSystem: 'tower' | 'propulsive' | 'none' = 'tower';
  private hasSolidBooster = false;

  constructor() {
    const consumables = computeConsumables({ crew: 3, durationDays: 12 });
    this.lifeState = {
      o2RemainKg: consumables.o2Kg,
      waterRemainKg: consumables.waterKg,
      co2Pct: 0,
      metabolicHeatW: 300,
      failures: [],
    };
  }

  get phase(): string {
    return this.p;
  }

  get finished(): boolean {
    return this.stopped;
  }

  /** Reset the phase-local clock while preserving the absolute moon ephemeris. */
  private resetClock(): void {
    this.epochSec += this.s.t;
    this.s.t = 0;
  }

  private absoluteMoonPositionM(): [number, number, number] {
    return moonPositionAt(this.epochSec + this.s.t);
  }

  /** Renderer-facing geocentric position, even while the physics state is moon-relative. */
  positionKm(): [number, number, number] {
    const moon = this.body === 'MOON' ? this.absoluteMoonPositionM() : [0, 0, 0];
    return [
      (this.s.pos[0] + moon[0]) / 1000,
      (this.s.pos[1] + moon[1]) / 1000,
      (this.s.pos[2] + moon[2]) / 1000,
    ];
  }

  moonPositionKm(): [number, number, number] {
    const moon = this.absoluteMoonPositionM();
    return [moon[0] / 1000, moon[1] / 1000, moon[2] / 1000];
  }

  setVehicle(
    escapeSystem: 'tower' | 'propulsive' | 'none',
    hasSolidBooster: boolean,
    stages?: StageSpec[],
    payloadKg = 0,
  ): void {
    if (!stages) return;
    this.escapeSystem = escapeSystem;
    this.hasSolidBooster = hasSolidBooster;
    this.stages = stages.map((s) => ({ ...s }));
    this.payloadKg = payloadKg;
    this.systems = new ComponentSystems(this.stages, payloadKg, hasSolidBooster);
    this.systemsSnapshot = this.systems.snapshot();
    this.geometry = computeVehicleGeometry(this.stages, hasSolidBooster);
    this.ascentPlan = simulateAscent(this.stages, payloadKg);
    this.ispLaunchS = this.engineIsp(this.stages[0], 300);
    this.ispUpperS = this.engineIsp(this.stages[1] ?? this.stages[0], SIVB_ISP_S);
    void escapeSystem;
  }

  private engineIsp(stage: StageSpec | undefined, fallback: number): number {
    if (!stage) return fallback;
    try {
      return computeEngine({
        propellantId: stage.propellantId,
        ofRatio: stage.ofRatio,
        pcMPa: stage.pcMPa,
        expansionRatio: stage.expansionRatio,
        paMPa: 0,
      }).ispVac;
    } catch {
      return fallback;
    }
  }

  telemetry(): MissionTelemetry {
    const radius = norm(this.s.pos);
    const altitudeKm = Math.max(0, radius - (this.body === 'MOON' ? CONST.R_MOON : CONST.R_EARTH)) / 1000;
    return {
      phase: this.p,
      t: this.missionTime,
      altitudeKm,
      speedMs: norm(this.s.vel),
      dvRemainingMs: Math.max(0, this.ascentDvRemaining),
      ploc: this.ploc,
      costUsd: this.costUsd,
      fuelPct: Math.max(0, (this.massKg / INITIAL_MASS_KG) * 100),
      systems: this.systemsSnapshot,
      computer: this.programs,
      life: this.lifeState,
      radiationMsv: this.radiationMsv,
      body: this.body,
      ispS: this.p === 'TLI' || this.p === 'LOI' || this.p === 'TEI' ? this.ispUpperS : this.ispLaunchS,
      dragN: this.dragN,
      pogoG: this.pogoG,
      vibrationGrms: this.vibrationGrms,
      ascentLossMs: this.ascentPlan
        ? this.ascentPlan.gravityLossMs + this.ascentPlan.dragLossMs
        : undefined,
    };
  }

  step(dtSec: number, wallSec = 0): void {
    if (this.stopped) return;
    const dt = Math.max(0, Math.min(dtSec, 10));
    const wall = Math.max(0, wallSec);
    this.missionTime += dt;
    this.wallDwell += wall;
    this.stepContinuous(dt);

    switch (this.p) {
      case 'PAD':
        if (this.wallDwell >= PAD_DWELL_S) this.go('LIFTOFF');
        break;
      case 'LIFTOFF':
      case 'ASCENT':
        this.earthAscent(dt);
        break;
      case 'PARK':
        if (this.wallDwell >= PARK_DWELL_S) this.startTli();
        break;
      case 'TLI':
        this.transLunarInjection(dt);
        break;
      case 'TRANSFER':
        this.coastToMoon(dt);
        break;
      case 'LOI':
        this.lunarOrbitInsertion(dt);
        break;
      case 'LUNAR_ORBIT':
        if (this.wallDwell >= ORBIT_DWELL_S) this.go('DESCENT');
        break;
      case 'DESCENT':
        this.poweredDescent(dt);
        break;
      case 'MOON_LANDING':
        if (this.wallDwell >= SURFACE_DWELL_S) this.go('LUNAR_LAUNCH');
        break;
      case 'LUNAR_LAUNCH':
        this.poweredAscent(dt);
        break;
      case 'RENDEZVOUS':
        if (this.wallDwell >= RENDEZVOUS_DWELL_S) this.go('TEI');
        break;
      case 'TEI':
        if (this.wallDwell >= TEI_DWELL_S) this.startReturn();
        break;
      case 'EARTH_RETURN':
        if (this.wallDwell >= RETURN_DWELL_S) this.go('EARTH_ENTRY');
        break;
      case 'EARTH_ENTRY':
        this.entry(dt);
        break;
      case 'LANDING':
        if (this.wallDwell >= LANDING_DWELL_S) this.go('DONE');
        break;
      case 'DONE':
        this.stopped = true;
        break;
    }
  }

  private go(next: Phase): void {
    this.p = next;
    this.wallDwell = 0;
    this.burnDv = 0;
  }

  private radial(): { r: number; dir: Vec3; tan: Vec3 } {
    const r = Math.max(norm(this.s.pos), 1);
    const dir: Vec3 = [this.s.pos[0] / r, this.s.pos[1] / r, this.s.pos[2] / r];
    return { r, dir, tan: [-dir[1], dir[0], 0] };
  }

  private mu(): number {
    return this.body === 'MOON' ? CONST.MU_MOON : CONST.MU_EARTH;
  }

  /** Every domain advances once per physics step, whatever the mission phase. */
  private stepContinuous(dt: number): void {
    const { r, dir, tan } = this.radial();
    const speed = norm(this.s.vel);
    const radialV = this.s.vel[0] * dir[0] + this.s.vel[1] * dir[1] + this.s.vel[2] * dir[2];
    const tangentialV = this.s.vel[0] * tan[0] + this.s.vel[1] * tan[1];
    const altitudeM = Math.max(0, r - (this.body === 'MOON' ? CONST.R_MOON : CONST.R_EARTH));
    const lunar = this.body === 'MOON';
    const targetAltitudeM = lunar ? MOON_ORBIT_ALT_KM * 1000 : 200e3;
    const targetSpeedMs = this.p === 'DESCENT' || this.p === 'LANDING'
      ? 0
      : circularVelocity(this.mu(), Math.max(r, (lunar ? CONST.R_MOON : CONST.R_EARTH) + targetAltitudeM));
    const faults = this.systemsSnapshot?.failures.map((f) => f.node) ?? [];

    this.command = this.computer.step(dt, {
      phase: this.p,
      body: this.body,
      timeSec: this.missionTime,
      altitudeM,
      speedMs: speed,
      radialSpeedMs: radialV,
      tangentialSpeedMs: tangentialV,
      targetAltitudeM,
      targetSpeedMs,
      dvRemainingMs: this.ascentDvRemaining,
      massKg: this.massKg,
      faults,
    });
    this.programs = this.command.programs;

    this.lifeState = stepLifeSupport(this.lifeState, 3, dt);
    const shielding = lunar ? 0.35 : altitudeM < 100e3 ? 1 : 0.6;
    const doseRate = gcrDoseRateMsvPerDay(shielding) / 86400;
    this.radiationMsv = accumulate(this.radiationMsv, doseRate * dt);

    if (this.systems) {
      const powered = this.command.throttle > 0.01;
      this.systems.step({
        phase: this.p,
        altitudeKm: altitudeM / 1000,
        speedMs: speed,
        massKg: Math.max(this.massKg, 1),
        thrustN: powered ? (lunar ? 45e3 : LAUNCH_THRUST_N) * this.command.throttle : 0,
        powered,
        stageIndex: powered ? this.command.stageIndex : -1,
        dynamicPressurePa: altitudeM < 120e3 ? this.dragN : 0,
        inSunlight: true,
      }, dt);
      this.systemsSnapshot = this.systems.snapshot();
    }

    const branches = this.systemsSnapshot?.failures.map((f) => ({ node: f.node, prob: f.prob })) ?? [];
    this.ploc = computePLOC({
      solidBoosterLit: this.hasSolidBooster && this.p === 'LIFTOFF',
      mach: speed / 340,
      dynamicPressurePa: this.dragN,
      escapeSystem: this.escapeSystem,
      phase: this.p.toLowerCase(),
      crewed: true,
      componentBranches: branches,
    }).ploc;

    if (this.stages.length) {
      const dryMass = this.stages.map((s) => s.dryMassKg);
      const propMass = this.stages.map((s) => s.propellantMassKg);
      const cost = computeCost({
        stagesDryMassKg: dryMass,
        propellantMassKg: propMass,
        propellantCostPerKg: { LOX_RP1: 1, LOX_CH4: 2, LOX_LH2: 4, NTO_MMH: 12 },
        reuseCount: 1,
        devBudget: 0,
        plannedLaunches: 1,
        ploc: this.ploc,
        payloadValue: this.payloadKg * 1000,
      });
      this.costUsd = cost.total;
    }
  }

  private consume(dt: number, thrustN: number, ispSec: number): void {
    if (this.massKg <= 0 || dt <= 0) return;
    const result = thrustFromIsp(thrustN, ispSec, this.massKg, dt);
    this.massKg = Math.max(result.massKg, INITIAL_MASS_KG * 0.02);
    this.burnDv += Number.isFinite(result.dvMs) ? result.dvMs : 0;
  }

  /** Semi-implicit powered integration; gravity and drag live in the acceleration. */
  private powered(dt: number, thrustAccel: Vec3, thrustN: number, ispSec: number): void {
    const { r, dir } = this.radial();
    const g = this.mu() / (r * r);
    const accel: Vec3 = [
      thrustAccel[0] - dir[0] * g,
      thrustAccel[1] - dir[1] * g,
      thrustAccel[2] - dir[2] * g,
    ];
    if (this.body === 'EARTH' && this.geometry && r - CONST.R_EARTH < 120e3) {
      this.dragN = dragForceN(this.geometry, norm(this.s.vel), (r - CONST.R_EARTH) / 1000);
      const speed = norm(this.s.vel);
      if (speed > 0) {
        const aDrag = this.dragN / Math.max(this.massKg, 1);
        for (let i = 0; i < 3; i++) accel[i] -= (this.s.vel[i] / speed) * aDrag;
      }
    } else {
      this.dragN = 0;
    }
    for (let i = 0; i < 3; i++) {
      this.s.vel[i] += accel[i] * dt;
      this.s.pos[i] += this.s.vel[i] * dt;
    }
    this.consume(dt, thrustN, ispSec);
    if (this.body === 'EARTH' && this.p !== 'PARK') {
      const naturalHz = naturalFrequencyHz(
        pogoEffectiveMassKg(this.massKg),
        pogoStiffnessNm(thrustN),
      );
      const pogo = pogoResponse({
        thrustN,
        vehicleMassKg: this.massKg,
        pumpOscillationFrac: 0.025,
        excitationHz: naturalHz,
        naturalHz,
        qFactor: 20,
      });
      this.pogoG = pogo.structuralAccelG;
      this.vibrationGrms = randomVibrationGrms(0.04, naturalHz, 10);
    }
  }

  private earthAscent(dt: number): void {
    const { r, dir, tan } = this.radial();
    const altKm = (r - CONST.R_EARTH) / 1000;
    const throttle = this.command?.throttle ?? 1;
    const pitch = this.command?.pitchRad ?? 0;
    const dv = Math.min(this.ascentDvRemaining, ASCENT_ACCEL_MS2 * throttle * dt);
    this.ascentDvRemaining = Math.max(0, this.ascentDvRemaining - dv);
    const a = ASCENT_ACCEL_MS2 * throttle;
    this.powered(dt, [
      dir[0] * a * Math.cos(pitch) + tan[0] * a * Math.sin(pitch),
      dir[1] * a * Math.cos(pitch) + tan[1] * a * Math.sin(pitch),
      0,
    ], LAUNCH_THRUST_N, this.ispLaunchS);
    if (this.p === 'LIFTOFF' && altKm >= 3) this.go('ASCENT');
    if (altKm >= PITCHOVER_KM && this.ascentDvRemaining <= 60) {
      const vc = circularVelocity(CONST.MU_EARTH, norm(this.s.pos));
      this.s.vel = [tan[0] * vc, tan[1] * vc, 0];
      this.go('PARK');
    }
  }

  private startTli(): void {
    this.transfer = solveEarthMoonTransfer(200);
    this.go('TLI');
  }

  private transLunarInjection(dt: number): void {
    const { tan } = this.radial();
    const throttle = this.command?.throttle ?? 1;
    const a = TLI_ACCEL_MS2 * throttle;
    const dv = Math.min(a * dt, Math.max(0, (this.transfer?.tliDvMs ?? 3133) - this.burnDv));
    this.powered(dt, [tan[0] * a, tan[1] * a, 0], SIVB_THRUST_N, this.ispUpperS);
    if (dv <= 0 || !this.transfer) {
      const r = CONST.R_EARTH + 200e3;
      const vc = circularVelocity(CONST.MU_EARTH, r);
      this.s.pos = [r, 0, 0];
      this.s.vel = [0, vc + (this.transfer?.tliDvMs ?? 3133), 0];
      this.resetClock();
      this.burnDv = 0;
      this.go('TRANSFER');
    }
  }

  private coastToMoon(dt: number): void {
    this.s = stepLunarRK4(this.s, dt, this.epochSec);
    const rel = moonRelative(this.s, this.epochSec + this.s.t);
    if (rel.distM <= CONST.MOON_SOI_M) {
      this.body = 'MOON';
      this.s.pos = [...rel.pos];
      this.s.vel = [...rel.vel];
      this.resetClock();
      this.go('LOI');
    }
    if (this.s.t > (this.transfer?.tofSec ?? 400000) * 3) this.go('EARTH_RETURN');
  }

  private lunarOrbitInsertion(dt: number): void {
    const { r, dir, tan } = this.radial();
    const speed = norm(this.s.vel);
    const vc = circularVelocity(CONST.MU_MOON, r);
    const radialV = this.s.vel[0] * dir[0] + this.s.vel[1] * dir[1] + this.s.vel[2] * dir[2];
    const brake = Math.min(speed - vc, 4 * dt);
    const scale = speed > 0 ? Math.max(0, speed - brake) / speed : 0;
    this.s.vel = [
      this.s.vel[0] * scale - dir[0] * radialV * Math.min(1, 2 * dt),
      this.s.vel[1] * scale - dir[1] * radialV * Math.min(1, 2 * dt),
      0,
    ];
    this.consume(dt, 10e3, this.ispLaunchS);
    void tan;
    if (speed <= vc * 1.05 && Math.abs(radialV) < 200) {
      const rOrbit = CONST.R_MOON + MOON_ORBIT_ALT_KM * 1000;
      const vOrbit = circularVelocity(CONST.MU_MOON, rOrbit);
      this.s.pos = [rOrbit, 0, 0];
      this.s.vel = [0, vOrbit, 0];
      this.go('LUNAR_ORBIT');
    }
  }

  private poweredDescent(dt: number): void {
    const { r, dir, tan } = this.radial();
    const alt = Math.max(0, r - CONST.R_MOON);
    const radialV = this.s.vel[0] * dir[0] + this.s.vel[1] * dir[1];
    const tangentV = this.s.vel[0] * tan[0] + this.s.vel[1] * tan[1];
    const throttle = this.command?.throttle ?? 1;
    const targetVr = -Math.min(80, Math.max(2, alt / 30));
    const dv = Math.max(-2 * dt, Math.min(2 * throttle * dt, targetVr - radialV));
    const tangentDv = Math.min(Math.abs(tangentV), 12 * throttle * dt) * Math.sign(tangentV) * -1;
    this.powered(dt, [
      dir[0] * dv + tan[0] * tangentDv,
      dir[1] * dv + tan[1] * tangentDv,
      0,
    ], 45e3, this.ispLaunchS);
    if (alt <= 1000) {
      this.s.pos = [CONST.R_MOON, 0, 0];
      this.s.vel = [0, 0, 0];
      this.go('MOON_LANDING');
    }
  }

  private poweredAscent(dt: number): void {
    const { r, dir, tan } = this.radial();
    const alt = r - CONST.R_MOON;
    const a = alt < 100e3 ? 12 : 0;
    this.powered(dt, [dir[0] * a + tan[0] * a, dir[1] * a + tan[1] * a, 0], 15e3, this.ispLaunchS);
    if (alt >= MOON_ORBIT_ALT_KM * 1000) {
      const vc = circularVelocity(CONST.MU_MOON, r);
      this.s.vel = [tan[0] * vc, tan[1] * vc, 0];
      this.go('RENDEZVOUS');
    }
  }

  private startReturn(): void {
    const r = CONST.R_EARTH + EARTH_ENTRY_ALT_KM * 1000;
    this.body = 'EARTH';
    this.s.pos = [r, 0, 0];
    this.s.vel = [0, -circularVelocity(CONST.MU_EARTH, r) * 0.72, 0];
    this.resetClock();
    this.go('EARTH_RETURN');
    void moonVelocityAt;
  }

  private entry(dt: number): void {
    const { r, dir } = this.radial();
    const alt = Math.max(0, r - CONST.R_EARTH);
    this.dragN = alt < 120e3 && this.geometry
      ? dragForceN(this.geometry, norm(this.s.vel), alt / 1000)
      : 0;
    const decay = Math.exp(-dt / 20);
    const speed = norm(this.s.vel) * decay;
    const scale = speed / Math.max(norm(this.s.vel), 1);
    this.s.vel = [this.s.vel[0] * scale, this.s.vel[1] * scale, 0];
    this.s.pos = [dir[0] * (CONST.R_EARTH + alt * decay), dir[1] * (CONST.R_EARTH + alt * decay), 0];
    if (alt <= ENTRY_TARGET_M) this.go('LANDING');
  }
}
