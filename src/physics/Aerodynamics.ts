/**
 * Aerodynamics — drag from the actual stack shape, not a hard-coded area.
 *
 * The frontal area comes from the propellant-volume geometry, and the drag
 * coefficient is a function of Mach number and fineness ratio:
 *
 *     Cd(M) = 0.12 + 0.0035·(Swet/Af) + stubby
 *             + 0.15·exp(−((M − 1.1)/0.35)²) + 0.10/√M   (M > 1)
 *
 * - 0.12 base + skin friction from the wetted-to-frontal area ratio;
 * - a stubby-body penalty when the fineness ratio is below 6;
 * - a transonic rise centred on M 1.1 (wave drag, shock formation);
 * - a supersonic decay term.
 *
 * Anchors (Saturn V-class geometry, fineness 10): Cd ≈ 0.25 at M 0.3,
 * ≈ 0.50 at M 1.1, ≈ 0.31 at M 3. The old model used a constant Cd 0.3 and a
 * fixed 80 m² area, so a skinny or stubby vehicle dragged identically.
 */
import { density } from './Atmosphere';
import type { VehicleGeometry } from '../render/vehicleGeometry';

/** Approximate speed of sound, m/s (standard atmosphere, layered). */
export function speedOfSoundMs(altitudeKm: number): number {
  const h = Math.max(0, altitudeKm);
  // Linear from 340 m/s at sea level to 295 m/s at the tropopause (11 km).
  if (h <= 11) return 340 - (45 / 11) * h;
  if (h <= 20) return 295;
  if (h <= 47) return 295 + 0.9 * (h - 20);
  return 320;
}

export function machNumber(speedMs: number, altitudeKm: number): number {
  const sos = Math.max(1, speedOfSoundMs(altitudeKm));
  return Math.max(0, speedMs) / sos;
}

/**
 * Total frontal area, including a side-booster pair when present.
 */
export function stackFrontalAreaM2(geo: VehicleGeometry): number {
  const boosters = geo.strapOn ? 2 * Math.PI * geo.strapOn.radiusM * geo.strapOn.radiusM : 0;
  return geo.frontalAreaM2 + boosters;
}

/**
 * Zero-lift drag coefficient from Mach and shape. `fineness` and the
 * wetted/frontal ratio are dimensionless; both come from the geometry.
 */
export function dragCoefficient(mach: number, fineness: number, wettedToFrontal: number): number {
  const m = Math.max(0, mach);
  // Skin friction: Cf ≈ 0.0035 for a turbulent boundary layer on a smooth
  // booster; slender bodies expose more wetted area per unit frontal area.
  const skin = Math.min(0.2, 0.0035 * Math.max(0, wettedToFrontal));
  // Below ~6:1 the aft body and base dominate; a stubby stack pays for it.
  const stubby = Math.max(0, (6 - fineness) * 0.02);
  const base = 0.12 + stubby;
  const transonic = 0.15 * Math.exp(-Math.pow((m - 1.1) / 0.35, 2));
  const supersonic = m > 1 ? 0.1 / Math.sqrt(m) : 0;
  return base + skin + transonic + supersonic;
}

/** Cd·A, m². */
export function dragAreaM2(geo: VehicleGeometry, mach: number): number {
  const frontal = stackFrontalAreaM2(geo);
  const wettedToFrontal = frontal > 0 ? geo.wettedAreaM2 / frontal : 0;
  return dragCoefficient(mach, geo.fineness, wettedToFrontal) * frontal;
}

/** Drag force, N. */
export function dragForceN(geo: VehicleGeometry, speedMs: number, altitudeKm: number): number {
  if (speedMs <= 0) return 0;
  const mach = machNumber(speedMs, altitudeKm);
  const q = 0.5 * density(altitudeKm * 1000) * speedMs * speedMs;
  return q * dragAreaM2(geo, mach);
}
