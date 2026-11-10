import { CONST } from '../physics/constants';
import {
  type OrbitState,
  type Vec3,
  circularOrbitVelocity,
  stepRK4,
} from '../physics/OrbitalIntegrator';
import { dynamicPressure } from '../physics/Atmosphere';
import { computePLOC } from '../physics/RiskModel';
import { computeCost } from '../physics/CostModel';
import { PHASE_ORDER, type Phase } from './phases';

export interface Telemetry {
  phase: Phase;
  t: number;
  altitudeKm: number;
  speedMs: number;
  dvRemainingMs: number;
  ploc: number;
  costUsd: number;
  fuelPct: number;
}

/** Default launch vehicle for the director's coarse physics. */
const VEHICLE = {
  dryMassKg: 100_000,
  propellantMassKg: 1_000_000,
  propellantCostPerKg: 2,
  reuseCount: 10,
  devBudget: 5e9,
  plannedLaunches: 20,
  payloadValue: 1e8,
};

/** Retro thrust acceleration during the deorbit burn, m/s². */
const RETRO_ACCEL_MS2 = 50;
/** LEO insertion Δv budget, m/s. */
const ASCENT_DV_MS = 9400;
/** Net thrust acceleration during powered flight, m/s². */
const ASCENT_ACCEL_MS2 = 18;
/** Pitch-over completes at this altitude, km. */
const PITCHOVER_KM = 190;
/** Chute-deploy altitude at end of entry, m. */
const ENTRY_TARGET_M = 3_000;

const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

/**
 * Phase director — owns mission phase, coarse flight state and telemetry.
 * Delegates per-phase dynamics to the physics modules; integrations are
 * deliberately lightweight (structure/transitions matter more than fidelity).
 */
export class PhysicsDirector {
  private p: Phase = 'PAD';
  private s: OrbitState = { pos: [CONST.R_EARTH, 0, 0], vel: [0, 0, 0], t: 0 };
  private dvRemainingMs = ASCENT_DV_MS;
  private ploc = 0;
  private costUsd = 0;
  private escapeSystem: 'tower' | 'propulsive' | 'none' = 'tower';
  private hasSolidBooster = false;

  constructor() {
    this.update();
  }

  get phase(): Phase {
    return this.p;
  }

  /** Only PAD (reset/restart), same phase, or the next forward phase allowed. */
  setPhase(p: Phase): void {
    const next = PHASE_ORDER[PHASE_ORDER.indexOf(this.p) + 1];
    if (p !== this.p && p !== 'PAD' && p !== next) {
      throw new Error(`Invalid phase transition ${this.p} → ${p}`);
    }
    this.p = p;
    this.update();
  }

  /** Advance one phase along PHASE_ORDER; no-op at LANDING. */
  advance(): void {
    const next = PHASE_ORDER[PHASE_ORDER.indexOf(this.p) + 1];
    if (next) this.setPhase(next);
  }

  /** Feed the actual vehicle config so computePLOC uses the right escape system. */
  setVehicle(escapeSystem: 'tower' | 'propulsive' | 'none', hasSolidBooster: boolean): void {
    this.escapeSystem = escapeSystem;
    this.hasSolidBooster = hasSolidBooster;
    this.update();
  }

  /** Aggregate one physics step for the current phase. */
  step(dtSec: number): void {
    const dt = Math.max(0, dtSec);
    if (dt === 0) return;
    const t0 = this.s.t;

    switch (this.p) {
      case 'PAD':
        break;
      case 'LIFTOFF':
      case 'ASCENT':
        this.stepPowered(dt);
        break;
      case 'STAGE_SEP':
        this.stepCoast(dt);
        break;
      case 'ORBIT_INSERT':
        this.stepPowered(dt);
        this.circularize();
        break;
      case 'ORBIT':
      case 'RENDEZVOUS':
        this.s = stepRK4(this.s, dt);
        break;
      case 'DEORBIT':
        this.retroBurn(dt);
        break;
      case 'ENTRY':
        this.stepEntry(dt);
        break;
      case 'LANDING':
        this.stepLanding(dt);
        break;
    }
    this.s.t = t0 + dt;
    this.update();
  }

  telemetry(): Telemetry {
    return {
      phase: this.p,
      t: this.s.t,
      altitudeKm: Math.max(0, norm(this.s.pos) - CONST.R_EARTH) / 1000,
      speedMs: norm(this.s.vel),
      dvRemainingMs: this.dvRemainingMs,
      ploc: this.ploc,
      costUsd: this.costUsd,
      fuelPct: (100 * this.dvRemainingMs) / ASCENT_DV_MS,
    };
  }

  /** Current vehicle position in km relative to Earth's centre (scene feed). */
  positionKm(): [number, number, number] {
    return [this.s.pos[0] / 1000, this.s.pos[1] / 1000, this.s.pos[2] / 1000];
  }

  // --- internals ---------------------------------------------------------

  private radial(): { r: number; dir: Vec3; tan: Vec3 } {
    const r = norm(this.s.pos);
    const dir: Vec3 = [this.s.pos[0] / r, this.s.pos[1] / r, this.s.pos[2] / r];
    const tan: Vec3 = [-dir[1], dir[0], 0];
    return { r, dir, tan };
  }

