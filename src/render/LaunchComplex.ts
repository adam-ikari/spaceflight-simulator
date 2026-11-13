/**
 * Static launch complex: concrete apron, launch mount, lattice service tower,
 * swing arms, hold-down clamps and lightning masts. Built in the same scene
 * units as the vehicle (1 unit = 100 m), so the tower is roughly one vehicle
 * height tall and the pad reads at the same scale as the rocket.
 *
 * Local +Y is the surface normal. The caller positions/rotates `root` onto the
 * pad; every dimension is derived from the current vehicle height, so switching
 * between a Saturn V and a small launcher rebuilds a plausible pad.
 */
import * as B from '@babylonjs/core';

export interface LaunchComplexModel {
  root: B.TransformNode;
  /** Service arms are only attached while the vehicle is on the pad. */
  setArmsVisible(visible: boolean): void;
  dispose(): void;
}

interface Materials {
  concrete: B.StandardMaterial;
  steel: B.StandardMaterial;
  dark: B.StandardMaterial;
  accent: B.StandardMaterial;
  land: B.StandardMaterial;
}

function buildMaterials(scene: B.Scene): Materials {
  const concrete = new B.StandardMaterial('padConcrete', scene);
  concrete.diffuseColor = new B.Color3(0.36, 0.37, 0.38);
  concrete.specularColor = new B.Color3(0.035, 0.035, 0.04);

  const steel = new B.StandardMaterial('padSteel', scene);
  steel.diffuseColor = new B.Color3(0.55, 0.58, 0.62);
  steel.emissiveColor = new B.Color3(0.035, 0.04, 0.045);
  steel.specularColor = new B.Color3(0.18, 0.18, 0.2);

  const dark = new B.StandardMaterial('padDark', scene);
  dark.diffuseColor = new B.Color3(0.1, 0.11, 0.12);
  dark.specularColor = new B.Color3(0.04, 0.04, 0.04);

  const accent = new B.StandardMaterial('padAccent', scene);
  accent.diffuseColor = new B.Color3(0.82, 0.33, 0.1);
  accent.emissiveColor = new B.Color3(0.16, 0.04, 0);

  const land = new B.StandardMaterial('padLand', scene);
  land.diffuseColor = new B.Color3(0.24, 0.31, 0.2);
  land.emissiveColor = new B.Color3(0.02, 0.025, 0.015);
  land.specularColor = new B.Color3(0.01, 0.01, 0.01);

  return { concrete, steel, dark, accent, land };
}

