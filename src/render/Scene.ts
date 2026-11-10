import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** km → scene units (Earth radius 6371 km renders as 63.71 units). */
const SCALE = 1 / 100;
const EARTH_RADIUS = 6371 * SCALE;
const MAX_TRAJECTORY_POINTS = 8192;

/** Camera view modes — which fixed/relative transform drives the camera. */
export type ViewMode = 'orbit' | 'chase' | 'ground' | 'cockpit' | 'overview';

export class Scene {
  private readonly enabled = typeof window !== 'undefined' && typeof document !== 'undefined';

  private readonly scene!: THREE.Scene;
  private readonly camera!: THREE.PerspectiveCamera;
  private readonly renderer!: THREE.WebGLRenderer;
  private readonly controls!: OrbitControls;
  private readonly rocket!: THREE.Mesh;
  private readonly trajectory!: THREE.Line;
  private readonly trajectoryPositions!: Float32Array;
  private trajectoryCount = 0;
  private view: ViewMode = 'orbit';
  private rocketPos = new THREE.Vector3(0, EARTH_RADIUS + 1.2, 0);
  private prevPos = new THREE.Vector3(0, EARTH_RADIUS + 1.2, 0);
  private velocity = new THREE.Vector3();
  private readonly onResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  constructor(private readonly container: HTMLElement) {
    if (!this.enabled) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070f);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200_000);
    this.camera.position.set(0, EARTH_RADIUS * 1.4, EARTH_RADIUS * 3);
    this.camera.lookAt(0, EARTH_RADIUS, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, EARTH_RADIUS, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = EARTH_RADIUS * 1.05;

    // Sun + fill light.
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(1, 0.6, 0.4).normalize().multiplyScalar(EARTH_RADIUS * 20);
    this.scene.add(sun, new THREE.AmbientLight(0x223344, 1));

    // Earth.
    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 48);
    const earth = new THREE.Mesh(
      earthGeometry,
      new THREE.MeshStandardMaterial({ color: 0x1b5fb5, roughness: 0.85, metalness: 0.05 }),
    );
    this.scene.add(earth);

    // Rocket.
    this.rocket = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 2.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.6 }),
    );
    this.rocket.position.set(0, EARTH_RADIUS + 1.2, 0);
    this.scene.add(this.rocket);

    // Trajectory line with preallocated dynamic buffer.
    this.trajectoryPositions = new Float32Array(MAX_TRAJECTORY_POINTS * 3);
    const trajectoryGeometry = new THREE.BufferGeometry();
    trajectoryGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trajectoryPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    trajectoryGeometry.setDrawRange(0, 0);
    this.trajectory = new THREE.Line(
      trajectoryGeometry,
      new THREE.LineBasicMaterial({ color: 0xffb347 }),
    );
    this.trajectory.frustumCulled = false;
    this.scene.add(this.trajectory);

    window.addEventListener('resize', this.onResize);
  }

  /** Available camera views (Chinese labels in index.html). */
  readonly views: ViewMode[] = ['orbit', 'chase', 'ground', 'cockpit', 'overview'];

  /** Advance the active camera and render one frame. */
  update(dtSec: number): void {
    if (!this.enabled) return;
    this.applyView(dtSec);
    this.renderer.render(this.scene, this.camera);
  }

  /** Switch to a camera view mode. */
  setView(mode: ViewMode): void {
    this.view = mode;
  }

  /** Position the rocket (input in km) and remember it for view framing. */
  setRocketPosition(pos: [number, number, number]): void {
    if (!this.enabled) return;
    this.rocket.position.set(pos[0] * SCALE, pos[1] * SCALE, pos[2] * SCALE);
    this.rocketPos.set(pos[0] * SCALE, pos[1] * SCALE, pos[2] * SCALE);
  }

  /** Append a point to the trajectory trail (input in km). */
  addTrajectoryPoint(pos: [number, number, number]): void {
    if (!this.enabled || this.trajectoryCount >= MAX_TRAJECTORY_POINTS) return;
    const i = this.trajectoryCount * 3;
    this.trajectoryPositions[i] = pos[0] * SCALE;
    this.trajectoryPositions[i + 1] = pos[1] * SCALE;
    this.trajectoryPositions[i + 2] = pos[2] * SCALE;
    this.trajectoryCount++;

    const attribute = this.trajectory.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    this.trajectory.geometry.setDrawRange(0, this.trajectoryCount);
  }

  /** Drive the camera from the current view mode and rocket position. */
  private applyView(dtSec: number): void {
    if (dtSec > 0) {
      this.velocity.subVectors(this.rocketPos, this.prevPos).divideScalar(dtSec);
    }
    this.prevPos.copy(this.rocketPos);

    this.controls.enabled = this.view === 'orbit';
    if (this.view === 'orbit') {
      this.controls.update();
      return;
    }

    const up = new THREE.Vector3(0, 1, 0);
    switch (this.view) {
      case 'chase': {
        // Follow from behind/above the rocket.
        const offset = new THREE.Vector3(0, 4, 14);
        this.camera.position.copy(this.rocketPos).add(offset);
        this.camera.lookAt(this.rocketPos);
        break;
      }
      case 'ground': {
        // Fixed near the launch pad, looking up at the rocket.
        this.camera.position.set(EARTH_RADIUS * 0.15, EARTH_RADIUS * 0.99, 0);
        this.camera.lookAt(this.rocketPos);
        break;
      }
      case 'cockpit': {
        // At the rocket, looking along the velocity vector.
        const look =
          this.velocity.lengthSq() > 1e-6 ? this.velocity.clone().normalize() : up.clone();
        this.camera.position.copy(this.rocketPos).addScaledVector(look, 1.5);
        this.camera.lookAt(this.rocketPos.clone().addScaledVector(look, 20));
        break;
      }
      case 'overview': {
        // Far camera framing Earth + trajectory.
        const dir = this.rocketPos.clone().normalize();
        this.camera.position
          .copy(dir.multiplyScalar(EARTH_RADIUS * 1.6))
          .add(new THREE.Vector3(EARTH_RADIUS * 0.4, EARTH_RADIUS * 0.2, EARTH_RADIUS * 0.5));
        this.camera.lookAt(0, EARTH_RADIUS * 0.5, 0);
        break;
      }
    }
  }
  dispose(): void {
    if (!this.enabled) return;
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();

    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.scene.clear();

    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
