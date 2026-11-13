/**
 * Launch-vehicle geometry from physics data — no Babylon dependency, so the
 * proportions are unit-testable.
 *
 * Each stage's tank volume follows from its propellant mass at the mixture
 * ratio's bulk density (plus dry mass at an effective structural density), and
 * the stack diameter follows from a launch-vehicle fineness ratio
 * (length / diameter). A single exaggeration factor scales every dimension;
 * at 1 the stack is true scale next to the 6,371 km Earth.
 */
import type { StageSpec } from '../physics/RocketEquation';
import { PROPELLANTS } from '../physics/propellants';
import { METRES_PER_UNIT } from './sceneScale';

export { METRES_PER_UNIT };
/**
 * 1 = true scale. The rocket renders at the same scale as the Earth; camera
 * distances are expressed in vehicle heights, so framing still works. Physics
 * always uses the metre-valued fields below, never scene units.
 */
export const SCENE_EXAGGERATION = 1;
/** Target stack fineness ratio (length / diameter). */
export const FINENESS = 10;
/** Nose cone length as a multiple of the stack radius. */
export const NOSE_RADIUS_RATIO = 2.4;
/** Solid motor bulk density, kg/m³ (APCP ~1800). */
export const SOLID_DENSITY = 1800;
/** Strap-on diameter as a fraction of the core diameter. */
export const STRAP_DIAMETER_RATIO = 0.44;
/** Fallback strap-on volume as a fraction of the core, without solid data. */
const GENERIC_STRAP_FRACTION = 0.3;

/** Integer clamp. */
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Bulk density of a stage's propellant load at its actual mixture ratio. */
export function propellantDensity(stage: StageSpec): number {
  if (stage.isSolid) return SOLID_DENSITY;
  const p = PROPELLANTS[stage.propellantId];
  if (!p) return 1000;
  const of = Number.isFinite(stage.ofRatio) && stage.ofRatio > 0 ? stage.ofRatio : p.ofTypical;
  const oxShare = of / (1 + of);
  const fuelShare = 1 / (1 + of);
  return 1 / (oxShare / p.rhoOx + fuelShare / p.rhoF);
}

/**
 * Tank volume of one stage, m³. Only the propellant is counted: a stage's dry
 * structure is thin shell inside the same envelope, so adding its mass at a
 * "structural density" would double-count the volume and make boosters absurdly
 * long (a 90 t SRB casing is a few m³ of steel, not 300 m³).
 */
export function stageVolume(stage: StageSpec): number {
  const propM3 = Math.max(0, stage.propellantMassKg) / propellantDensity(stage);
  // A stage with no propellant still needs a visible body.
  return Math.max(1, propM3);
}

export interface VehicleGeometry {
  /** Core stack radius, scene units. */
  radius: number;
  /** Core stack radius, metres. */
  radiusM: number;
  /** Core stack height including the nose cone, scene units. */
  height: number;
  /** Core stack height including the nose cone, metres. */
  heightM: number;
  /** Inline stage heights (nose excluded), scene units, bottom stage first. */
  stageHeights: number[];
  /** Inline stage heights (nose excluded), metres, bottom stage first. */
  stageHeightsM: number[];
  /** Length/diameter of the core stack, dimensionless. */
  fineness: number;
  /** Frontal area of the core, m². */
  frontalAreaM2: number;
  /** Wetted (skin-friction) area of the core, m². */
  wettedAreaM2: number;
  /** Total propellant volume, m³. */
  volumeM3: number;
  /** Nose-cone length, m. */
  noseLengthM: number;
  /** Side boosters, when present. */
  strapOn: {
    radius: number;
    height: number;
    radiusM: number;
    heightM: number;
    offset: number;
  } | null;
}

/**
 * Split an inline stack from its strap-on pair. A lit solid first stage is a
 * side booster (Shuttle/STS layout), not part of the core.
 */
