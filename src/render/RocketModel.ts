/**
 * Parametric rocket builder (Babylon.js): turns the selected stage stack into a
 * detailed TransformNode (multi-stage bodies, interstage rings, nozzle
 * clusters, spacecraft, fins, strap-on solids, launch-escape tower).
 *
 * All proportions come from `vehicleGeometry` (propellant volume + fineness
 * ratio) and fractions of the resulting radius/stage heights, so the mesh
 * matches the physics data instead of hand-tuned world sizes. Origin sits at
 * the pad (bottom of stage 1); the stack extends along +Y so the parent node
 * can align local +Y with the velocity vector.
 */
import * as B from '@babylonjs/core';
import type { StageSpec } from '../physics/RocketEquation';
import {
  NOSE_RADIUS_RATIO,
  computeVehicleGeometry,
  engineCount,
  splitStack,
} from './vehicleGeometry';
import { METRES_PER_UNIT } from './sceneScale';

export interface RocketModel {
  root: B.TransformNode;
  height: number;
  radius: number;
}

export interface RocketFeatures {
  escapeSystem: 'tower' | 'propulsive' | 'none';
  hasSolidBooster: boolean;
}

interface Materials {
  body: B.PBRMaterial;
  dark: B.PBRMaterial;
  ring: B.PBRMaterial;
  bell: B.PBRMaterial;
  black: B.PBRMaterial;
  insulation: B.PBRMaterial;
  foil: B.PBRMaterial;
}

function buildMaterials(scene: B.Scene): Materials {
  // PBR without an IBL: keep metallic moderate so direct lights still read.
  const body = new B.PBRMaterial('bodyMat', scene);
  body.albedoColor = new B.Color3(0.91, 0.91, 0.92);
  body.metallic = 0.35;
  body.roughness = 0.5;

  const dark = new B.PBRMaterial('darkMat', scene);
  dark.albedoColor = new B.Color3(0.16, 0.18, 0.21);
  dark.metallic = 0.65;
  dark.roughness = 0.55;

  const ring = new B.PBRMaterial('ringMat', scene);
  ring.albedoColor = new B.Color3(0.61, 0.64, 0.67);
  ring.metallic = 0.6;
  ring.roughness = 0.48;

  const bell = new B.PBRMaterial('bellMat', scene);
  bell.albedoColor = new B.Color3(0.23, 0.25, 0.28);
  bell.metallic = 0.7;
  bell.roughness = 0.35;

  const black = new B.PBRMaterial('paintBlackMat', scene);
  black.albedoColor = new B.Color3(0.045, 0.05, 0.055);
  black.metallic = 0.25;
  black.roughness = 0.7;

  const insulation = new B.PBRMaterial('insulationMat', scene);
  insulation.albedoColor = new B.Color3(0.86, 0.87, 0.88);
  insulation.metallic = 0.2;
  insulation.roughness = 0.62;

  const foil = new B.PBRMaterial('foilMat', scene);
  foil.albedoColor = new B.Color3(0.72, 0.56, 0.24);
  foil.metallic = 0.55;
  foil.roughness = 0.4;

  return { body, dark, ring, bell, black, insulation, foil };
}

const TAU = Math.PI * 2;
/** Historical Apollo 11 stack dimensions (metres), drawn at true scene scale. */
const APOLLO_RADIUS_M = 5.05;
const APOLLO_STAGE_HEIGHTS_M = [42.1, 24.8, 17.8];
const APOLLO_PAYLOAD_HEIGHT_M = 25.9;

