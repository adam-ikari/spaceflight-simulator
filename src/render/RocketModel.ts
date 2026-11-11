/**
 * Parametric rocket builder (Babylon.js): turns the selected stage stack into a
 * detailed TransformNode (multi-stage bodies, interstage rings, nozzle
 * clusters, fairing, fins, strap-on solids, launch-escape tower).
 *
 * All proportions come from `vehicleGeometry` (propellant volume + fineness
 * ratio), so the mesh matches the physics data instead of hand-tuned sizes.
 * Origin sits at the pad (bottom of stage 1); the stack extends along +Y so the
 * parent node can align local +Y with the velocity vector.
 */
import * as B from '@babylonjs/core';
import type { StageSpec } from '../physics/RocketEquation';
import {
  NOSE_RADIUS_RATIO,
  computeVehicleGeometry,
  engineCount,
  splitStack,
} from './vehicleGeometry';

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
}

function buildMaterials(scene: B.Scene): Materials {
  // PBR without an IBL: keep metallic moderate so direct lights still read.
  const body = new B.PBRMaterial('bodyMat', scene);
  body.albedoColor = new B.Color3(0.91, 0.91, 0.92);
  body.metallic = 0.5;
  body.roughness = 0.42;

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

  return { body, dark, ring, bell };
}

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
  const radius = geo.radius;
  const hasStrapOn = geo.strapOn !== null;

  const add = <T extends B.Mesh>(mesh: T, x: number, y: number, z: number): T => {
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    return mesh;
  };

  let y = 0;
  stack.forEach((stage, i) => {
    const h = geo.stageHeights[i] ?? 0;
    const isFirst = i === 0;

    // Body.
    const body = add(
      B.MeshBuilder.CreateCylinder(
        `stage${i}`,
        { height: h, diameter: radius * 2, tessellation: 24 },
        scene,
      ),
      0,
      y + h / 2,
      0,
    );
    body.material = mats.body;

    // Interstage ring at the top of each stage.
    const ring = add(
      B.MeshBuilder.CreateCylinder(
        `ring${i}`,
        { height: Math.min(0.06, h * 0.04), diameter: radius * 2.08, tessellation: 24 },
        scene,
      ),
      0,
      y + h,
      0,
    );
    ring.material = mats.ring;

    // Engine bell cluster at the bottom, count from thrust per engine.
    const n = engineCount(stage);
    const rr = radius * (n === 1 ? 0.3 : 0.2);
    const cluster = n === 1 ? 0 : n > 4 ? radius * 0.5 : radius * 0.42;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const bell = add(
        B.MeshBuilder.CreateCylinder(
          `bell${i}_${k}`,
          {
            height: rr * 1.8,
            diameterTop: rr * 1.0,
            diameterBottom: rr * 1.9,
            tessellation: 12,
            cap: B.Mesh.NO_CAP,
          },
          scene,
        ),
        Math.cos(a) * cluster,
        y - rr * 0.9,
        Math.sin(a) * cluster,
      );
      bell.material = mats.bell;
    }

    // Only the first (bottom) stage carries fins: thin radial plates around the
    // base, each rotated so its long axis points away from the body.
    if (isFirst && !hasStrapOn) {
      const finLen = radius * 0.8;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const fin = add(
          B.MeshBuilder.CreateBox(
            `fin${k}`,
            { width: finLen, height: h * 0.3, depth: 0.05 },
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

  // Payload fairing / nose cone.
  const noseH = radius * NOSE_RADIUS_RATIO;
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
  y += noseH;

  // Launch-escape tower (a slender mast plus escape-motor tip). Vehicles with
  // side-mounted solids (Shuttle) never had a tower.
  if (features.escapeSystem === 'tower' && !hasStrapOn) {
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