export function splitStack(
  stages: StageSpec[],
  hasSolidBooster: boolean,
): { core: StageSpec[]; strapOn: StageSpec | null } {
  const isSolidFirst = hasSolidBooster && stages[0]?.isSolid === true;
  if (isSolidFirst && stages.length > 1) {
    return { core: stages.slice(1), strapOn: stages[0] };
  }
  return { core: stages, strapOn: null };
}

export function computeVehicleGeometry(
  stages: StageSpec[],
  hasSolidBooster: boolean,
): VehicleGeometry {
  const { core, strapOn } = splitStack(stages, hasSolidBooster);
  const safeCore = core.length > 0 ? core : stages;

  const volumes = safeCore.map(stageVolume);
  const volumeTotal = volumes.reduce((a, b) => a + b, 0);
  const strapVolume = strapOn
    ? stageVolume(strapOn)
    : hasSolidBooster
      ? GENERIC_STRAP_FRACTION * volumeTotal
      : 0;

  // V/(πr²) + nose = FINENESS·2r  ⇒  r = cbrt(V / (π·(2·FINENESS − noseRatio)))
  const radiusM = Math.cbrt(volumeTotal / (Math.PI * (2 * FINENESS - NOSE_RADIUS_RATIO)));
  const bodyHeightM = volumeTotal / (Math.PI * radiusM * radiusM);
  const toUnits = (metres: number): number => (metres / METRES_PER_UNIT) * SCENE_EXAGGERATION;

  const radius = toUnits(radiusM);
  const stageHeightsM = volumes.map((v) => (bodyHeightM * v) / volumeTotal);
  const stageHeights = stageHeightsM.map(toUnits);
  const noseLengthM = radiusM * NOSE_RADIUS_RATIO;
  const noseH = toUnits(noseLengthM);
  const height = stageHeights.reduce((a, b) => a + b, 0) + noseH;
  const heightM = bodyHeightM + noseLengthM;

  let strap: VehicleGeometry['strapOn'] = null;
  if (strapVolume > 0) {
    const halfVolume = strapVolume / 2;
    let rbM = (STRAP_DIAMETER_RATIO * radiusM) / 2;
    let hbM = halfVolume / (Math.PI * rbM * rbM);
    // Boosters hang beside the core, they cannot out-top it (and their base sits
    // on the pad), so cap the length at the core body and thicken them instead
    // of letting a light solid stage render as a needle twice the core's height.
    const maxLengthM = 0.96 * bodyHeightM;
    if (hbM > maxLengthM) {
      hbM = maxLengthM;
      rbM = Math.sqrt(halfVolume / (Math.PI * hbM));
    }
    const rb = toUnits(rbM);
    const hb = toUnits(hbM);
    strap = { radius: rb, height: hb, radiusM: rbM, heightM: hbM, offset: radius + rb * 0.92 };
  }

  return {
    radius,
    radiusM,
    height,
    heightM,
    stageHeights,
    stageHeightsM,
    fineness: height / (2 * radius),
    frontalAreaM2: Math.PI * radiusM * radiusM,
    // Cylinder side + conical nose slant (frustum side area approximated by
    // the cone's slant surface).
    wettedAreaM2:
      2 * Math.PI * radiusM * bodyHeightM +
      Math.PI * radiusM * Math.hypot(noseLengthM, radiusM),
    volumeM3: volumeTotal,
    noseLengthM,
    strapOn: strap,
  };
}

/** Bell count for one stage from its thrust and propellant type. */
export function engineCount(stage: StageSpec): number {
  const perEngine = stage.isSolid ? 3.5e6 : ENGINE_THRUST[stage.propellantId] ?? 2e6;
  return clamp(Math.round(stage.thrustN / perEngine), 1, 9);
}

const ENGINE_THRUST: Record<string, number> = {
  LOX_RP1: 6.8e6,
  LOX_LH2: 1.1e6,
  LOX_CH4: 2.3e6,
  NTO_MMH: 0.5e6,
};
