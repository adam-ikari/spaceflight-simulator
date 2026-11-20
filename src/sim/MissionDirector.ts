import type { PhysicsDirector } from '../director/PhysicsDirector';
import type { SystemsSnapshot } from '../physics/ComponentSystems';
import type { ProgramStatus } from '../physics/FlightComputer';
import type { LifeSupportState } from '../physics/LifeSupport';

export type Body = 'EARTH' | 'MOON';
export type MissionKind = 'leo' | 'lunar';

/** Telemetry shape shared by both mission directors and the UI store. */
export interface MissionTelemetry {
  phase: string;
  t: number;
  altitudeKm: number;
  speedMs: number;
  dvRemainingMs: number;
  ploc: number;
  costUsd: number;
  fuelPct: number;
  systems: SystemsSnapshot | null;
  body?: Body;
  /** Chemistry-derived effective Isp for the active burn, s. */
  ispS?: number;
  /** Aerodynamic drag during atmospheric flight, N. */
  dragN?: number;
  /** Elastic-body response: pogo acceleration g and Miles vibration g_rms. */
  pogoG?: number;
  vibrationGrms?: number;
  /** Rigid-body ascent model's gravity + drag loss, m/s. */
  ascentLossMs?: number;
  /** Onboard computer programs and their cycle counts. */
  computer?: ProgramStatus[];
  /** Environmental control and life-support state. */
  life?: LifeSupportState;
  /** Accumulated radiation dose, mSv. */
  radiationMsv?: number;
}

/**
 * Contract consumed by PlaybackLoop. PhysicsDirector already satisfies it
 * structurally; LunarDirector implements the same surface for the moon mission.
 */
export interface MissionDirector {
  readonly phase: string;
  /** `wallSec` drives viewing dwells; `dtSec` is the warped physics step. */
  step(dtSec: number, wallSec?: number): void;
  telemetry(): MissionTelemetry;
  /** Earth-centred real coordinates, km. */
  positionKm(): [number, number, number];
  /** Moon ephemeris in the same frame, km; only lunar missions provide it. */
  moonPositionKm?(): [number, number, number];
  setVehicle(...args: Parameters<PhysicsDirector['setVehicle']>): void;
}
