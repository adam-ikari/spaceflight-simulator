import * as B from '@babylonjs/core';
import { Effects } from './Effects';
import { buildLaunchComplex, type LaunchComplexModel } from './LaunchComplex';
import {
  CRUISE_MESH_SCALE,
  EARTH_RADIUS_KM,
  EARTH_RADIUS_UNITS,
  METRES_PER_UNIT,
  MOON_DISTANCE_UNITS_CRUISE,
  MOON_RADIUS_KM,
  MOON_RADIUS_UNITS,
  MOON_RADIUS_UNITS_CRUISE,
  UNITS_PER_KM,
  UNITS_PER_KM_CRUISE,
} from './sceneScale';
import { buildRocketModel, type RocketFeatures, type RocketModel } from './RocketModel';
import type { Phase } from '../director/phases';
import type { StageSpec } from '../physics/RocketEquation';

const EARTH_RADIUS = EARTH_RADIUS_UNITS;
const MAX_TRAJECTORY_POINTS = 8192;
const UP = new B.Vector3(0, 1, 0);
const WORLD_Z = new B.Vector3(0, 0, 1);
const ORIGIN = new B.Vector3(0, 0, 0);
/** Local vertical at the +X pad; the Earth centre sits at -EARTH_RADIUS on X. */
const PAD_RADIAL = new B.Vector3(1, 0, 0);
/** Phase strings that use the fine Earth-fixed launch-site view. */
const EARTH_FINE_PHASES: Record<string, true> = {
  PAD: true, LIFTOFF: true, ASCENT: true, STAGE_SEP: true, ORBIT_INSERT: true,
  ORBIT: true, PARK: true, RENDEZVOUS: true, DEORBIT: true, ENTRY: true,
  EARTH_ENTRY: true, LANDING: true, DONE: true,
};
/** Lunar approach/landing/ascent phases use the fine Moon-fixed view. */
const MOON_FINE_PHASES: Record<string, true> = {
  DESCENT: true, MOON_LANDING: true, LUNAR_LAUNCH: true,
};
/** Phases for which the launch tower belongs on screen (lunar missions only). */
const PAD_PHASES: Record<string, true> = {
  PAD: true, LIFTOFF: true, ASCENT: true, STAGE_SEP: true,
};
const LEO_PHASES: Record<string, true> = {
  PAD: true, LIFTOFF: true, ASCENT: true, STAGE_SEP: true, ORBIT_INSERT: true,
  ORBIT: true, RENDEZVOUS: true, DEORBIT: true, ENTRY: true, LANDING: true,
};
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
export type Mission = 'leo' | 'lunar';
export type LunarBody = 'EARTH' | 'MOON';
type Vec3Km = readonly [number, number, number];
type FrameScale = 'fine' | 'cruise';

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
  private readonly earthMesh!: B.Mesh;
  private moonMesh: B.Mesh | null = null;
  private marker: B.Mesh | null = null;
  private lunarSurface: B.TransformNode | null = null;
  private launchComplex: LaunchComplexModel | null = null;
  private launchComplexHeight = 0;
  private launchComplexRadius = 0;
  private readonly effects!: Effects;
  private vehicle: RocketModel | null = null;
  private vehicleHeight = 0.82;
  private vehicleRadius = 0.041;
  private phase: string = 'PAD';
  private effectPhase: Phase = 'PAD';
  private mission: Mission = 'leo';
  private frame: FrameScale = 'fine';
  private frameBody: LunarBody = 'EARTH';
  private bodyCenter = new B.Vector3(-EARTH_RADIUS, 0, 0);
  private bodyRadius = EARTH_RADIUS;
  private readonly trajectoryPositions = new Float32Array(MAX_TRAJECTORY_POINTS * 3);
  private readonly trajectoryKm = new Float64Array(MAX_TRAJECTORY_POINTS * 3);
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
  private readonly craftKm = new B.Vector3(EARTH_RADIUS_KM, 0, 0);
  private readonly prevCraftKm = new B.Vector3(EARTH_RADIUS_KM, 0, 0);
  private readonly moonKm = new B.Vector3();
  /** Reference-body centre and surface basis in real km (double precision). */
  private readonly frameCenterKm = new B.Vector3();
  private readonly frameUpKm = new B.Vector3(1, 0, 0);
  private readonly frameTanKm = new B.Vector3(0, 1, 0);
  private readonly frameBitKm = new B.Vector3(0, 0, 1);
  /** Same basis in scene coordinates; local up maps to the pad's +X. */
  private readonly frameUp = new B.Vector3(1, 0, 0);
  private readonly frameTan = new B.Vector3(0, 1, 0);
  private readonly frameBit = new B.Vector3(0, 0, 1);
  private readonly earthScene = new B.Vector3(-EARTH_RADIUS, 0, 0);
  private readonly moonScene = new B.Vector3();
  private readonly sceneMidpoint = new B.Vector3(-EARTH_RADIUS / 2, 0, 0);
  private readonly dir = new B.Vector3(1, 0, 0);
  private readonly camTan = new B.Vector3(0, 0, 1);
  private readonly camTarget = new B.Vector3();
  private readonly camCandidate = new B.Vector3();
  private readonly trajPoint = new B.Vector3();
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
    this.earthMesh = earth;
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
    if (this.frame === 'cruise' && this.mission === 'lunar') {
      this.dir.copyFrom(this.craftKm).subtractInPlace(this.prevCraftKm);
    } else {
      this.dir.copyFrom(this.rocketPos).subtractInPlace(this.prevPos);
    }
    if (this.dir.lengthSquared() > 1e-12) {
      this.dir.normalize();
    } else {
      this.dir.copyFrom(PAD_RADIAL);
    }

    const q = this.rocketRoot.rotationQuaternion;
    if (q) B.Quaternion.FromUnitVectorsToRef(UP, this.dir, q);

    this.prevPos.copyFrom(this.rocketPos);
    this.prevCraftKm.copyFrom(this.craftKm);

    this.effects.setPhase(this.effectPhase);
    this.effects.update(dtSec, this.dir);
    this.applyView(this.dir);
    this.applyAtmosphere();
    this.scene.render();
  }

  /** Set the mission phase driving engine/plume/reentry effects. */
  setPhase(phase: string): void {
    this.phase = phase;
    this.effectPhase = LEO_PHASES[phase] === true
      ? (phase as Phase)
      : phase === 'EARTH_ENTRY' ? 'ENTRY' : 'PAD';
    this.launchComplex?.setArmsVisible(phase === 'PAD');
    if (this.mission === 'lunar') {
      this.launchComplex?.root.setEnabled(
        this.frame === 'fine' && this.frameBody === 'EARTH' && PAD_PHASES[phase] === true,
      );
    }
  }

  /** Select the mission preset. LEO keeps the original pad-fixed fine view. */
  setMission(mission: Mission): void {
    if (!this.enabled || mission === this.mission) return;
    this.mission = mission;
    this.frame = 'fine';
    this.frameBody = 'EARTH';
    this.frameCenterKm.set(0, 0, 0);
    this.frameUpKm.set(1, 0, 0);
    this.frameTanKm.set(0, 1, 0);
    this.frameBitKm.set(0, 0, 1);
    this.frameUp.copyFrom(PAD_RADIAL);
    this.frameTan.copyFrom(UP);
    this.frameBit.copyFrom(WORLD_Z);
    this.bodyCenter.copyFrom(this.earthCenter);
    this.bodyRadius = EARTH_RADIUS;
    this.earthMesh.scaling.setAll(1);
    this.earthMesh.position.copyFrom(this.earthCenter);
    this.earthScene.copyFrom(this.earthCenter);
    this.marker?.setEnabled(false);
    this.lunarSurface?.setEnabled(false);
    if (this.launchAnchor.rotationQuaternion) {
      B.Quaternion.FromUnitVectorsToRef(UP, PAD_RADIAL, this.launchAnchor.rotationQuaternion);
    }
    if (mission === 'lunar') {
      this.buildLunarAssets();
      this.moonMesh?.setEnabled(false);
      this.launchComplex?.root.setEnabled(PAD_PHASES[this.phase] === true);
    } else {
      this.earthMesh.setEnabled(true);
      this.moonMesh?.setEnabled(false);
      this.launchComplex?.root.setEnabled(true);
    }
    this.setPhase(this.phase);
    this.configureOrbitCam();
    this.rebuildTrajectory();
  }

  /**
   * Place the craft and both bodies using true geocentric km. The scene unit and
   * anchor change with the phase; no physical coordinate is rescaled or faked.
   */
  setLunarFrame(
    body: LunarBody,
    craftPosKm: Vec3Km,
    moonPosKm: Vec3Km,
    phase: string,
  ): void {
    if (!this.enabled) return;
    if (this.mission !== 'lunar') this.setMission('lunar');
    this.setPhase(phase);
    this.craftKm.set(craftPosKm[0], craftPosKm[1], craftPosKm[2]);
    this.moonKm.set(moonPosKm[0], moonPosKm[1], moonPosKm[2]);

    const fine = body === 'MOON'
      ? MOON_FINE_PHASES[phase] === true
      : EARTH_FINE_PHASES[phase] === true;
    const nextScale: FrameScale = fine ? 'fine' : 'cruise';
    const nextBody: LunarBody = fine ? body : 'EARTH';
    const frameChanged = nextScale !== this.frame || nextBody !== this.frameBody;
    this.frame = nextScale;
    this.frameBody = nextBody;

    if (fine) {
      const radiusKm = body === 'MOON' ? MOON_RADIUS_KM : EARTH_RADIUS_KM;
      const centre = body === 'MOON' ? this.moonKm : ORIGIN;
      this.setFrameBasis(centre, this.craftKm);
      const radiusUnits = radiusKm * UNITS_PER_KM;
      this.bodyCenter.set(
        -this.frameUp.x * radiusUnits,
        -this.frameUp.y * radiusUnits,
        -this.frameUp.z * radiusUnits,
      );
      this.bodyRadius = radiusUnits;
      if (body === 'MOON') {
        this.moonMesh!.position.copyFrom(this.bodyCenter);
        this.earthMesh.setEnabled(false);
        this.moonMesh!.setEnabled(true);
        this.lunarSurface?.setEnabled(true);
      } else {
        this.earthMesh.position.copyFrom(this.bodyCenter);
        this.earthMesh.setEnabled(true);
        this.moonMesh?.setEnabled(false);
        this.lunarSurface?.setEnabled(false);
      }
      this.marker?.setEnabled(false);
      if (this.launchAnchor.rotationQuaternion) {
        B.Quaternion.FromUnitVectorsToRef(UP, this.frameUp, this.launchAnchor.rotationQuaternion);
      }
    } else {
      // Floating origin at the craft: both bodies are differences of true
      // geocentric km, so float32 never sees a 384,400 km absolute position.
      const u = UNITS_PER_KM_CRUISE;
      this.earthScene.set(-this.craftKm.x * u, -this.craftKm.y * u, -this.craftKm.z * u);
      this.moonScene.set(
        (this.moonKm.x - this.craftKm.x) * u,
        (this.moonKm.y - this.craftKm.y) * u,
        (this.moonKm.z - this.craftKm.z) * u,
      );
      this.earthMesh.position.copyFrom(this.earthScene);
      this.moonMesh!.position.copyFrom(this.moonScene);
      this.earthMesh.setEnabled(true);
      this.moonMesh!.setEnabled(true);
      this.marker?.setEnabled(true);
      this.lunarSurface?.setEnabled(false);
      const nearMoon = this.moonScene.lengthSquared() < this.earthScene.lengthSquared();
      this.frameUp.copyFrom(nearMoon ? this.moonScene : this.earthScene);
      if (this.frameUp.lengthSquared() < 1e-12) {
        this.frameUp.copyFrom(PAD_RADIAL);
      } else {
        this.frameUp.normalize();
      }
      this.bodyCenter.copyFrom(nearMoon ? this.moonScene : this.earthScene);
      this.bodyRadius = (nearMoon ? MOON_RADIUS_KM : EARTH_RADIUS_KM) * u;
      this.sceneMidpoint.copyFrom(this.earthScene).addInPlace(this.moonScene).scaleInPlace(0.5);
    }
    this.setRocketPosition(craftPosKm);
    this.rebuildTrajectory();
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
  setRocketPosition(pos: Vec3Km): void {
    if (!this.enabled) return;
    this.toScene(pos[0], pos[1], pos[2], this.rocketPos);
    this.rocketRoot.position.copyFrom(this.rocketPos);
  }

  /** Drop the trail when the director retransitions to a new frame. */
  clearTrajectory(): void {
    if (!this.enabled) return;
    this.trajectoryCount = 0;
    this.trajectoryPositions.fill(0);
    this.trajectory.updateVerticesData(
      B.VertexBuffer.PositionKind,
      this.trajectoryPositions,
      false,
      false,
    );
  }

  /** Append a point to the trajectory trail (input in km, Earth-centred). */
  addTrajectoryPoint(pos: Vec3Km): void {
    if (!this.enabled || this.trajectoryCount >= MAX_TRAJECTORY_POINTS) return;
    const i = this.trajectoryCount;
    this.trajectoryKm[i * 3] = pos[0];
    this.trajectoryKm[i * 3 + 1] = pos[1];
    this.trajectoryKm[i * 3 + 2] = pos[2];
    this.toScene(pos[0], pos[1], pos[2], this.trajPoint);
    const x = this.trajPoint.x;
    const y = this.trajPoint.y;
    const z = this.trajPoint.z;
    // Extend the tail with the newest point so unused vertices stay degenerate.
    for (let j = i; j < MAX_TRAJECTORY_POINTS; j++) {
      this.trajectoryPositions[j * 3] = x;
      this.trajectoryPositions[j * 3 + 1] = y;
      this.trajectoryPositions[j * 3 + 2] = z;
    }
    this.trajectoryCount++;
    this.trajectory.updateVerticesData(
      B.VertexBuffer.PositionKind,
      this.trajectoryPositions,
      false,
      false,
    );
  }

  /** Convert true geocentric km into the current floating-origin scene frame. */
  private toScene(x: number, y: number, z: number, out: B.Vector3): void {
    if (this.mission === 'leo') {
      out.set(
        x * UNITS_PER_KM + this.earthCenter.x,
        y * UNITS_PER_KM,
        z * UNITS_PER_KM,
      );
      return;
    }
    if (this.frame === 'cruise') {
      const u = UNITS_PER_KM_CRUISE;
      out.set(
        (x - this.craftKm.x) * u,
        (y - this.craftKm.y) * u,
        (z - this.craftKm.z) * u,
      );
      return;
    }
    const rx = x - this.frameCenterKm.x;
    const ry = y - this.frameCenterKm.y;
    const rz = z - this.frameCenterKm.z;
    const radiusKm = this.frameBody === 'MOON' ? MOON_RADIUS_KM : EARTH_RADIUS_KM;
    const up = this.frameUpKm;
    const tan = this.frameTanKm;
    const bit = this.frameBitKm;
    const a = rx * up.x + ry * up.y + rz * up.z - radiusKm;
    const t = rx * tan.x + ry * tan.y + rz * tan.z;
    const b = rx * bit.x + ry * bit.y + rz * bit.z;
    const u = UNITS_PER_KM;
    out.set(
      (this.frameUp.x * a + this.frameTan.x * t + this.frameBit.x * b) * u,
      (this.frameUp.y * a + this.frameTan.y * t + this.frameBit.y * b) * u,
      (this.frameUp.z * a + this.frameTan.z * t + this.frameBit.z * b) * u,
    );
  }

  /** Surface basis at the sub-craft point: up radial, tangent +Y-like, bitangent +Z-like. */
  private setFrameBasis(centre: B.Vector3, craft: B.Vector3): void {
    this.frameCenterKm.copyFrom(centre);
    this.frameUpKm.copyFrom(craft).subtractInPlace(centre);
    if (this.frameUpKm.lengthSquared() < 1e-12) {
      this.frameUpKm.copyFrom(PAD_RADIAL);
    } else {
      this.frameUpKm.normalize();
    }
    if (Math.abs(this.frameUpKm.z) < 0.9) {
      B.Vector3.CrossToRef(WORLD_Z, this.frameUpKm, this.frameTanKm);
    } else {
      B.Vector3.CrossToRef(UP, this.frameUpKm, this.frameTanKm);
    }
    this.frameTanKm.normalize();
    B.Vector3.CrossToRef(this.frameUpKm, this.frameTanKm, this.frameBitKm);
    this.frameUp.copyFrom(this.frameUpKm);
    this.frameTan.copyFrom(this.frameTanKm);
    this.frameBit.copyFrom(this.frameBitKm);
  }

  /** Apply mesh visibility, scale and camera framing after a scale/body switch. */
  private applyFrameChange(): void {
    const fine = this.frame === 'fine';
    const scale = fine ? 1 : CRUISE_MESH_SCALE;
    this.earthMesh.scaling.setAll(scale);
    this.moonMesh?.scaling.setAll(scale);
    this.marker?.setEnabled(!fine);
    this.lunarSurface?.setEnabled(fine && this.frameBody === 'MOON');
    this.vehicle?.root.setEnabled(fine && this.view !== 'cockpit');
    this.launchComplex?.root.setEnabled(
      this.mission === 'leo' ||
      (fine && this.frameBody === 'EARTH' && PAD_PHASES[this.phase] === true),
    );
    this.configureOrbitCam();
    this.rebuildTrajectory();
  }

  /** Keep the orbit rig usable at both scales without resetting it every frame. */
  private configureOrbitCam(): void {
    const fine = this.frame === 'fine';
    this.orbitCam.target.copyFrom(fine ? this.bodyCenter : this.sceneMidpoint);
    this.orbitCam.radius = fine
      ? this.bodyRadius * 2.4
      : Math.max(
          B.Vector3.Distance(this.earthScene, this.moonScene) * 1.6,
          MOON_DISTANCE_UNITS_CRUISE * 1.2,
        );
    this.orbitCam.lowerRadiusLimit = fine
      ? this.bodyRadius * 1.05
      : MOON_RADIUS_UNITS_CRUISE * 1.05;
    this.orbitCam.upperRadiusLimit = fine
      ? this.bodyRadius * 12
      : MOON_DISTANCE_UNITS_CRUISE * 8;
  }

  /** Moon, cruise marker and a curved low-poly lunar surface, built on demand. */
  private buildLunarAssets(): void {
    if (this.moonMesh) return;
    const moon = B.MeshBuilder.CreateSphere(
      'moon',
      { diameter: MOON_RADIUS_UNITS * 2, segments: 96 },
      this.scene,
    );
    const moonMat = new B.PBRMaterial('moonMat', this.scene);
    moonMat.albedoColor = new B.Color3(0.55, 0.54, 0.51);
    moonMat.metallic = 0;
    moonMat.roughness = 1;
    moon.material = moonMat;
    moon.isPickable = false;
    moon.setEnabled(false);
    this.moonMesh = moon;

    const marker = B.MeshBuilder.CreateSphere(
      'craftMarker',
      { diameter: 1.2, segments: 12 },
      this.scene,
    );
    const markerMat = new B.StandardMaterial('craftMarkerMat', this.scene);
    markerMat.disableLighting = true;
    markerMat.emissiveColor = new B.Color3(1, 0.68, 0.2);
    markerMat.diffuseColor = B.Color3.Black();
    markerMat.specularColor = B.Color3.Black();
    marker.material = markerMat;
    marker.isPickable = false;
    marker.renderingGroupId = 1;
    marker.setEnabled(false);
    this.marker = marker;

    const surface = new B.TransformNode('lunarSurface', this.scene);
    surface.parent = this.launchAnchor;
    const regolith = new B.StandardMaterial('regolithMat', this.scene);
    regolith.diffuseColor = new B.Color3(0.46, 0.45, 0.43);
    regolith.specularColor = new B.Color3(0.02, 0.02, 0.02);
    const ground = B.MeshBuilder.CreateGround(
      'lunarGround',
      { width: 320, height: 320, subdivisions: 32 },
      this.scene,
    );
    const positions = ground.getVerticesData(B.VertexBuffer.PositionKind)!;
    const normals: number[] = [];
    const indices = ground.getIndices()!;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] = this.lunarGroundY(positions[i], positions[i + 2]);
    }
    B.VertexData.ComputeNormals(positions, indices, normals);
    ground.updateVerticesData(B.VertexBuffer.PositionKind, positions);
    ground.updateVerticesData(B.VertexBuffer.NormalKind, normals);
    ground.material = regolith;
    ground.isPickable = false;
    ground.parent = surface;
    for (let i = 0; i < 16; i++) {
      const angle = i * 2.399963;
      const distance = 8 + (i % 5) * 18;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const size = 0.18 + (i % 4) * 0.12;
      const rock = B.MeshBuilder.CreateSphere(
        'lunarRock',
        { diameter: size * 2, segments: 6 },
        this.scene,
      );
      rock.scaling.set(1.3, 0.6, 1.1);
      rock.position.set(x, this.lunarGroundY(x, z) + size * 0.3, z);
      rock.material = regolith;
      rock.isPickable = false;
      rock.parent = surface;
    }
    surface.setEnabled(false);
    this.lunarSurface = surface;
  }

  /** Tangent-plane approximation of the Moon's sphere plus small relief. */
  private lunarGroundY(x: number, z: number): number {
    return (
      -(x * x + z * z) / (2 * MOON_RADIUS_UNITS) +
      0.06 * Math.sin(x * 0.21) * Math.sin(z * 0.17)
    );
  }

  /** Recompute every stored km point in the active frame (floating origin). */
  private rebuildTrajectory(): void {
    if (!this.enabled) return;
    if (this.trajectoryCount === 0) {
      this.trajectoryPositions.fill(0);
    }
    for (let i = 0; i < this.trajectoryCount; i++) {
      this.toScene(
        this.trajectoryKm[i * 3],
        this.trajectoryKm[i * 3 + 1],
        this.trajectoryKm[i * 3 + 2],
        this.trajPoint,
      );
      for (let j = i; j < MAX_TRAJECTORY_POINTS; j++) {
        this.trajectoryPositions[j * 3] = this.trajPoint.x;
        this.trajectoryPositions[j * 3 + 1] = this.trajPoint.y;
        this.trajectoryPositions[j * 3 + 2] = this.trajPoint.z;
      }
    }
    this.trajectory.updateVerticesData(
      B.VertexBuffer.PositionKind,
      this.trajectoryPositions,
      false,
      false,
    );
  }

  /** Day/night sky and distance haze for the low-altitude views. */
  private applyAtmosphere(): void {
    if (this.mission === 'lunar' && (this.frame === 'cruise' || this.frameBody === 'MOON')) {
      this.scene.clearColor = SPACE_SKY;
      this.scene.fogMode = B.Scene.FOGMODE_NONE;
      this.sky.isVisible = false;
      this.effects.setStarsVisible(true);
      return;
    }
    const radius = B.Vector3.Distance(this.rocketPos, this.bodyCenter);
    const altitudeKm = ((radius - this.bodyRadius) * METRES_PER_UNIT) / 1000;
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

  /** Radial unit vector at a scene position, relative to the active body. */
  private radialAt(pos: B.Vector3): B.Vector3 {
    return pos.subtract(this.bodyCenter).normalize();
  }

  /** Drive the camera from the current view mode and rocket position. */
  private applyView(dir: B.Vector3): void {
    // A cockpit camera would otherwise sit inside the escape tower/nose cone.
    this.vehicle?.root.setEnabled(this.frame === 'fine' && this.view !== 'cockpit');
    if (this.view === 'orbit') {
      this.scene.activeCamera = this.orbitCam;
      return;
    }
    this.scene.activeCamera = this.freeCam;
    if (this.frame === 'cruise') {
      this.applyCruiseView(dir);
      return;
    }

    const cam = this.freeCam;
    const rp = this.rocketPos;
    const h = this.vehicleHeight;
    B.Vector3.CrossToRef(this.frameUp, UP, this.camTan);
    if (this.camTan.lengthSquared() < 1e-8) {
      this.camTan.copyFrom(this.frameBit);
    } else {
      this.camTan.normalize();
    }
    this.camTarget.copyFrom(rp);
    this.camTarget.x += dir.x * h * 0.5;
    this.camTarget.y += dir.y * h * 0.5;
    this.camTarget.z += dir.z * h * 0.5;

    // Point the camera "up" along the local vertical so the horizon sits level
    // instead of glaringly rotated. The local vertical is radial.
    if (this.view === 'overview') {
      cam.upVector.copyFrom(UP);
    } else if (this.view === 'ground' || this.view === 'control') {
      cam.upVector.copyFrom(this.frameUp);
    } else {
      cam.upVector.copyFrom(this.radialAt(rp));
    }

    switch (this.view) {
      case 'chase': {
        // Follow from behind/above the rocket along its flight axis.
        const radial = this.radialAt(rp);
        const candidate = this.camTarget
          .add(this.camTan.scale(h * 6.5))
          .add(radial.scale(h * 2))
          .subtract(dir.scale(h * 1.5));
        const distance = B.Vector3.Distance(candidate, this.bodyCenter);
        if (distance < this.bodyRadius + 0.5) {
          const fix = candidate.subtract(this.bodyCenter);
          fix.normalize().scaleInPlace(this.bodyRadius + 0.5);
          candidate.copyFrom(this.bodyCenter).addInPlace(fix);
        }
        cam.position.copyFrom(candidate);
        cam.setTarget(this.camTarget);
        break;
      }
      case 'ground': {
        // Fixed beside the pad, looking up at the rocket. Altitude term is
        // radial (local up), the lateral term tangential, so the surface sits
        // at the bottom of the frame once upVector is set to the vertical.
        cam.position.copyFrom(
          this.padPos
            .add(this.camTan.scale(h * 5.6))
            .add(this.frameUp.scale(h * 0.85)),
        );
        cam.setTarget(this.camTarget);
        break;
      }
      case 'cockpit': {
        // From the nose, looking along the velocity vector.
        cam.position.copyFrom(rp.add(dir.scale(h * 0.85)));
        cam.setTarget(rp.add(dir.scale(h * 0.85 + 20)));
        break;
      }
      case 'control': {
        // Launch-control vantage beside the surface pad, tracking the rocket.
        cam.position.copyFrom(
          this.padPos
            .add(this.camTan.scale(h * 5.5))
            .add(this.frameUp.scale(h * 1.7)),
        );
        cam.setTarget(this.camTarget);
        break;
      }
      case 'overview': {
        // Far camera framing the active planet + trajectory. Target the planet,
        // not a point near its surface, so the globe fills the frame.
        cam.position.copyFrom(
          this.bodyCenter.add(
            new B.Vector3(
              this.bodyRadius * 1.55,
              this.bodyRadius * 1.0,
              this.bodyRadius * 1.55,
            ),
          ),
        );
        cam.setTarget(this.bodyCenter);
        break;
      }
    }
  }

  /** Cruise views frame the symbolic marker and the true Earth–Moon layout. */
  private applyCruiseView(dir: B.Vector3): void {
    const cam = this.freeCam;
    const h = 0.8;
    if (this.view === 'overview') {
      cam.upVector.copyFrom(UP);
      const distance = Math.max(
        B.Vector3.Distance(this.earthScene, this.moonScene),
        MOON_DISTANCE_UNITS_CRUISE,
      );
      this.camCandidate.set(1.3, 0.8, 1.1).normalize().scaleInPlace(distance * 1.4);
      cam.position.copyFrom(this.sceneMidpoint).addInPlace(this.camCandidate);
      cam.setTarget(this.sceneMidpoint);
      return;
    }
    B.Vector3.CrossToRef(this.frameUp, UP, this.camTan);
    if (this.camTan.lengthSquared() < 1e-8) {
      this.camTan.copyFrom(WORLD_Z);
    } else {
      this.camTan.normalize();
    }
    cam.upVector.copyFrom(this.frameUp);
    const up = this.frameUp;
    switch (this.view) {
      case 'chase':
        this.camCandidate.set(
          -dir.x * h * 6 + up.x * h * 2,
          -dir.y * h * 6 + up.y * h * 2,
          -dir.z * h * 6 + up.z * h * 2,
        );
        cam.position.copyFrom(this.camCandidate);
        cam.setTarget(this.rocketPos);
        break;
      case 'ground':
      case 'control': {
        const lateral = this.view === 'ground' ? 5.6 : 5.5;
        const rise = this.view === 'ground' ? 0.85 : 1.7;
        this.camCandidate.set(
          this.camTan.x * h * lateral + up.x * h * rise,
          this.camTan.y * h * lateral + up.y * h * rise,
          this.camTan.z * h * lateral + up.z * h * rise,
        );
        cam.position.copyFrom(this.camCandidate);
        cam.setTarget(this.rocketPos);
        break;
      }
      case 'cockpit':
        this.camCandidate.set(dir.x * h * 0.6, dir.y * h * 0.6, dir.z * h * 0.6);
        cam.position.copyFrom(this.camCandidate);
        this.camCandidate.set(dir.x * h * 6, dir.y * h * 6, dir.z * h * 6);
        cam.setTarget(this.camCandidate);
        break;
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