export function buildRocketModel(
  scene: B.Scene,
  stages: StageSpec[],
  features: RocketFeatures,
): RocketModel {
  const root = new B.TransformNode('vehicle', scene);
  const mats = buildMaterials(scene);

  const { core } = splitStack(stages, features.hasSolidBooster);
  const stack = core.length > 0 ? core : stages;
  const geo = computeVehicleGeometry(stages, features.hasSolidBooster);
  const hasStrapOn = geo.strapOn !== null;

  // Saturn V default stack: LOX/RP-1 first stage under two LOX/LH2 stages and
  // a launch-escape tower. Other designer configurations keep the generic
  // builder below, so custom rockets are never dressed up as Apollo.
  const apollo =
    features.escapeSystem === 'tower' &&
    !hasStrapOn &&
    stack.length === 3 &&
    stack[0]?.propellantId === 'LOX_RP1' &&
    stack[1]?.propellantId === 'LOX_LH2' &&
    stack[2]?.propellantId === 'LOX_LH2';
  const radius = apollo ? APOLLO_RADIUS_M / METRES_PER_UNIT : geo.radius;

  // The S-IVB is narrower than the 10 m S-IC/S-II body.
  const upperR = radius * 0.66;

  const add = <T extends B.Mesh>(mesh: T, x: number, y: number, z: number): T => {
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    return mesh;
  };

  const cylinder = (
    name: string,
    y: number,
    height: number,
    bottomD: number,
    topD: number,
    mat: B.Material,
    tessellation = 24,
  ): B.Mesh => {
    const mesh = add(
      B.MeshBuilder.CreateCylinder(
        name,
        { height, diameterBottom: bottomD, diameterTop: topD, tessellation },
        scene,
      ),
      0,
      y,
      0,
    );
    mesh.material = mat;
    return mesh;
  };

  /** Thin painted plate lying tangent to the body at angle `a`. */
  const panel = (
    name: string,
    a: number,
    y: number,
    height: number,
    width: number,
    bodyR: number,
    mat: B.Material,
  ): void => {
    const mesh = add(
      B.MeshBuilder.CreateBox(name, { width, height, depth: bodyR * 0.015 }, scene),
      Math.cos(a) * bodyR,
      y,
      Math.sin(a) * bodyR,
    );
    mesh.rotation.y = Math.PI / 2 - a;
    mesh.material = mat;
  };

  const engineCluster = (
    name: string,
    centerY: number,
    count: number,
    spread: number,
    topR: number,
    bottomR: number,
    height: number,
    lip = false,
  ): void => {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU;
      const bx = Math.cos(a) * spread;
      const bz = Math.sin(a) * spread;
      const bell = add(
        B.MeshBuilder.CreateCylinder(
          `${name}${k}`,
          {
            height,
            diameterTop: topR * 2,
            diameterBottom: bottomR * 2,
            tessellation: 16,
            cap: B.Mesh.NO_CAP,
          },
          scene,
        ),
        bx,
        centerY,
        bz,
      );
      bell.material = mats.bell;
      if (lip) {
        const ring = add(
          B.MeshBuilder.CreateTorus(
            `${name}Lip${k}`,
            { diameter: bottomR * 2, thickness: bottomR * 0.14, tessellation: 16 },
            scene,
          ),
          bx,
          centerY - height * 0.48,
          bz,
        );
        ring.material = mats.dark;
      }
    }
  };

  let y = 0;
  stack.forEach((stage, i) => {
    const h = apollo
      ? APOLLO_STAGE_HEIGHTS_M[i] / METRES_PER_UNIT
      : geo.stageHeights[i] ?? 0;
    const isSic = apollo && i === 0;
    const isSii = apollo && i === 1;
    const isSivb = apollo && i === 2;
    const bodyR = isSivb ? upperR : radius;

    // Real S-IVB attitude: a conical aft skirt under the narrower tank.
    const taper = isSivb ? Math.min(h * 0.3, radius * 0.45) : 0;
    if (taper > 0) {
      cylinder(`stage${i}Aft`, y + taper / 2, taper, radius * 2, bodyR * 2, mats.black);
      cylinder(`stage${i}Ring`, y + taper, taper * 0.06, bodyR * 2.06, bodyR * 2.06, mats.ring);
    }

    cylinder(
      `stage${i}`,
      y + (h + taper) / 2,
      h - taper,
      bodyR * 2,
      bodyR * 2,
      isSii || isSivb ? mats.insulation : mats.body,
    );

    if (!apollo) {
      // Generic vehicle: the original plain ring + thrust-derived bell cluster.
      cylinder(
        `ring${i}`,
        y + h,
        Math.min(radius * 0.12, h * 0.04),
        radius * 2.08,
        radius * 2.08,
        mats.ring,
      );
      const n = engineCount(stage);
      const rr = radius * (n === 1 ? 0.3 : 0.2);
      const cluster = n === 1 ? 0 : n > 4 ? radius * 0.5 : radius * 0.42;
      engineCluster(
        `bell${i}_`,
        y - rr * 0.9,
        n,
        cluster,
        rr * 0.5,
        rr * 0.95,
        rr * 1.8,
      );
    } else {
      cylinder(
        `ring${i}`,
        y + h,
        Math.min(radius * 0.12, h * 0.04),
        bodyR * 2.07,
        bodyR * 2.07,
        mats.ring,
      );
    }

    if (isSic) {
      // Black aft skirt and the S-IC black/white checkerboard paint.
      cylinder('sicSkirt', y + radius * 0.72, radius * 1.12, radius * 2.04, radius * 2.04, mats.black);
      for (let row = 0; row < 2; row++) {
        const py = y + h * (0.33 + row * 0.31);
        for (let k = 0; k < 8; k++) {
          const a = ((k + (row === 0 ? 0 : 0.5)) / 8) * TAU;
          panel(`sicPatch${row}_${k}`, a, py, h * 0.18, radius * 0.63, radius * 1.006, mats.black);
        }
      }
      cylinder('sicTopBand', y + h * 0.96, h * 0.035, radius * 2.03, radius * 2.03, mats.black);

      // Four large base fins; a box reads as a plate from every camera angle.
      const finLen = radius * 0.8;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU;
        const fin = add(
          B.MeshBuilder.CreateBox(
            `sicFin${k}`,
            { width: finLen, height: h * 0.24, depth: radius * 0.04 },
            scene,
          ),
          Math.cos(a) * (radius + finLen * 0.5),
          y + h * 0.12,
          Math.sin(a) * (radius + finLen * 0.5),
        );
        fin.rotation.y = -a;
        fin.material = mats.black;
      }

      // Five F-1 bells: one centre engine plus four around it.
      engineCluster('f1_', y + radius * 0.4, 5, radius * 0.52, radius * 0.18, radius * 0.3, radius * 0.9, true);
    }

    if (isSii) {
      // Dark interstage skirt wraps the S-II/J-2 engines at the S-IC join.
      cylinder('interstage12', y + radius * 0.05, radius * 0.5, radius * 2.05, radius * 2.05, mats.black);
      cylinder('siiSkirt', y + h * 0.06, h * 0.1, radius * 2.03, radius * 2.03, mats.black);
      cylinder('siiBand', y + h * 0.56, h * 0.028, radius * 2.02, radius * 2.02, mats.black);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        panel(`siiString${k}`, a, y + h * 0.58, h * 0.7, radius * 0.05, radius * 1.004, mats.ring);
      }
      engineCluster('j2Sii_', y + radius * 0.24, 5, radius * 0.35, radius * 0.1, radius * 0.17, radius * 0.48);
    }

    if (isSivb) {
      cylinder('sivbBand', y + taper + h * 0.42, h * 0.04, bodyR * 2.03, bodyR * 2.03, mats.black);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        panel(`sivbString${k}`, a, y + h * 0.68, h * 0.42, bodyR * 0.055, bodyR * 1.005, mats.ring);
      }
      engineCluster('j2Sivb_', y + taper * 0.4, 1, 0, bodyR * 0.16, bodyR * 0.27, bodyR * 0.7);
    }

    // Generic vehicles keep the original four radial base fins.
    if (!apollo && i === 0 && !hasStrapOn) {
      const finLen = radius * 0.8;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU;
        const fin = add(
          B.MeshBuilder.CreateBox(
            `fin${k}`,
            { width: finLen, height: h * 0.3, depth: radius * 0.012 },
            scene,
          ),
          Math.cos(a) * (radius + finLen * 0.5),
          y + h * 0.15,
          Math.sin(a) * (radius + finLen * 0.5),
        );
        fin.rotation.y = -a;
        fin.material = mats.ring;
      }
    }
    y += h;
  });

  const noseH = apollo
    ? APOLLO_PAYLOAD_HEIGHT_M / METRES_PER_UNIT
    : radius * NOSE_RADIUS_RATIO;
  if (apollo) {
    // Apollo payload lives inside the derived nose envelope: SLA / LM hint,
    // Service Module, Command Module and its blunt aft heat-shield band.
    const iuH = noseH * 0.04;
    cylinder('iu', y + iuH / 2, iuH, upperR * 2.02, upperR * 2.02, mats.black);
    cylinder('iuBand', y + iuH / 2, iuH * 0.22, upperR * 2.07, upperR * 2.07, mats.ring);

    const payloadH = noseH - iuH;
    const slaH = payloadH * 0.28;
    const smH = payloadH * 0.45;
    const cmH = payloadH * 0.23;
    const capH = payloadH * 0.04;
    const smR = upperR * 0.56;
    const slaBase = y + iuH;

    // Gold LM foil shows through the gaps between four SLA panels.
    cylinder('lmHint', slaBase + slaH / 2, slaH * 0.97, upperR * 1.9, smR * 1.9, mats.foil, 16);
    for (let k = 0; k < 4; k++) {
      const panelMesh = add(
        B.MeshBuilder.CreateCylinder(
          `slaPanel${k}`,
          {
            height: slaH * 0.95,
            diameterBottom: upperR * 2.03,
            diameterTop: smR * 2.03,
            tessellation: 6,
            arc: 0.21,
            enclose: true,
          },
          scene,
        ),
        0,
        slaBase + slaH / 2,
        0,
      );
      panelMesh.rotation.y = (k / 4) * TAU;
      panelMesh.material = mats.body;
    }
    cylinder('slaBaseRing', slaBase, slaH * 0.06, upperR * 2.08, upperR * 2.08, mats.ring);
    cylinder('slaTopRing', slaBase + slaH, slaH * 0.05, smR * 2.1, smR * 2.1, mats.ring);

    cylinder('sm', slaBase + slaH + smH / 2, smH, smR * 2, smR * 2, mats.body);
    cylinder('smBand', slaBase + slaH + smH * 0.12, smH * 0.1, smR * 2.04, smR * 2.04, mats.black);

    const cmBase = slaBase + slaH + smH;
    cylinder('cm', cmBase + cmH / 2, cmH, smR * 2, smR * 1.3, mats.body);
    cylinder('cmShield', cmBase + cmH * 0.08, cmH * 0.16, smR * 2.02, smR * 2.02, mats.dark);
    cylinder('cmCap', cmBase + cmH + capH / 2, capH, smR * 1.3, smR * 1.1, mats.ring);
  } else {
    // Generic fairing / nose cone.
    const nose = add(
      B.MeshBuilder.CreateCylinder(
        'nose',
        { height: noseH, diameterTop: 0, diameterBottom: radius * 2, tessellation: 24 },
        scene,
      ),
      0,
      y + noseH / 2,
      0,
    );
    nose.material = mats.body;
  }
  y += noseH;

  if (features.escapeSystem === 'tower' && !hasStrapOn) {
    if (apollo) {
      // LES: four struts, cross-braces and the solid escape motor.
      const mastH = radius * 1.6;
      const motorH = radius * 0.5;
      const tipH = radius * 0.2;
      const mastR = radius * 0.15;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + Math.PI / 4;
        const strut = add(
          B.MeshBuilder.CreateCylinder(
            `towerStrut${k}`,
            { height: mastH, diameter: radius * 0.018, tessellation: 6 },
            scene,
          ),
          Math.cos(a) * mastR,
          y + mastH / 2,
          Math.sin(a) * mastR,
        );
        strut.material = mats.ring;
      }
      for (const f of [0.15, 0.5, 0.85]) {
        const brace = add(
          B.MeshBuilder.CreateTorus(
            `towerBrace${f}`,
            { diameter: mastR * 2.2, thickness: radius * 0.016, tessellation: 12 },
            scene,
          ),
          0,
          y + mastH * f,
          0,
        );
        brace.material = mats.ring;
      }
      cylinder('towerMotor', y + mastH + motorH / 2, motorH, radius * 0.28, radius * 0.28, mats.dark, 12);
      cylinder('towerTip', y + mastH + motorH + tipH / 2, tipH, radius * 0.28, 0, mats.black, 12);
      y += mastH + motorH + tipH;
    } else {
      // Original slender mast + motor tip for non-Apollo vehicles.
      const mastH = radius * 1.8;
      const mast = add(
        B.MeshBuilder.CreateCylinder(
          'towerMast',
          { height: mastH, diameter: radius * 0.26, tessellation: 12 },
          scene,
        ),
        0,
        y + mastH / 2,
        0,
      );
      mast.material = mats.ring;

      const tipH = radius * 0.7;
      const tip = add(
        B.MeshBuilder.CreateCylinder(
          'towerTip',
          { height: tipH, diameterTop: 0, diameterBottom: radius * 0.5, tessellation: 12 },
          scene,
        ),
        0,
        y + mastH + tipH / 2,
        0,
      );
      tip.material = mats.dark;
      y += mastH + tipH;
    }
  }

  // Strap-on solid boosters: a symmetric pair beside stage 1. Their length
  // follows from the solid stage's propellant volume, so a 500 t SRB reads much
  // longer than a small helper motor.
  const strap = geo.strapOn;
  if (strap) {
    for (const side of [-1, 1]) {
      const booster = add(
        B.MeshBuilder.CreateCylinder(
          `booster${side}`,
          { height: strap.height, diameter: strap.radius * 2, tessellation: 18 },
          scene,
        ),
        side * strap.offset,
        strap.height / 2,
        0,
      );
      booster.material = mats.body;

      const bn = add(
        B.MeshBuilder.CreateCylinder(
          `boosterNose${side}`,
          {
            height: strap.radius * 2.2,
            diameterTop: 0,
            diameterBottom: strap.radius * 2,
            tessellation: 18,
          },
          scene,
        ),
        side * strap.offset,
        strap.height + strap.radius * 1.1,
        0,
      );
      bn.material = mats.dark;

      const bb = add(
        B.MeshBuilder.CreateCylinder(
          `boosterBell${side}`,
          {
            height: strap.radius * 1.4,
            diameterTop: strap.radius * 1.0,
            diameterBottom: strap.radius * 1.8,
            tessellation: 12,
            cap: B.Mesh.NO_CAP,
          },
          scene,
        ),
        side * strap.offset,
        -strap.radius * 0.7,
        0,
      );
      bb.material = mats.bell;
    }
    y = Math.max(y, strap.height + strap.radius * 2.2);
  }

  return { root, height: y, radius };
}