export function buildLaunchComplex(
  scene: B.Scene,
  vehicleHeight: number,
  vehicleRadius: number,
): LaunchComplexModel {
  const h = Math.max(vehicleHeight, 0.05);
  const r = Math.max(vehicleRadius, h * 0.02);

  const root = new B.TransformNode('launchComplex', scene);
  const mats = buildMaterials(scene);

  const padRadius = Math.max(h * 0.3, r * 3);
  const apronRadius = padRadius * 2.2;
  const deckTop = h * 0.012;
  const deckThickness = h * 0.035;
  const towerHeight = h * 1.35;
  const towerWidth = Math.max(h * 0.07, r * 1.6);
  const towerOffset = padRadius * 0.78;
  const leg = Math.max(h * 0.008, r * 0.18);

  const box = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: B.StandardMaterial,
    parent: B.TransformNode = root,
  ): B.Mesh => {
    const mesh = B.MeshBuilder.CreateBox(
      name,
      { width, height, depth },
      scene,
    );
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  };

  // Concrete apron and raised launch mount.
  // A low coastal land patch so the pad does not appear to float on open ocean.
  const terrain = B.MeshBuilder.CreateCylinder(
    'padTerrain',
    {
      height: h * 0.002,
      diameter: apronRadius * 2.4,
      tessellation: 64,
    },
    scene,
  );
  terrain.parent = root;
  terrain.position.y = deckTop - h * 0.002;
  terrain.material = mats.land;
  terrain.isPickable = false;

  const apron = B.MeshBuilder.CreateCylinder(
    'padApron',
    {
      height: deckThickness * 0.55,
      diameter: apronRadius * 2,
      tessellation: 64,
    },
    scene,
  );
  apron.parent = root;
  apron.position.y = deckTop - deckThickness * 0.275;
  apron.material = mats.concrete;
  apron.isPickable = false;

  const deck = B.MeshBuilder.CreateCylinder(
    'padDeck',
    {
      height: deckThickness,
      diameter: padRadius * 2,
      tessellation: 48,
    },
    scene,
  );
  deck.parent = root;
  deck.position.y = deckTop - deckThickness / 2;
  deck.material = mats.concrete;
  deck.isPickable = false;

  // Flame trench openings on either side of the mount.
  for (const side of [-1, 1]) {
    box(
      'flameTrench',
      padRadius * 1.15,
      h * 0.004,
      padRadius * 0.24,
      0,
      deckTop + h * 0.001,
      side * padRadius * 0.28,
      mats.dark,
    );
  }

  // Launch mount ring around the engine section.
  const mount = B.MeshBuilder.CreateTorus(
    'padMount',
    {
      diameter: Math.max(r * 3.4, padRadius * 0.42),
      thickness: Math.max(h * 0.012, r * 0.25),
      tessellation: 24,
    },
    scene,
  );
  mount.parent = root;
  mount.position.y = deckTop + h * 0.002;
  mount.material = mats.steel;
  mount.isPickable = false;

  // Four hold-down clamps.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    box(
      'holdDown',
      h * 0.022,
      h * 0.024,
      h * 0.018,
      Math.cos(a) * r * 1.8,
      deckTop + h * 0.012,
      Math.sin(a) * r * 1.8,
      mats.dark,
    );
  }

  // Small pad buildings give the complex a human scale.
  box(
    'padBunker',
    h * 0.1,
    h * 0.07,
    h * 0.075,
    -apronRadius * 0.55,
    deckTop + h * 0.035,
    apronRadius * 0.55,
    mats.concrete,
  );
  box(
    'padShed',
    h * 0.06,
    h * 0.045,
    h * 0.05,
    -apronRadius * 0.7,
    deckTop + h * 0.022,
    -apronRadius * 0.6,
    mats.steel,
  );

  // Lattice service tower.
  const tower = new B.TransformNode('padTower', scene);
  tower.parent = root;
  tower.position.set(towerOffset, deckTop, 0);

  box(
    'towerFoundation',
    towerWidth * 1.7,
    h * 0.045,
    towerWidth * 1.7,
    0,
    h * 0.022,
    0,
    mats.concrete,
    tower,
  );

  const half = towerWidth / 2 - leg / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(
        'towerLeg',
        leg,
        towerHeight,
        leg,
        sx * half,
        towerHeight / 2,
        sz * half,
        mats.steel,
        tower,
      );
    }
  }

  const levels = 7;
  const segment = towerHeight / levels;
  for (let i = 0; i <= levels; i++) {
    const y = i * segment;
    for (const sz of [-1, 1]) {
      box(
        'towerRung',
        towerWidth,
        leg * 0.7,
        leg * 0.7,
        0,
        y,
        sz * half,
        mats.steel,
        tower,
      );
    }
    for (const sx of [-1, 1]) {
      box(
        'towerRung',
        leg * 0.7,
        leg * 0.7,
        towerWidth,
        sx * half,
        y,
        0,
        mats.steel,
        tower,
      );
    }
  }

  // X-bracing on the two broad faces.
  const braceLength = Math.hypot(towerWidth, segment);
  const braceAngle = Math.atan2(towerWidth, segment);
  for (let i = 0; i < levels; i++) {
    const y = (i + 0.5) * segment;
    for (const sz of [-1, 1]) {
      for (const sign of [-1, 1]) {
        const brace = box(
          'towerBrace',
          leg * 0.55,
          braceLength,
          leg * 0.55,
          0,
          y,
          sz * half,
          mats.steel,
          tower,
        );
        brace.rotation.z = sign * braceAngle;
      }
    }
  }

  // Hammerhead crane and beacon at the top.
  box(
    'towerCrane',
    towerWidth * 2.1,
    h * 0.014,
    h * 0.014,
    -towerWidth * 0.25,
    towerHeight * 0.92,
    0,
    mats.accent,
    tower,
  );
  const beacon = B.MeshBuilder.CreateSphere(
    'towerBeacon',
    { diameter: h * 0.025, segments: 8 },
    scene,
  );
  beacon.parent = tower;
  beacon.position.set(0, towerHeight, 0);
  beacon.material = mats.accent;
  beacon.isPickable = false;

  // Swing arms; hidden once the vehicle leaves the pad.
  const arms = new B.TransformNode('padArms', scene);
  arms.parent = root;
  arms.position.set(towerOffset, deckTop, 0);
  const armLength = Math.max(towerOffset - towerWidth / 2 - r, h * 0.04);
  for (const height of [h * 0.45, h * 0.72]) {
    box(
      'serviceArm',
      armLength,
      h * 0.017,
      h * 0.026,
      -towerWidth / 2 - armLength / 2,
      height,
      0,
      mats.accent,
      arms,
    );
    box(
      'serviceArmTip',
      h * 0.018,
      h * 0.038,
      h * 0.04,
      -towerOffset + r * 1.1,
      height,
      0,
      mats.accent,
      arms,
    );
  }

  // Lightning masts at the edge of the apron.
  for (const side of [-1, 1]) {
    const mast = B.MeshBuilder.CreateCylinder(
      'lightningMast',
      {
        height: towerHeight * 1.15,
        diameterTop: h * 0.004,
        diameterBottom: h * 0.009,
        tessellation: 8,
      },
      scene,
    );
    mast.parent = root;
    mast.position.set(-apronRadius * 0.7, deckTop + towerHeight * 0.575, side * apronRadius * 0.62);
    mast.material = mats.steel;
    mast.isPickable = false;
  }

  return {
    root,
    setArmsVisible(visible: boolean): void {
      arms.setEnabled(visible);
    },
    dispose(): void {
      root.dispose(false, false);
      mats.concrete.dispose();
      mats.steel.dispose();
      mats.dark.dispose();
      mats.accent.dispose();
      mats.land.dispose();
    },
  };
}
