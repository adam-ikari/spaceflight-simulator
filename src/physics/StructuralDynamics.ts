/**
 * StructuralDynamics — vibration modes and fatigue for a launch vehicle.
 *
 * Three mechanisms, each with one measured anchor:
 *
 * 1. Pogo (longitudinal). The vehicle structure plus the propellant column in
 *    the feed line behaves as a spring–mass oscillator. The pump supplies a
 *    thrust ripple at the same frequency; the response is the classic
 *    single-degree-of-freedom amplification
 *
 *        A(r) = 1 / sqrt((1 − r²)² + (r/Q)²),   r = f_exc / f_n
 *
 *    At resonance A = Q. Apollo 6 measured ≈ 0.6 g at 5.5 Hz; with a 2.5 %
 *    pump ripple, Q = 20 and T/W = 1.2 the model gives 0.6 g, which is the
 *    calibration anchor for the default Q.
 *
 * 2. First bending. Euler–Bernoulli cantilever, uniform-mass approximation:
 *        f₁ = (1.875²/2π)·sqrt(EI / (m'·L⁴))
 *    Saturn V-class (L ≈ 110 m, m' ≈ 27 t/m) lands at 0.3–1.5 Hz, the band
 *    where control–structure interaction matters.
 *
 * 3. Random vibration. Miles' equation for a single mode driven by a flat
 *    acceleration PSD:
 *        g_rms = sqrt(π/2 · f_n · Q · PSD)
 *    Component qualification levels are 6–10 g_rms; 0.04 g²/Hz at 150 Hz and
 *    Q = 10 gives 9.7 g_rms, the upper end of that band.
 *
 * Fatigue uses Miner's rule with an inverse power S–N curve (aluminium,
 * b ≈ 4): N(g) = N_ref·(g_ref/g)^b, damage = Σ cycles/N.
 */

export const G0 = 9.80665;

/** Pogo acceleration the crew can tolerate without injury (sustained), g. */
export const CREW_POGO_LIMIT_G = 0.5;
/** Pogo acceleration that damages thrust structure / engine gimbal, g. */
export const STRUCTURAL_POGO_LIMIT_G = 1.0;
/** Reference acceleration and cycle count for the S–N curve, g and cycles. */
const SN_REF_G = 10;
const SN_REF_CYCLES = 1e7;
const SN_EXPONENT = 4;

export interface PogoInput {
  /** Vacuum/sea-level thrust currently produced, N. */
  thrustN: number;
  /** Current stack mass, kg. */
  vehicleMassKg: number;
  /** Pump-induced thrust ripple as a fraction of thrust (0.01 = 1 %). */
  pumpOscillationFrac: number;
  /** Excitation frequency (pump/feed-line), Hz. */
  excitationHz: number;
  /** Structural natural frequency, Hz. */
  naturalHz: number;
  /** Amplification at resonance (1/(2ζ)). */
  qFactor: number;
}

export interface PogoResult {
  /** Dynamic amplification A(r). */
  amplification: number;
  /** Thrust ripple after amplification, fraction of thrust. */
  thrustOscillationFrac: number;
  /** Oscillatory acceleration seen by the structure, g. */
  structuralAccelG: number;
  /** True when the excitation is within 10 % of the natural frequency. */
  resonant: boolean;
}

/** Steady-state response of the pogo oscillator. */
export function pogoResponse(inp: PogoInput): PogoResult {
  const fn = Math.max(1e-6, inp.naturalHz);
  const q = Math.max(0.1, inp.qFactor);
  const r = Math.max(0, inp.excitationHz) / fn;
  const amplification = 1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2));

  const thrustOscillationFrac = Math.max(0, inp.pumpOscillationFrac) * amplification;
  const twr = inp.vehicleMassKg > 0 ? inp.thrustN / (inp.vehicleMassKg * G0) : 0;
  return {
    amplification,
    thrustOscillationFrac,
    structuralAccelG: thrustOscillationFrac * twr,
    resonant: Math.abs(r - 1) <= 0.1,
  };
}

/** Natural frequency of a spring–mass oscillator, Hz. */
export function naturalFrequencyHz(massKg: number, stiffnessNm: number): number {
  if (massKg <= 0 || stiffnessNm <= 0) return 0;
  return Math.sqrt(stiffnessNm / massKg) / (2 * Math.PI);
}

/**
 * Effective pogo mass: the propellant column that participates in the
 * feed-line mode. Measured-order 0.1 % of stage propellant.
 */
export function pogoEffectiveMassKg(propellantMassKg: number): number {
  return Math.max(100, 0.001 * Math.max(0, propellantMassKg));
}

/**
 * Feed-line/structural stiffness. Anchored so a Saturn V S-IC
 * (3.4e7 N thrust, 2.1e6 kg propellant) lands at ≈ 5.5 Hz:
 * k = 2.4e6 N/m, m_eff = 2100 kg → 5.38 Hz.
 */
export function pogoStiffnessNm(thrustN: number): number {
  return 0.07 * Math.max(0, thrustN);
}

/** First bending frequency of a uniform cantilever, Hz. */
export function firstBendingHz(lengthM: number, eiNm2: number, massPerLengthKgM: number): number {
  if (lengthM <= 0 || eiNm2 <= 0 || massPerLengthKgM <= 0) return 0;
  return ((1.875 * 1.875) / (2 * Math.PI)) * Math.sqrt(eiNm2 / (massPerLengthKgM * Math.pow(lengthM, 4)));
}

/** Miles' equation: response g_rms of one mode to a flat PSD. */
export function randomVibrationGrms(psdG2PerHz: number, fnHz: number, qFactor: number): number {
  const psd = Math.max(0, psdG2PerHz);
  const fn = Math.max(0, fnHz);
  const q = Math.max(0.1, qFactor);
  return Math.sqrt((Math.PI / 2) * fn * q * psd);
}

/** Fatigue cycles to failure at a given g_rms (inverse power S–N). */
export function cyclesToFailure(grms: number, refGrms = SN_REF_G, refCycles = SN_REF_CYCLES): number {
  if (grms <= 0) return Infinity;
  return refCycles * Math.pow(refGrms / grms, SN_EXPONENT);
}

/** Miner damage increment for `dtSec` at `grms` and mode frequency `fnHz`. */
export function minerDamageIncrement(grms: number, fnHz: number, dtSec: number): number {
  if (grms <= 0 || fnHz <= 0 || dtSec <= 0) return 0;
  const cycles = fnHz * dtSec;
  return cycles / cyclesToFailure(grms);
}

/**
 * Probability that a component has already failed when a state variable is
 * past its limit. Zero below the limit; 63 % at limit + scale; → 1 well past.
 *
 *     p = 1 − exp(−((x − limit)/scale)²)
 */
export function overLimitProbability(value: number, limit: number, scale: number): number {
  if (!(scale > 0)) return value > limit ? 1 : 0;
  const excess = value - limit;
  if (excess <= 0) return 0;
  return 1 - Math.exp(-Math.pow(excess / scale, 2));
}
