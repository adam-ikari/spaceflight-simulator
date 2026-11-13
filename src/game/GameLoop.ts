import { PhysicsDirector } from '../director/PhysicsDirector';
import { PHASE_ORDER } from '../director/phases';
import { store } from '../state/store';

export type DecisionType =
  | 'abort'
  | 'go'
  | 'no_go'
  | 'burn'
  | 'deorbit'
  | 'eclipse_load_shed';

export interface Decision {
  type: DecisionType;
  payload?: unknown;
}

/**
 * Game loop — steps the physics director and publishes telemetry to the store.
 * Decisions are applied to the director; RAF drives ticks in the browser,
 * `tick(dt)` is the testable source of truth.
 */
export class GameLoop {
  private raf = 0;
  private last = 0;
  /** Coarse-ascent auto-transition thresholds (DESIGN.md auto phase drive). */
  private static readonly ASCENT_KM = 3;
  private static readonly STAGE_SEP_KM = 120;
  private static readonly SEP_COAST_S = 8;
  private static readonly INSERT_DONE_MS = 60;
  private sepClock = 0;

  /**
   * @param warp physics-time acceleration factor; wall speedup of the sim.
   *   1 = real time (~9 min to orbit); 10–20 keeps a launch watchable.
   */
  constructor(
    private readonly director: PhysicsDirector,
    private warp = 1,
  ) {
    this.sync();
  }

  /** Change the physics-time acceleration factor at runtime. */
  setWarp(warp: number): void {
    this.warp = Math.max(1, warp);
  }

  start(): void {
    if (typeof window === 'undefined' || this.raf !== 0) return;
    this.last = performance.now();
    const frame = (now: number): void => {
      this.tick((now - this.last) / 1000);
      this.last = now;
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** One physics step; dt in seconds (wall). Warped before integration. */
  tick(dtSec: number): void {
    const dt = Math.max(0, dtSec) * this.warp;
    this.director.step(dt);
    this.autoAdvance(dt);
    this.sync();
  }

  /**
   * Drive the mission forward automatically once airborne: liftoff → ascent →
   * stage sep → orbit insertion → orbit, from altitude and Δv state. Stops at
   * ORBIT — deorbit and landing stay user decisions.
   */
  private autoAdvance(dt: number): void {
    const d = this.director;
    if (d.phase === 'PAD') return;
    const { altitudeKm, dvRemainingMs } = d.telemetry();
    if (d.phase !== 'STAGE_SEP') this.sepClock = 0;

    switch (d.phase) {
      case 'LIFTOFF':
        if (altitudeKm >= GameLoop.ASCENT_KM) d.setPhase('ASCENT');
        break;
      case 'ASCENT':
        if (altitudeKm >= GameLoop.STAGE_SEP_KM) d.setPhase('STAGE_SEP');
        break;
      case 'STAGE_SEP':
        this.sepClock += dt;
        if (this.sepClock >= GameLoop.SEP_COAST_S) d.setPhase('ORBIT_INSERT');
        break;
      case 'ORBIT_INSERT':
        if (dvRemainingMs <= GameLoop.INSERT_DONE_MS) d.setPhase('ORBIT');
        break;
      default:
        break;
    }
  }

  decide(decision: Decision): void {
    const aborted = decision.type === 'abort' || store.get().aborted;
    switch (decision.type) {
      case 'abort':
        // Solid boosters cannot be shut down: the director keeps PLOC on the
        // RiskModel solid-booster rule, so the abort cannot rescue the crew.
        break;
      case 'go':
        if (this.director.phase === 'PAD') this.director.setPhase('LIFTOFF');
        break;
      case 'no_go':
        break;
      case 'burn':
        // Maneuver is recorded as a decision; orbital insertion is handled by
        // the director's own insertion phase.
        break;
      case 'deorbit': {
        const target = PHASE_ORDER.indexOf('DEORBIT');
        let at = PHASE_ORDER.indexOf(this.director.phase);
        while (at < target) {
          this.director.advance();
          at++;
        }
        break;
      }
      case 'eclipse_load_shed':
        break;
    }
    store.set({
      aborted,
      decisions: [...store.get().decisions, decision.type],
    });
    this.sync();
  }

  private sync(): void {
    const t = this.director.telemetry();
    store.set({
      phase: t.phase,
      t: t.t,
      altitudeKm: t.altitudeKm,
      speedMs: t.speedMs,
      ploc: t.ploc,
      costUsd: t.costUsd,
      fuelPct: t.fuelPct,
      systems: t.systems,
    });
  }
}
