/**
 * FlightComputer — onboard guidance, navigation and control programs.
 * Every physics step calls `step`; the returned command drives thrust and
 * mechanisms. Nothing here is decorative telemetry: directors consume the
 * command to close the loop.
 */
export type Body = 'EARTH' | 'MOON';

export interface FlightComputerInput {
  phase: string;
  body: Body;
  timeSec: number;
  altitudeM: number;
  speedMs: number;
  radialSpeedMs: number;
  tangentialSpeedMs: number;
  targetAltitudeM: number;
  targetSpeedMs: number;
  dvRemainingMs: number;
  massKg: number;
  faults: string[];
}

export interface ProgramStatus {
  id: string;
  name: string;
  cycles: number;
  lastOutput: string;
  healthy: boolean;
}

export interface FlightCommand {
  /** 0..1 throttle demanded by the flight computer. */
  throttle: number;
  /** Thrust angle from local vertical, radians. */
  pitchRad: number;
  /** Requested stage index; -1 means coast. */
  stageIndex: number;
  /** Mechanism command: deploy fairing / landing gear / engine gimbal trim. */
  mechanisms: string[];
  programs: ProgramStatus[];
}

const PROGRAM_NAMES: Record<string, string> = {
  NAV: '状态估计',
  GUID: '制导律',
  CTRL: '姿态与节流控制',
  FAULT: '故障检测',
  SEQ: '任务时序',
};

const IDS = Object.keys(PROGRAM_NAMES);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class FlightComputer {
  private cycles = new Map<string, number>(IDS.map((id) => [id, 0]));
  private outputs = new Map<string, string>(IDS.map((id) => [id, 'INIT']));
  private healthy = new Map<string, boolean>(IDS.map((id) => [id, true]));
  private lastPhase = '';
  private navAltitudeM = 0;
  private navSpeedMs = 0;
  private navTimeSec = 0;
  private radialErrorIntegral = 0;
  private tangentialErrorIntegral = 0;

  /** One flight-computer major cycle. `dtSec` is the physics step. */
  step(dtSec: number, input: FlightComputerInput): FlightCommand {
    const dt = Math.max(0, dtSec);
    this.tick('NAV');
    this.navTimeSec += dt;
    // Navigation propagates its own estimate, then blends the sensor sample.
    this.navAltitudeM += input.radialSpeedMs * dt;
    this.navAltitudeM += (input.altitudeM - this.navAltitudeM) * Math.min(1, dt);
    this.navSpeedMs += (input.speedMs - this.navSpeedMs) * Math.min(1, dt);
    this.output('NAV', `ALT ${(this.navAltitudeM / 1000).toFixed(1)}km V ${this.navSpeedMs.toFixed(0)}`);

    this.tick('GUID');
    const altitudeErr = input.targetAltitudeM - this.navAltitudeM;
    const speedErr = input.targetSpeedMs - this.navSpeedMs;
    // Classic gravity turn: vertical at the pad, horizontal by target altitude.
    const pitch = clamp(
      (this.navAltitudeM / Math.max(1000, input.targetAltitudeM)) * (80 * Math.PI) / 180
        + speedErr * 0.0000002,
      0,
      (80 * Math.PI) / 180,
    );
    this.output('GUID', `PITCH ${((pitch * 180) / Math.PI).toFixed(1)}deg DV ${input.dvRemainingMs.toFixed(0)}`);

    this.tick('CTRL');
    const radialErr = -input.radialSpeedMs;
    const tangentialErr = input.targetSpeedMs - input.tangentialSpeedMs;
    this.radialErrorIntegral = clamp(this.radialErrorIntegral + radialErr * dt, -2000, 2000);
    this.tangentialErrorIntegral = clamp(this.tangentialErrorIntegral + tangentialErr * dt, -5000, 5000);
    const demand = radialErr * 0.005 + this.radialErrorIntegral * 0.00002
      + tangentialErr * 0.002 + this.tangentialErrorIntegral * 0.000005;
    const poweredPhase = ['LIFTOFF', 'ASCENT', 'ORBIT_INSERT', 'PARK', 'TLI', 'LOI',
      'DESCENT', 'LUNAR_LAUNCH', 'TEI', 'EARTH_ENTRY'].includes(input.phase);
    const throttle = poweredPhase && input.dvRemainingMs > 0
      ? clamp(0.7 + 0.3 * demand, 0, 1)
      : 0;
    this.output('CTRL', `THR ${(throttle * 100).toFixed(0)}%`);

    this.tick('FAULT');
    const faults = [...input.faults];
    if (input.dvRemainingMs <= 0) faults.push('DV_EMPTY');
    if (input.massKg <= 0) faults.push('MASS_EMPTY');
    for (const id of IDS) this.healthy.set(id, faults.length === 0);
    this.output('FAULT', faults.length ? faults.join(',') : 'NOMINAL');

    this.tick('SEQ');
    if (input.phase !== this.lastPhase) {
      this.lastPhase = input.phase;
      this.output('SEQ', `ENTER ${input.phase}`);
    } else {
      this.output('SEQ', `HOLD ${input.phase}`);
    }

    const mechanisms: string[] = [];
    if (input.phase === 'ASCENT' && input.altitudeM > 110_000) mechanisms.push('FAIRING');
    if (input.phase === 'DESCENT' && input.altitudeM < 6000) mechanisms.push('LANDING_GEAR');
    if (input.phase === 'EARTH_ENTRY' && input.altitudeM < 4000) mechanisms.push('CHUTE');
    if (throttle <= 0.001) mechanisms.push('ENGINE_OFF');

    return {
      throttle,
      pitchRad: pitch,
      stageIndex: throttle > 0 ? (input.body === 'MOON' ? 2 : input.altitudeM > 190_000 ? 1 : 0) : -1,
      mechanisms,
      programs: this.snapshot(),
    };
  }

  snapshot(): ProgramStatus[] {
    return IDS.map((id) => ({
      id,
      name: PROGRAM_NAMES[id],
      cycles: this.cycles.get(id) ?? 0,
      lastOutput: this.outputs.get(id) ?? 'INIT',
      healthy: this.healthy.get(id) ?? true,
    }));
  }

  private tick(id: string): void {
    this.cycles.set(id, (this.cycles.get(id) ?? 0) + 1);
  }

  private output(id: string, text: string): void {
    this.outputs.set(id, text);
  }
}
