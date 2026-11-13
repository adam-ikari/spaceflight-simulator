import * as B from '@babylonjs/core';
import { Effects } from './Effects';
import { buildLaunchComplex, type LaunchComplexModel } from './LaunchComplex';
import { EARTH_RADIUS_UNITS, METRES_PER_UNIT, UNITS_PER_KM } from './sceneScale';
import { buildRocketModel, type RocketFeatures, type RocketModel } from './RocketModel';
import type { Phase } from '../director/phases';
import type { StageSpec } from '../physics/RocketEquation';

const EARTH_RADIUS = EARTH_RADIUS_UNITS;
const MAX_TRAJECTORY_POINTS = 8192;
const UP = new B.Vector3(0, 1, 0);
/** Local vertical at the +X pad; the Earth centre sits at -EARTH_RADIUS on X. */
const PAD_RADIAL = new B.Vector3(1, 0, 0);
const STAR_MIN_RADIUS = EARTH_RADIUS * 6;
const STAR_MAX_RADIUS = EARTH_RADIUS * 10;
const FAR_PLANE = 1_000_000;
const SPACE_SKY = new B.Color4(0.02, 0.027, 0.058, 1);
const DAY_SKY = new B.Color4(0.33, 0.55, 0.82, 1);

/** Fallback vehicle shown until the designer pushes the first archetype. */
const DEFAULT_STAGES: StageSpec[] = [
  {
    propellantId: 'LOX_RP1',
    ofRatio: 2.56,
    pcMPa: 10,
    expansionRatio: 25,
    propellantMassKg: 400_000,
    dryMassKg: 25_000,
    thrustN: 4_000_000,
  },
];

/** Camera view modes — which fixed/relative transform drives the camera. */
export type ViewMode = 'orbit' | 'chase' | 'ground' | 'cockpit' | 'overview' | 'control';

export class Scene {
  private readonly enabled = typeof window !== 'undefined' && typeof document !== 'undefined';

  private readonly engine!: B.Engine;
  private readonly scene!: B.Scene;
  private readonly canvas!: HTMLCanvasElement;
  private readonly orbitCam!: B.ArcRotateCamera;
  private readonly freeCam!: B.FreeCamera;
  private readonly rocketRoot!: B.TransformNode;
  private readonly launchAnchor!: B.TransformNode;
  private readonly sky!: B.Mesh;
  private launchComplex: LaunchComplexModel | null = null;
  private launchComplexHeight = 0;
  private launchComplexRadius = 0;
  private readonly effects!: Effects;
  private vehicle: RocketModel | null = null;
  private vehicleHeight = 0.82;
  private vehicleRadius = 0.041;
  private phase: Phase = 'PAD';
  private readonly trajectoryPositions = new Float32Array(MAX_TRAJECTORY_POINTS * 3);
  private trajectory!: B.LinesMesh;
  private trajectoryCount = 0;
  private view: ViewMode = 'control';
  /**
   * Floating origin: the pad is (0,0,0) and the Earth centre is -R on X. Keeping
   * the launch site near the origin preserves float32 precision for an 80 m
   * vehicle on a 6,371 km planet.
   */
  private readonly earthCenter = new B.Vector3(-EARTH_RADIUS, 0, 0);
  private readonly rocketPos = new B.Vector3(0, 0, 0);
  private readonly prevPos = new B.Vector3(0, 0, 0);
  private readonly padPos = new B.Vector3(0, 0, 0);
  private readonly onResize = (): void => {
    if (!this.enabled) return;
    this.engine.resize();
  };

