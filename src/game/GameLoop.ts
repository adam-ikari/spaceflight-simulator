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

  constructor(private readonly director: PhysicsDirector) {
    this.sync();
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

  /** One physics step; dt in seconds. */
  tick(dtSec: number): void {
    this.director.step(dtSec);
    this.sync();
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
      ploc: t.ploc,
      costUsd: t.costUsd,
      fuelPct: t.fuelPct,
    });
  }
}