  /** Powered ascent: pitch program from radial toward horizontal, with gravity. */
  private stepPowered(dt: number): void {
    const { r, dir, tan } = this.radial();
    const g = CONST.MU_EARTH / (r * r);
    const altM = Math.max(0, r - CONST.R_EARTH);
    const pitch = Math.min(altM / (PITCHOVER_KM * 1e3), 1) * 80 * (Math.PI / 180);
    const a = ASCENT_ACCEL_MS2;
    const dv = Math.min(this.dvRemainingMs, a * dt);
    this.dvRemainingMs = Math.max(0, this.dvRemainingMs - dv);

    const aRad = a * Math.cos(pitch) - g;
    const aTan = a * Math.sin(pitch);
    for (let i = 0; i < 3; i++) {
      this.s.vel[i] += (dir[i] * aRad + tan[i] * aTan) * dt;
      this.s.pos[i] += this.s.vel[i] * dt;
    }
  }

  /** Unpowered stage-separation coast. */
  private stepCoast(dt: number): void {
    const { r, dir } = this.radial();
    const g = CONST.MU_EARTH / (r * r);
    for (let i = 0; i < 3; i++) {
      this.s.vel[i] -= dir[i] * g * dt;
      this.s.pos[i] += this.s.vel[i] * dt;
    }
  }

  /** Insertion: match circular orbital speed at current radius. */
  private circularize(): void {
    const { r, tan } = this.radial();
    const vc = circularOrbitVelocity(r - CONST.R_EARTH);
    this.s.vel = [tan[0] * vc, tan[1] * vc, tan[2] * vc];
  }

  /** Retrograde burn: shave speed then integrate. */
  private retroBurn(dt: number): void {
    const { tan } = this.radial();
    const dv = Math.min(RETRO_ACCEL_MS2 * dt, this.dvRemainingMs);
    this.dvRemainingMs = Math.max(0, this.dvRemainingMs - dv);
    const speed = norm(this.s.vel);
    const scale = speed > 0 ? Math.max(0, speed - dv) / speed : 0;
    for (let i = 0; i < 3; i++) {
      this.s.vel[i] = this.s.vel[i] * scale - tan[i] * 20 * dt;
    }
    this.s = stepRK4(this.s, dt);
  }

  /** Entry: aerobraking drag decay down to chute-deploy altitude. */
  private stepEntry(dt: number): void {
    const decay = Math.exp(-dt / 15);
    for (let i = 0; i < 3; i++) this.s.vel[i] *= decay;
    const { r, dir } = this.radial();
    const move = Math.max(0, r - (CONST.R_EARTH + ENTRY_TARGET_M)) * (dt / 20);
    if (move > 0) for (let i = 0; i < 3; i++) this.s.pos[i] -= dir[i] * move;
  }

  /** Landing: kill residual velocity, settle on the surface. */
  private stepLanding(dt: number): void {
    const decay = Math.exp(-dt / 3);
    for (let i = 0; i < 3; i++) this.s.vel[i] *= decay;
    const { r, dir } = this.radial();
    const target = CONST.R_EARTH + 50; // 50 m pad
    const move = Math.min((r - target) * dt, 100);
    for (let i = 0; i < 3; i++) this.s.pos[i] -= dir[i] * Math.max(0, move);
    this.clampToSurface();
  }

  private clampToSurface(): void {
    const r = norm(this.s.pos);
    const minR = CONST.R_EARTH;
    if (r < minR) {
      const k = minR / r;
      this.s.pos = [this.s.pos[0] * k, this.s.pos[1] * k, this.s.pos[2] * k];
      this.s.vel = [0, 0, 0];
    }
  }

  /** Recompute risk and cost from current state. */
  private update(): void {
    const { r } = this.radial();
    const altM = Math.max(0, r - CONST.R_EARTH);
    const speed = norm(this.s.vel);
    const phaseKey = this.p.toLowerCase();

    const { ploc } = computePLOC({
      solidBoosterLit:
        this.hasSolidBooster &&
        (this.p === 'LIFTOFF' || this.p === 'ASCENT' || this.p === 'STAGE_SEP'),
      mach: speed / 343,
      dynamicPressurePa: dynamicPressure(speed, altM),
      escapeSystem: this.escapeSystem,
      phase: phaseKey,
      crewed: true,
    });
    this.ploc = ploc;

    this.costUsd = computeCost({
      stagesDryMassKg: [VEHICLE.dryMassKg],
      propellantMassKg: [VEHICLE.propellantMassKg * (1 - this.dvRemainingMs / ASCENT_DV_MS)],
      propellantCostPerKg: { generic: VEHICLE.propellantCostPerKg },
      reuseCount: VEHICLE.reuseCount,
      devBudget: VEHICLE.devBudget,
      plannedLaunches: VEHICLE.plannedLaunches,
      ploc,
      payloadValue: VEHICLE.payloadValue,
    }).total;
  }
}