  constructor(private readonly container: HTMLElement) {
    if (!this.enabled) return;

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.outline = 'none';
    container.appendChild(this.canvas);

    this.engine = new B.Engine(this.canvas, true, {
      antialias: true,
      stencil: true,
      preserveDrawingBuffer: true,
    });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
    this.engine.resize();

    this.scene = new B.Scene(this.engine);
    this.scene.clearColor = SPACE_SKY;

    // Sun + ambient fill.
    const hemi = new B.HemisphericLight('ambient', new B.Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.65;
    hemi.groundColor = new B.Color3(0.05, 0.08, 0.14);
    const sunDir = new B.Vector3(-1, -0.7, -0.5).normalize();
    const sun = new B.DirectionalLight('sun', sunDir, this.scene);
    sun.intensity = 2.2;
    // Direction points from the light into the scene; put the source above the
    // +X pad so the local surface and tower face are lit.
    sun.position = this.earthCenter.subtract(sunDir.scale(EARTH_RADIUS * 2));

    // Earth (centre at -R on X, radius 6371 km in scene units).
    const earth = B.MeshBuilder.CreateSphere(
      'earth',
      { diameter: EARTH_RADIUS * 2, segments: 192 },
      this.scene,
    );
    earth.position.copyFrom(this.earthCenter);
    earth.isPickable = false;
    const earthMat = new B.PBRMaterial('earthMat', this.scene);
    earthMat.albedoColor = new B.Color3(0.11, 0.32, 0.58);
    earthMat.metallic = 0;
    earthMat.roughness = 0.9;
    earth.material = earthMat;

    // Sky dome: emissive vertical gradient, hidden in space views.
    const sky = B.MeshBuilder.CreateSphere(
      'sky',
      { diameter: FAR_PLANE * 1.2, segments: 32 },
      this.scene,
    );
    sky.isPickable = false;
    sky.applyFog = false;
    const skyTex = new B.DynamicTexture('skyGradient', { width: 4, height: 256 }, this.scene, false);
    const ctx = skyTex.getContext() as unknown as CanvasRenderingContext2D;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#3f78bb');
    gradient.addColorStop(0.46, '#cfe3f4');
    gradient.addColorStop(0.54, '#cfe3f4');
    gradient.addColorStop(1, '#3f78bb');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
    skyTex.update();
    const skyMat = new B.StandardMaterial('skyMat', this.scene);
    skyMat.disableLighting = true;
    skyMat.emissiveTexture = skyTex;
    skyMat.emissiveColor = new B.Color3(0, 0, 0);
    skyMat.diffuseColor = new B.Color3(0, 0, 0);
    skyMat.specularColor = new B.Color3(0, 0, 0);
    skyMat.backFaceCulling = false;
    sky.material = skyMat;
    this.sky = sky;

    // Cameras: one orbit rig, one free rig for the fixed/relative views.
    this.freeCam = new B.FreeCamera('free', new B.Vector3(0, 3, 10), this.scene);
    this.freeCam.minZ = 0.01;
    this.freeCam.maxZ = FAR_PLANE;
    this.freeCam.fov = 0.9;
    this.freeCam.setTarget(this.padPos);

    this.orbitCam = new B.ArcRotateCamera(
      'orbit',
      -Math.PI / 2,
      Math.PI / 3,
      EARTH_RADIUS * 2.4,
      this.earthCenter.clone(),
      this.scene,
    );
    this.orbitCam.minZ = 0.1;
    this.orbitCam.maxZ = FAR_PLANE;
    this.orbitCam.lowerRadiusLimit = EARTH_RADIUS * 1.05;
    this.orbitCam.upperRadiusLimit = EARTH_RADIUS * 12;
    this.orbitCam.wheelDeltaPercentage = 0.02;
    this.scene.activeCamera = this.freeCam;

    // Rocket root: position = director position, local +Y = velocity.
    this.rocketRoot = new B.TransformNode('rocketRoot', this.scene);
    this.rocketRoot.rotationQuaternion = B.Quaternion.Identity();
    this.rocketRoot.position.copyFrom(this.rocketPos);

    // Launch complex anchor: local +Y is the pad's radial normal.
    this.launchAnchor = new B.TransformNode('launchAnchor', this.scene);
    this.launchAnchor.position.copyFrom(this.padPos);
    this.launchAnchor.rotationQuaternion = B.Quaternion.FromUnitVectorsToRef(
      UP,
      PAD_RADIAL,
      new B.Quaternion(),
    );

    this.effects = new Effects(this.scene, this.padPos, STAR_MIN_RADIUS, STAR_MAX_RADIUS);
    this.setVehicle(DEFAULT_STAGES, { escapeSystem: 'tower', hasSolidBooster: false });

    // Trajectory trail (preallocated, degenerate tail hidden on the first point).
    const initial = new Array<B.Vector3>(MAX_TRAJECTORY_POINTS);
    for (let i = 0; i < MAX_TRAJECTORY_POINTS; i++) initial[i] = new B.Vector3(0, 0, 0);
    this.trajectory = B.MeshBuilder.CreateLines(
      'trajectory',
      { points: initial, updatable: true },
      this.scene,
    );
    this.trajectory.color = new B.Color3(1, 0.7, 0.28);
    this.trajectory.isPickable = false;
    this.trajectory.alwaysSelectAsActiveMesh = true;

    window.addEventListener('resize', this.onResize);
  }

  /** Available camera views (Chinese labels in index.html). */
  readonly views: ViewMode[] = ['control', 'orbit', 'chase', 'ground', 'cockpit', 'overview'];

  update(dtSec: number): void {
    if (!this.enabled) return;
    const dir = this.rocketPos.subtract(this.prevPos);
    if (dir.lengthSquared() > 1e-12) {
      dir.normalize();
    } else {
      dir.copyFrom(PAD_RADIAL);
    }

    const q = this.rocketRoot.rotationQuaternion;
    if (q) B.Quaternion.FromUnitVectorsToRef(UP, dir, q);

    this.prevPos.copyFrom(this.rocketPos);

    this.effects.setPhase(this.phase);
    this.effects.update(dtSec, dir);
    this.applyView(dir);
    this.applyAtmosphere();
    this.scene.render();
  }

  /** Set the mission phase driving engine/plume/reentry effects. */
  setPhase(phase: Phase): void {
    this.phase = phase;
    this.launchComplex?.setArmsVisible(phase === 'PAD');
  }

  /** Switch to a camera view mode. */
  setView(mode: ViewMode): void {
    this.view = mode;
    if (!this.enabled) return;
    if (mode === 'orbit') {
      this.scene.activeCamera = this.orbitCam;
      this.orbitCam.attachControl(false);
    } else {
      this.orbitCam.detachControl();
      this.scene.activeCamera = this.freeCam;
    }
  }

  /** Position the rocket (input in km, Earth-centred) and remember it for framing. */
  setRocketPosition(pos: [number, number, number]): void {
    if (!this.enabled) return;
    this.rocketPos.set(
      pos[0] * UNITS_PER_KM + this.earthCenter.x,
      pos[1] * UNITS_PER_KM,
      pos[2] * UNITS_PER_KM,
    );
    this.rocketRoot.position.copyFrom(this.rocketPos);
  }

  /** Append a point to the trajectory trail (input in km, Earth-centred). */
  addTrajectoryPoint(pos: [number, number, number]): void {
    if (!this.enabled || this.trajectoryCount >= MAX_TRAJECTORY_POINTS) return;
    const x = pos[0] * UNITS_PER_KM + this.earthCenter.x;
    const y = pos[1] * UNITS_PER_KM;
    const z = pos[2] * UNITS_PER_KM;
    // Extend the tail with the newest point so unused vertices stay degenerate.
    for (let i = this.trajectoryCount; i < MAX_TRAJECTORY_POINTS; i++) {
      this.trajectoryPositions[i * 3] = x;
      this.trajectoryPositions[i * 3 + 1] = y;
      this.trajectoryPositions[i * 3 + 2] = z;
    }
    this.trajectoryCount++;
    this.trajectory.updateVerticesData(
      B.VertexBuffer.PositionKind,
      this.trajectoryPositions,
      false,
      false,
    );
  }

  /** Day/night sky and distance haze for the low-altitude views. */
  private applyAtmosphere(): void {
    const radius = B.Vector3.Distance(this.rocketPos, this.earthCenter);
    const altitudeKm = ((radius - EARTH_RADIUS) * METRES_PER_UNIT) / 1000;
    const low =
      this.view === 'control' ||
      this.view === 'ground' ||
      this.view === 'chase' ||
      this.view === 'cockpit';
    const daylight = low && altitudeKm < 80;
    this.scene.clearColor = daylight ? DAY_SKY : SPACE_SKY;
    this.scene.fogMode = daylight ? B.Scene.FOGMODE_EXP2 : B.Scene.FOGMODE_NONE;
    this.scene.fogColor = new B.Color3(0.72, 0.84, 0.94);
    this.scene.fogDensity = 0.0008;
    this.sky.isVisible = daylight;
    this.effects.setStarsVisible(!daylight);
  }

  /** Rebuild the detailed vehicle model from the designer's stage stack. */
  setVehicle(stages: StageSpec[], features: RocketFeatures): void {
    if (!this.enabled) return;
    if (this.vehicle) this.vehicle.root.dispose(false, true);

    const model = buildRocketModel(this.scene, stages, features);
    model.root.parent = this.rocketRoot;
    // Builder origin is the base; lift it onto the pad deck (1.2% of height).
    model.root.position.y = model.height * 0.012;
    this.vehicle = model;
    this.vehicleHeight = model.height;
    this.vehicleRadius = model.radius;

    this.rebuildLaunchComplex();
    this.effects.attachRocket(this.rocketRoot, model.root, model.radius, model.height);
  }

  /** Rebuild only when the stack size has changed enough to matter visually. */
  private rebuildLaunchComplex(): void {
    const h = this.vehicleHeight;
    const r = this.vehicleRadius;
    if (
      this.launchComplex &&
      Math.abs(h - this.launchComplexHeight) < h * 0.01 &&
      Math.abs(r - this.launchComplexRadius) < r * 0.02
    ) {
      return;
    }
    this.launchComplex?.dispose();
    const complex = buildLaunchComplex(this.scene, h, r);
    complex.root.parent = this.launchAnchor;
    complex.setArmsVisible(this.phase === 'PAD');
    this.launchComplex = complex;
    this.launchComplexHeight = h;
    this.launchComplexRadius = r;
  }

  /** Radial unit vector at a scene position (Earth-centred, relative to pad). */
  private radialAt(pos: B.Vector3): B.Vector3 {
    return pos.subtract(this.earthCenter).normalize();
  }

  /** Drive the camera from the current view mode and rocket position. */
  private applyView(dir: B.Vector3): void {
    // A cockpit camera would otherwise sit inside the escape tower/nose cone.
    this.vehicle?.root.setEnabled(this.view !== 'cockpit');
    if (this.view === 'orbit') {
      this.scene.activeCamera = this.orbitCam;
      return;
    }
    this.scene.activeCamera = this.freeCam;

    const cam = this.freeCam;
    const rp = this.rocketPos;
    const h = this.vehicleHeight;
    // Pad tangent frame (pad sits at the origin, local up is +X).
    const tan = B.Vector3.Cross(PAD_RADIAL, UP).normalize();
    const center = rp.add(dir.scale(h * 0.5));

    // Point the camera "up" along the local vertical so the horizon sits level
    // instead of glaringly rotated. The local vertical is radial.
    if (this.view === 'overview') {
      cam.upVector.copyFrom(UP);
    } else if (this.view === 'ground' || this.view === 'control') {
      cam.upVector.copyFrom(PAD_RADIAL);
    } else {
      cam.upVector.copyFrom(this.radialAt(rp));
    }

    switch (this.view) {
      case 'chase': {
        // Follow from behind/above the rocket along its flight axis.
        const radial = this.radialAt(rp);
        const candidate = center
          .add(tan.scale(h * 6.5))
          .add(radial.scale(h * 2))
          .subtract(dir.scale(h * 1.5));
        const distance = B.Vector3.Distance(candidate, this.earthCenter);
        if (distance < EARTH_RADIUS + 0.5) {
          const fix = candidate.subtract(this.earthCenter);
          fix.normalize().scaleInPlace(EARTH_RADIUS + 0.5);
          candidate.copyFrom(this.earthCenter).addInPlace(fix);
        }
        cam.position.copyFrom(candidate);
        cam.setTarget(center);
        break;
      }
      case 'ground': {
        // Fixed beside the pad, looking up at the rocket. Altitude term is
        // radial (local up), the lateral term tangential, so the surface sits
        // at the bottom of the frame once upVector is set to the vertical.
        cam.position.copyFrom(
          this.padPos
            .add(tan.scale(h * 5.6))
            .add(PAD_RADIAL.scale(h * 0.85)),
        );
        cam.setTarget(center);
        break;
      }
      case 'cockpit': {
        // From the nose, looking along the velocity vector.
        cam.position.copyFrom(rp.add(dir.scale(h * 0.85)));
        cam.setTarget(rp.add(dir.scale(h * 0.85 + 20)));
        break;
      }
      case 'control': {
        // Launch-control vantage beside the +X surface pad, tracking the rocket.
        cam.position.copyFrom(
          this.padPos
            .add(tan.scale(h * 5.5))
            .add(PAD_RADIAL.scale(h * 1.7)),
        );
        cam.setTarget(center);
        break;
      }
      case 'overview': {
        // Far camera framing Earth + trajectory. Target the planet, not a point
        // near its surface, so the globe fills the frame.
        cam.position.copyFrom(
          this.earthCenter.add(
            new B.Vector3(EARTH_RADIUS * 1.55, EARTH_RADIUS * 1.0, EARTH_RADIUS * 1.55),
          ),
        );
        cam.setTarget(this.earthCenter);
        break;
      }
    }
  }

  dispose(): void {
    if (!this.enabled) return;
    window.removeEventListener('resize', this.onResize);
    this.orbitCam.detachControl();
    this.launchComplex?.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}
