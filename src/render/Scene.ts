import * as B from '@babylonjs/core';
import { Effects } from './Effects';
import { buildRocketModel, type RocketFeatures, type RocketModel } from './RocketModel';
import type { Phase } from '../director/phases';
import type { StageSpec } from '../physics/RocketEquation';

/** km → scene units (Earth radius 6371 km renders as 63.71 units). */
const SCALE = 1 / 100;
const EARTH_RADIUS = 6371 * SCALE;
const MAX_TRAJECTORY_POINTS = 8192;
const UP = new B.Vector3(0, 1, 0);

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
  private readonly effects!: Effects;
  private vehicle: RocketModel | null = null;
  private vehicleHeight = 4;
  private phase: Phase = 'PAD';
  private readonly trajectoryPositions = new Float32Array(MAX_TRAJECTORY_POINTS * 3);
  private trajectory!: B.LinesMesh;
  private trajectoryCount = 0;
  private view: ViewMode = 'control';
  private readonly rocketPos = new B.Vector3(EARTH_RADIUS, 0, 0);
  private readonly prevPos = new B.Vector3(EARTH_RADIUS, 0, 0);
  private readonly padPos = new B.Vector3(EARTH_RADIUS, 0, 0);
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
    this.scene.clearColor = new B.Color4(0.02, 0.027, 0.058, 1);

    // Sun + ambient fill.
    const hemi = new B.HemisphericLight('ambient', new B.Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.65;
    hemi.groundColor = new B.Color3(0.05, 0.08, 0.14);
    const sun = new B.DirectionalLight('sun', new B.Vector3(1, 0.6, 0.4), this.scene);
    sun.intensity = 2.2;
    sun.position = new B.Vector3(1, 0.6, 0.4).normalize().scale(EARTH_RADIUS * 20);

    // Earth (centre at origin, radius = 6371 km scaled).
    const earth = B.MeshBuilder.CreateSphere(
      'earth',
      { diameter: EARTH_RADIUS * 2, segments: 48 },
      this.scene,
    );
    const earthMat = new B.PBRMaterial('earthMat', this.scene);
    earthMat.albedoColor = new B.Color3(0.11, 0.37, 0.71);
    earthMat.metallic = 0;
    earthMat.roughness = 0.88;
    earth.material = earthMat;

    // Cameras: one orbit rig, one free rig for the fixed/relative views.
    this.freeCam = new B.FreeCamera(
      'free',
      new B.Vector3(EARTH_RADIUS * 1.6, EARTH_RADIUS * 0.3, EARTH_RADIUS * 2.2),
      this.scene,
    );
    this.freeCam.minZ = 0.1;
    this.freeCam.maxZ = 200_000;
    this.freeCam.fov = 0.9;
    this.freeCam.setTarget(this.padPos);

    this.orbitCam = new B.ArcRotateCamera(
      'orbit',
      -Math.PI / 2,
      Math.PI / 3,
      EARTH_RADIUS * 3,
      this.padPos.clone(),
      this.scene,
    );
    this.orbitCam.minZ = 0.1;
    this.orbitCam.maxZ = 200_000;
    this.orbitCam.lowerRadiusLimit = EARTH_RADIUS * 1.05;
    this.orbitCam.upperRadiusLimit = EARTH_RADIUS * 12;
    this.orbitCam.wheelDeltaPercentage = 0.02;
    this.scene.activeCamera = this.freeCam;

    // Rocket root: position = director position, local +Y = velocity.
    this.rocketRoot = new B.TransformNode('rocketRoot', this.scene);
    this.rocketRoot.rotationQuaternion = B.Quaternion.Identity();
    this.rocketRoot.position.copyFrom(this.rocketPos);

    this.effects = new Effects(this.scene, this.padPos);
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
    if (dir.lengthSquared() > 1e-8) {
      dir.normalize();
    } else {
      dir.copyFrom(this.rocketPos).normalize();
      if (dir.lengthSquared() < 1e-8) dir.copyFrom(UP);
    }

    const q = this.rocketRoot.rotationQuaternion;
    if (q) B.Quaternion.FromUnitVectorsToRef(UP, dir, q);

    this.prevPos.copyFrom(this.rocketPos);

    this.effects.setPhase(this.phase);
    this.effects.update(dtSec, dir);
    this.applyView(dir);
    this.scene.render();
  }

  /** Set the mission phase driving engine/plume/reentry effects. */
  setPhase(phase: Phase): void {
    this.phase = phase;
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

  /** Position the rocket (input in km) and remember it for view framing. */
  setRocketPosition(pos: [number, number, number]): void {
    if (!this.enabled) return;
    this.rocketPos.set(pos[0] * SCALE, pos[1] * SCALE, pos[2] * SCALE);
    this.rocketRoot.position.copyFrom(this.rocketPos);
  }

  /** Append a point to the trajectory trail (input in km). */
  addTrajectoryPoint(pos: [number, number, number]): void {
    if (!this.enabled || this.trajectoryCount >= MAX_TRAJECTORY_POINTS) return;
    const x = pos[0] * SCALE;
    const y = pos[1] * SCALE;
    const z = pos[2] * SCALE;
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

  /** Rebuild the detailed vehicle model from the designer's stage stack. */
  setVehicle(stages: StageSpec[], features: RocketFeatures): void {
    if (!this.enabled) return;
    if (this.vehicle) this.vehicle.root.dispose(false, true);

    const model = buildRocketModel(this.scene, stages, features);
    model.root.parent = this.rocketRoot;
    // Builder origin is the base: the stack grows outward from the pad point.
    this.vehicle = model;
    this.vehicleHeight = model.height;

    this.effects.attachRocket(this.rocketRoot, model.root, model.radius, model.height);
  }

  /** Drive the camera from the current view mode and rocket position. */
  private applyView(dir: B.Vector3): void {
    if (this.view === 'orbit') {
      this.scene.activeCamera = this.orbitCam;
      return;
    }
    this.scene.activeCamera = this.freeCam;

    const cam = this.freeCam;
    const rp = this.rocketPos;
    const h = this.vehicleHeight;
    // Pad tangent frame (pad sits on the +X surface).
    const padRadial = this.padPos.clone().normalize();
    const tan = B.Vector3.Cross(padRadial, UP).normalize();
    const up = B.Vector3.Cross(tan, padRadial).normalize();
    const center = rp.add(dir.scale(h * 0.5));

    switch (this.view) {
      case 'chase': {
        // Follow from behind/above the rocket along its flight axis.
        const radial = rp.clone().normalize();
        const candidate = center
          .add(radial.scale(h * 1.8))
          .subtract(dir.scale(h * 1.2))
          .add(tan.scale(h * 0.8));
        const len = candidate.length();
        if (len < EARTH_RADIUS + 0.5) {
          candidate.scaleInPlace((EARTH_RADIUS + 0.5) / (len || 1));
        }
        cam.position.copyFrom(candidate);
        cam.setTarget(center);
        break;
      }
      case 'ground': {
        // Fixed beside the pad, looking up at the rocket.
        cam.position.copyFrom(
          this.padPos
            .add(tan.scale(h * 1.6))
            .add(up.scale(h * 0.2))
            .add(padRadial.scale(h * 0.15)),
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
            .add(tan.scale(h * 1.2))
            .add(up.scale(h * 0.5))
            .add(padRadial.scale(h * 0.2)),
        );
        cam.setTarget(center);
        break;
      }
      case 'overview': {
        // Far camera framing Earth + trajectory.
        const target = center.scale(0.5);
        cam.position.copyFrom(
          target.add(
            new B.Vector3(EARTH_RADIUS * 1.8, EARTH_RADIUS * 0.9, EARTH_RADIUS * 1.8),
          ),
        );
        cam.setTarget(target);
        break;
      }
    }
  }

  dispose(): void {
    if (!this.enabled) return;
    window.removeEventListener('resize', this.onResize);
    this.orbitCam.detachControl();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}
