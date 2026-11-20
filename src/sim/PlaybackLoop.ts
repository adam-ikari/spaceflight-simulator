/**
 * Playback loop — runs one complete crewed mission automatically and mirrors
 * director telemetry into the store. Physics stays in PhysicsDirector; this
 * class only decides when the next phase begins.
 */
import { PhysicsDirector } from '../director/PhysicsDirector';
import type { Phase } from '../director/phases';
import { store } from '../state/store';

/** Altitude triggers for the powered-ascent phases, km. */
const ASCENT_KM = 3;
const STAGE_SEP_KM = 120;
/** Coast duration between separation and insertion, physics seconds. */
const SEP_COAST_S = 8;
/** Ascent Δv considered spent, m/s. */
const INSERT_DONE_MS = 60;
/** Wall-clock viewing time in ORBIT / RENDEZVOUS / LANDING, seconds. */
const ORBIT_DWELL_S = 8;
const RENDEZVOUS_DWELL_S = 5;
const LANDING_DWELL_S = 4;
/** Deorbit end conditions: speed target (m/s) and burn cap (physics seconds). */
const DEORBIT_SPEED_MS = 5500;
const DEORBIT_MAX_S = 180;
/** Entry ends near chute-deploy altitude, km. */
const ENTRY_TARGET_KM = 3.2;

export class PlaybackLoop {
  private d = new PhysicsDirector();
  private raf = 0;
  private last = 0;
  private warp: number;
  private wallDwell = 0;
  private physicsClock = 0;
  private paused = false;
  private stopped = false;
  private vehicle: Parameters<PhysicsDirector['setVehicle']> | null = null;

  constructor(warp = 1) {
    this.warp = Math.max(1, warp);
    this.reset();
  }

  get director(): PhysicsDirector {
    return this.d;
  }

  get phase(): Phase {
    return this.d.phase;
  }

  get finished(): boolean {
    return this.stopped;
  }

  /** Restart from liftoff with the last configured vehicle. */
  reset(): void {
    this.d = new PhysicsDirector();
    if (this.vehicle) this.d.setVehicle(...this.vehicle);
    this.d.setPhase('LIFTOFF');
    this.wallDwell = 0;
    this.physicsClock = 0;
    this.paused = false;
    this.stopped = false;
    this.sync();
  }

  /** Changing the vehicle always restarts playback — no in-flight swap. */
  setVehicle(...args: Parameters<PhysicsDirector['setVehicle']>): void {
    this.vehicle = args;
    this.reset();
  }

  setWarp(warp: number): void {
    this.warp = Math.max(1, warp);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
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

  /** One step; `dtWallSec` is real time, warped only for physics. */
  tick(dtWallSec: number): void {
    if (this.paused || this.stopped) return;
    const wall = Math.max(0, dtWallSec);
    const dt = wall * this.warp;
    this.d.step(dt);
    this.advance(wall, dt);
    this.sync();
  }

  private go(next: Phase): void {
    this.d.setPhase(next);
    this.wallDwell = 0;
    this.physicsClock = 0;
  }

  /** Phase transitions no longer require a user decision. */
  private advance(wall: number, dt: number): void {
    const { altitudeKm, speedMs, dvRemainingMs } = this.d.telemetry();
    switch (this.d.phase) {
      case 'LIFTOFF':
        if (altitudeKm >= ASCENT_KM) this.go('ASCENT');
        break;
      case 'ASCENT':
        if (altitudeKm >= STAGE_SEP_KM) this.go('STAGE_SEP');
        break;
      case 'STAGE_SEP':
        this.physicsClock += dt;
        if (this.physicsClock >= SEP_COAST_S) this.go('ORBIT_INSERT');
        break;
      case 'ORBIT_INSERT':
        if (dvRemainingMs <= INSERT_DONE_MS) this.go('ORBIT');
        break;
      case 'ORBIT':
        this.wallDwell += wall;
        if (this.wallDwell >= ORBIT_DWELL_S) this.go('RENDEZVOUS');
        break;
      case 'RENDEZVOUS':
        this.wallDwell += wall;
        if (this.wallDwell >= RENDEZVOUS_DWELL_S) this.go('DEORBIT');
        break;
      case 'DEORBIT':
        this.physicsClock += dt;
        if (speedMs <= DEORBIT_SPEED_MS || this.physicsClock >= DEORBIT_MAX_S) {
          this.go('ENTRY');
        }
        break;
      case 'ENTRY':
        if (altitudeKm <= ENTRY_TARGET_KM) this.go('LANDING');
        break;
      case 'LANDING':
        this.wallDwell += wall;
        if (this.wallDwell >= LANDING_DWELL_S) this.stopped = true;
        break;
      default:
        break;
    }
  }

  private sync(): void {
    const t = this.d.telemetry();
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
