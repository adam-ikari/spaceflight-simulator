/**
 * Playback loop — runs one complete mission automatically and mirrors
 * director telemetry into the store. LEO uses the existing PhysicsDirector;
 * the lunar mission uses LunarDirector, which owns its own phase progression.
 */
import { PhysicsDirector } from '../director/PhysicsDirector';
import { store } from '../state/store';
import { LunarDirector } from './LunarDirector';
import type { MissionDirector, MissionKind } from './MissionDirector';

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
  private d: MissionDirector;
  private raf = 0;
  private last = 0;
  private warp: number;
  private mission: MissionKind;
  private wallDwell = 0;
  private physicsClock = 0;
  private paused = false;
  private stopped = false;
  private vehicle: Parameters<PhysicsDirector['setVehicle']> | null = null;

  constructor(warp = 1, mission: MissionKind = 'leo') {
    this.warp = Math.max(1, warp);
    this.mission = mission;
    this.d = this.createDirector();
    this.reset();
  }

  get director(): MissionDirector {
    return this.d;
  }

  get phase(): string {
    return this.d.phase;
  }

  get finished(): boolean {
    return this.stopped;
  }

  private createDirector(): MissionDirector {
    return this.mission === 'lunar' ? new LunarDirector() : new PhysicsDirector();
  }

  /** Restart with the last configured vehicle, preserving the mission choice. */
  reset(): void {
    this.d = this.createDirector();
    if (this.vehicle) this.d.setVehicle(...this.vehicle);
    if (this.mission === 'leo') (this.d as PhysicsDirector).setPhase('LIFTOFF');
    this.wallDwell = 0;
    this.physicsClock = 0;
    this.paused = false;
    this.stopped = false;
    this.sync();
  }

  /** Switch between near-Earth and full lunar mission; always restarts. */
  setMission(mission: MissionKind): void {
    this.mission = mission;
    this.reset();
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
    if (this.mission === 'lunar') {
      this.d.step(dt, wall);
      if ((this.d as LunarDirector).finished) this.stopped = true;
      this.sync();
      return;
    }
    this.d.step(dt);
    this.advance(wall, dt);
    this.sync();
  }

  private go(next: Parameters<PhysicsDirector['setPhase']>[0]): void {
    (this.d as PhysicsDirector).setPhase(next);
    this.wallDwell = 0;
    this.physicsClock = 0;
  }

  /** LEO phase transitions no longer require a user decision. */
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
      body: t.body,
      ispS: t.ispS,
      dragN: t.dragN,
      pogoG: t.pogoG,
      vibrationGrms: t.vibrationGrms,
      ascentLossMs: t.ascentLossMs,
      computer: t.computer,
      life: t.life,
      radiationMsv: t.radiationMsv,
    });
  }
}
