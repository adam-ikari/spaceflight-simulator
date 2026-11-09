/**
 * Powered-ascent rigid body (cannon-es) driven alongside PhysicsDirector.
 *
 * The rigid body owns LIFTOFF → ORBIT_INSERT: thrust along the pitch program,
 * propellant mass depletion, stage separation mass drops, and scene/trajectory
 * updates. Once the stack reaches the ~100 km cutoff the body is parked and the
 * director's RK4 integrator owns the orbit — no duplicate orbital integration.
 */
import * as CANNON from 'cannon-es';
import { CONST } from '../physics/constants';
import { type StageSpec, stagePerformance } from '../physics/RocketEquation';
import { PhysicsDirector } from '../director/PhysicsDirector';
import type { Phase } from '../director/phases';
import { Scene } from './Scene';

/** Cannon gravity is SI; the scene expects km (Scene does its own scale). */
const GRAVITY_MS2 = -CONST.G0;
/** Handoff altitude to the director's orbital integrator, m. */
const ORBIT_CUTOFF_M = 100_000;
/** Pitch-over completes at this altitude, m (matches AscentDynamics). */
const PITCHOVER_M = 190_000;
/** Pitch from vertical at pitch-over, rad. */
const PITCHOVER_RAD = (80 * Math.PI) / 180;
/** Fixed physics tick and substep cap. */
const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 10;
/** Abort kick, m/s. */
const ABORT_DV_MS = 30;
/** Rocket box half-extents, m. */
const HALF_EXTENTS = new CANNON.Vec3(3, 15, 3);

export class RigidBodyAscent {
  private readonly enabled = typeof window !== 'undefined';

  private world!: CANNON.World;
  private body!: CANNON.Body;
  private stages: StageSpec[] = [];
  private stageIndex = 0;
  private stagePropellantKg = 0;
  private mdotKgs = 0;
  private lastPhase: Phase = 'PAD';
  private aborted = false;
  private handoff = false;

  constructor(
    private readonly scene: Scene,
    private readonly director: PhysicsDirector,
  ) {}

  /** Build the stack body from stages + payload; safe to call again to reset. */
  init(stages: StageSpec[], payloadKg: number): void {
    this.stages = stages;
    this.stageIndex = 0;
    this.stagePropellantKg = 0;
    this.lastPhase = this.director.phase;
    this.aborted = false;
    this.handoff = false;
    if (!this.enabled) return;

    const massKg =
      stages.reduce((m, s) => m + s.dryMassKg + s.propellantMassKg, 0) + payloadKg;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY_MS2, 0) });
    this.body = new CANNON.Body({
      mass: massKg,
      shape: new CANNON.Box(HALF_EXTENTS),
      fixedRotation: true,
    });
    this.world.addBody(this.body);
    this.startStage();
  }

  /** Advance the rigid body and mirror it into the scene. */
  step(dtSec: number): void {
    if (!this.enabled || this.handoff) return;
    const dt = Math.max(0, dtSec);
    if (dt === 0) return;

    const phase = this.director.phase;
    if (phase !== this.lastPhase) {
      if (phase === 'STAGE_SEP') this.separate();
      this.lastPhase = phase;
    }
    if ((phase === 'LIFTOFF' || phase === 'ASCENT') && !this.aborted) this.burn(dt);

    this.world.step(FIXED_DT, dt, MAX_SUBSTEPS);

    const pos = this.scenePos();
    this.scene.setRocketPosition(pos);
    this.scene.addTrajectoryPoint(pos);

    if (this.body.position.y >= ORBIT_CUTOFF_M) this.handoffToDirector();
  }

  /** Launch-escape kick; also cuts powered thrust. */
  abort(): void {
    if (!this.enabled || this.handoff) return;
    this.aborted = true;
    this.body.applyImpulse(
      new CANNON.Vec3(0, this.body.mass * ABORT_DV_MS, 0),
    );
  }

  dispose(): void {
    if (!this.enabled) return;
    this.world.removeBody(this.body);
    this.handoff = true;
  }

  // --- internals ---------------------------------------------------------

  private startStage(): void {
    const stage = this.stages[this.stageIndex];
    if (!stage) return;
    this.stagePropellantKg = stage.propellantMassKg;
    this.mdotKgs = stagePerformance(stage, this.body.mass).mdot;
  }

  /** Apply stage thrust along the pitch program while consuming propellant. */
  private burn(dt: number): void {
    const stage = this.stages[this.stageIndex];
    if (!stage || this.stagePropellantKg <= 0) return;
    const propellantKg = Math.min(this.stagePropellantKg, this.mdotKgs * dt);
    this.stagePropellantKg -= propellantKg;
    this.setMass(this.body.mass - propellantKg);

    const pitch =
      Math.min(Math.max(0, this.body.position.y) / PITCHOVER_M, 1) * PITCHOVER_RAD;
    this.body.applyForce(
      new CANNON.Vec3(stage.thrustN * Math.sin(pitch), stage.thrustN * Math.cos(pitch), 0),
    );
  }

  /** Drop the current stage's dry mass once per separation phase. */
  private separate(): void {
    const stage = this.stages[this.stageIndex];
    if (!stage) return;
    this.setMass(this.body.mass - stage.dryMassKg);
    this.stagePropellantKg = 0;
    this.stageIndex++;
    this.startStage();
  }

  private setMass(massKg: number): void {
    this.body.mass = Math.max(1, massKg);
    this.body.updateMassProperties();
  }

  /** Director orbital integrator takes over; park the rigid body. */
  private handoffToDirector(): void {
    this.handoff = true;
    this.body.sleep();
  }

  /** Body position (m above the pad) → scene km above the Earth's centre. */
  private scenePos(): [number, number, number] {
    const p = this.body.position;
    return [p.x / 1000, CONST.R_EARTH / 1000 + p.y / 1000, p.z / 1000];
  }
}
