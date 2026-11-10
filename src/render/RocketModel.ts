/**
 * Parametric rocket builder (Babylon.js): turns the selected stage stack into a
 * detailed TransformNode (multi-stage bodies, interstage rings, nozzle
 * clusters, fairing, fins, strap-on solids, launch-escape tower). Proportions
 * derive from stage masses so heavier vehicles read as bigger. Origin sits at
 * the pad (bottom of stage 1); the stack extends along +Y so the parent node
 * can align local +Y with the velocity vector.
 */
import * as B from '@babylonjs/core';
import type { StageSpec } from '../physics/RocketEquation';

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

  const masses = stages.map((s) => Math.max(1, s.dryMassKg + s.propellantMassKg));
  const total = masses.reduce((a, b) => a + b, 0) || 1;
  const radius = Math.min(0.9, Math.max(0.32, 0.28 + 0.5 * (total / 3e6) ** 0.25));

  const add = <T extends B.Mesh>(mesh: T, x: number, y: number, z: number): T => {
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    return mesh;
  };

  let y = 0;
  stages.forEach((_, i) => {
    const h = 0.5 + 1.9 * (masses[i] / total);

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
        { height: 0.06, diameter: radius * 2.08, tessellation: 24 },
        scene,
      ),
      0,
      y + h,
      0,
    );
    ring.material = mats.ring;

    // Engine bell cluster at the bottom.
    const n = Math.max(1, Math.round(radius * 5));
    const rr = radius * 0.22;
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
        Math.cos(a) * radius * 0.5,
        y - rr * 0.9,
        Math.sin(a) * radius * 0.5,
      );
      bell.material = mats.bell;
    }

    // Only the first (bottom) stage carries fins.
    if (i === 0) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const fin = add(
          B.MeshBuilder.CreateBox(
            `fin${k}`,
            { width: 0.06, height: h * 0.5, depth: radius * 1.3 },
            scene,
          ),
          Math.cos(a) * radius,
          y + h * 0.35,
          Math.sin(a) * radius,
        );
        fin.rotation.y = a;
        fin.material = mats.ring;
      }
    }
    y += h;
  });

  // Payload fairing / nose cone.
  const noseH = radius * 2.4;
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

  // Launch-escape tower.
  if (features.escapeSystem === 'tower') {
    const mast = add(
      B.MeshBuilder.CreateCylinder(
        'towerMast',
        { height: radius * 2.2, diameter: radius * 0.32, tessellation: 12 },
        scene,
      ),
      0,
      y + radius * 1.1,
      0,
    );
    mast.material = mats.ring;

    const tip = add(
      B.MeshBuilder.CreateCylinder(
        'towerTip',
        { height: radius * 0.9, diameterTop: 0, diameterBottom: radius * 0.6, tessellation: 12 },
        scene,
      ),
      0,
      y + radius * 2.2 + radius * 0.45,
      0,
    );
    tip.material = mats.dark;
    y += radius * 3.2;
  }

  // Strap-on solid boosters.
  if (features.hasSolidBooster && stages.length > 0) {
    const bh = 0.6 + 1.9 * (masses[0] / total);
    for (const side of [-1, 1]) {
      const booster = add(
        B.MeshBuilder.CreateCylinder(
          `booster${side}`,
          { height: bh, diameter: radius * 0.8, tessellation: 16 },
          scene,
        ),
        side * radius * 1.35,
        bh / 2,
        0,
      );
      booster.material = mats.body;

      const bn = add(
        B.MeshBuilder.CreateCylinder(
          `boosterNose${side}`,
          { height: radius * 0.6, diameterTop: 0, diameterBottom: radius * 0.56, tessellation: 16 },
          scene,
        ),
        side * radius * 1.35,
        -radius * 0.3,
        0,
      );
      bn.rotation.x = Math.PI;
      bn.material = mats.dark;
    }
  }

  return { root, height: y, radius };
}
