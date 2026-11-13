/**
 * Phase-driven visual effects for the mission scene (Babylon.js): engine plume,
 * liftoff smoke, stage-separation debris, reentry plasma glow and a static
 * starfield. The plume is parented to the vehicle base so it inherits the
 * rocket's velocity orientation via a local particle system.
 */
import * as B from '@babylonjs/core';
import type { Phase } from '../director/phases';

const POWERED: Partial<Record<Phase, true>> = {
  LIFTOFF: true,
  ASCENT: true,
  ORBIT_INSERT: true,
};
const STAR_MAX = 2200;
const SMOKE_MAX = 900;
const DEBRIS_LIFE = 2.5;

interface Debris {
  mesh: B.Mesh;
  vel: B.Vector3;
  life: number;
}

export class Effects {
  private readonly enabled =
    typeof window !== 'undefined' && typeof document !== 'undefined';

  private phase: Phase = 'PAD';
  private clock = 0;
  private radius = 0.6;
  private height = 0.82;

  private tex?: B.DynamicTexture;
  private plume?: B.ParticleSystem;
  private plumeEmitter?: B.Mesh;
  private smoke?: B.ParticleSystem;
  private readonly smokeEmitter = new B.Vector3();
  private reentry?: B.Mesh;
  private reentryMat?: B.StandardMaterial;
  private stars?: B.Mesh;
  private rocketRoot?: B.TransformNode;
  private readonly debris: Debris[] = [];
  private sepSpawned = false;

  constructor(
    private readonly scene: B.Scene,
    private readonly padPos = new B.Vector3(0, 0, 0),
    private readonly starMinRadius = 600,
    private readonly starMaxRadius = 1800,
  ) {
    if (!this.enabled) return;
    this.buildStars();
    this.buildSmoke();
  }

  /** Rebuild the plume/reentry rig for the current vehicle model. */
  attachRocket(rocketRoot: B.TransformNode, base: B.TransformNode, radius: number, height: number): void {
    if (!this.enabled) return;
    this.rocketRoot = rocketRoot;
    this.radius = radius;
    this.height = height;

    // Plume emitter: invisible zero-size mesh at the nozzle (model y = 0).
    this.plume?.dispose(false);
    this.plume = undefined;
    this.plumeEmitter?.dispose();
    this.plumeEmitter = undefined;

    const emitter = B.MeshBuilder.CreateSphere(
      'plumeEmitter',
      { diameter: 0.001, segments: 4 },
      this.scene,
    );
    emitter.parent = base;
    emitter.position.set(0, 0, 0);
    emitter.isVisible = false;
    emitter.isPickable = false;
    this.plumeEmitter = emitter;

    const ps = new B.ParticleSystem('plume', 1400, this.scene);
    ps.particleTexture = this.tex ?? null;
    ps.emitter = emitter;
    ps.isLocal = true;
    ps.minEmitBox = new B.Vector3(-radius * 0.25, 0, -radius * 0.25);
    ps.maxEmitBox = new B.Vector3(radius * 0.25, 0, radius * 0.25);
    ps.direction1 = new B.Vector3(-0.18, -1, -0.18);
    ps.direction2 = new B.Vector3(0.18, -1, 0.18);
    ps.minEmitPower = height * 5;
    ps.maxEmitPower = height * 9;
    ps.minSize = radius * 0.5;
    ps.maxSize = radius * 2.2;
    ps.minLifeTime = 0.18;
    ps.maxLifeTime = 0.5;
    ps.emitRate = 0;
    ps.gravity = new B.Vector3(0, 0, 0);
    ps.color1 = new B.Color4(1, 0.95, 0.7, 1);
    ps.color2 = new B.Color4(1, 0.6, 0.2, 1);
    ps.colorDead = new B.Color4(0.35, 0.12, 0, 0);
    ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    ps.updateSpeed = 0.02;
    ps.start();
    this.plume = ps;

    // Liftoff smoke is sized from the stack, not from absolute scene units, so
    // a small launcher does not disappear under a Saturn-sized cloud.
    if (this.smoke) {
      this.smoke.minEmitBox.set(-radius * 4, -radius * 1.5, -radius * 4);
      this.smoke.maxEmitBox.set(radius * 4, radius * 1.5, radius * 4);
      this.smoke.minEmitPower = height * 2;
      this.smoke.maxEmitPower = height * 5;
      this.smoke.minSize = height * 0.8;
      this.smoke.maxSize = height * 3;
    }

    // Reentry plasma shell around the whole vehicle centre.
    this.reentry?.dispose();
    this.reentry = undefined;
    const shell = B.MeshBuilder.CreateSphere(
      'reentryShell',
      { diameter: Math.max(height * 1.05, radius * 3), segments: 16 },
      this.scene,
    );
    shell.parent = rocketRoot;
    shell.position.y = height / 2;
    shell.isVisible = false;
    shell.isPickable = false;
    const mat = new B.StandardMaterial('reentryMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new B.Color3(1, 0.33, 0.13);
    mat.alpha = 0.35;
    mat.alphaMode = B.Engine.ALPHA_ADD;
    mat.backFaceCulling = false;
    shell.material = mat;
    this.reentry = shell;
    this.reentryMat = mat;
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
  }

  /** Stars are hidden in the daytime sky; space views keep them. */
  setStarsVisible(visible: boolean): void {
    if (this.stars) this.stars.isVisible = visible;
  }

  /** Called once per frame. `velocityDir` is the rocket's normalised axis. */
  update(dt: number, velocityDir: B.Vector3): void {
    if (!this.enabled) return;
    const d = Math.min(Math.max(0, dt), 0.1);
    this.clock += d;
    this.ensureTexture();

    this.plumeEmitter?.computeWorldMatrix(true);
    this.rocketRoot?.computeWorldMatrix(true);

    this.updatePlume();
    this.updateSmoke();
    this.updateDebris(d);
    this.updateReentry();

    void velocityDir;
  }

  private updatePlume(): void {
    const ps = this.plume;
    if (!ps) return;
    const powered = POWERED[this.phase] === true;
    if (!powered) {
      ps.emitRate = 0;
      return;
    }
    const flicker = 0.82 + 0.18 * Math.sin(this.clock * 47) + 0.08 * Math.random();
    ps.emitRate = 900 * flicker;
    ps.maxSize = this.radius * 2.2 * flicker;
    if (this.phase === 'ORBIT_INSERT') {
      ps.color1 = new B.Color4(0.62, 0.83, 1, 1);
      ps.color2 = new B.Color4(0.3, 0.55, 1, 1);
    } else {
      ps.color1 = new B.Color4(1, 0.95, 0.7, 1);
      ps.color2 = new B.Color4(1, 0.6, 0.2, 1);
    }
  }

  private updateSmoke(): void {
    const ps = this.smoke;
    if (!ps || !this.rocketRoot) return;
    const wp = this.rocketRoot.absolutePosition;
    const nearPad = B.Vector3.Distance(wp, this.padPos) < this.height * 6;
    if ((this.phase === 'LIFTOFF' || this.phase === 'ASCENT') && nearPad) {
      this.smokeEmitter.copyFrom(wp);
      ps.emitRate = this.phase === 'LIFTOFF' ? 380 : 140;
    } else {
      ps.emitRate = 0;
    }
  }

  private updateDebris(dt: number): void {
    if (this.phase === 'STAGE_SEP') {
      if (!this.sepSpawned) {
        this.sepSpawned = true;
        for (let k = 0; k < 8; k++) this.dropDebris();
      }
    } else {
      this.sepSpawned = false;
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];
      piece.life += dt;
      if (piece.life >= DEBRIS_LIFE) {
        piece.mesh.dispose();
        this.debris.splice(i, 1);
        continue;
      }
      piece.vel.y -= this.height * 0.12 * dt;
      piece.mesh.position.addInPlace(piece.vel.scale(dt));
    }
  }

  private updateReentry(): void {
    if (!this.reentry) return;
    const on = this.phase === 'ENTRY';
    this.reentry.isVisible = on;
    if (on && this.reentryMat) {
      this.reentryMat.alpha = 0.35 + 0.3 * Math.abs(Math.sin(this.clock * 9));
    }
  }

  private dropDebris(): void {
    if (!this.rocketRoot) return;
    const mesh = B.MeshBuilder.CreateBox('debris', { size: this.height * 0.04 }, this.scene);
    const mat = new B.PBRMaterial('debrisMat', this.scene);
    mat.albedoColor = new B.Color3(0.6, 0.62, 0.65);
    mat.metallic = 0.5;
    mat.roughness = 0.7;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.rotationQuaternion = B.Quaternion.Identity();
    const wp = this.rocketRoot.absolutePosition;
    mesh.position.set(
      wp.x + (Math.random() - 0.5) * this.height * 0.5,
      wp.y - this.height * 0.5,
      wp.z + (Math.random() - 0.5) * this.height * 0.5,
    );
    this.debris.push({
      mesh,
      vel: new B.Vector3(
        (Math.random() - 0.5) * this.height * 3,
        (Math.random() - 0.5) * this.height * 2,
        (Math.random() - 0.5) * this.height * 3,
      ),
      life: 0,
    });
  }

  /** The engine only accepts texture uploads after its first render. */
  private ensureTexture(): void {
    if (this.tex?.getInternalTexture()) return;
    if (this.scene.getFrameId() === 0) return;
    this.tex?.dispose();
    const tex = new B.DynamicTexture('plumeTex', { width: 64, height: 64 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    if (this.plume) this.plume.particleTexture = tex;
    if (this.smoke) this.smoke.particleTexture = tex;
    this.tex = tex;
  }

  private buildSmoke(): void {
    const ps = new B.ParticleSystem('liftoffSmoke', SMOKE_MAX, this.scene);
    ps.particleTexture = this.tex ?? null;
    ps.emitter = this.smokeEmitter;
    ps.minEmitBox = new B.Vector3(-0.6, -0.3, -0.6);
    ps.maxEmitBox = new B.Vector3(0.6, 0.3, 0.6);
    ps.direction1 = new B.Vector3(0.5, 1, 0.5);
    ps.direction2 = new B.Vector3(-0.5, 1, -0.5);
    ps.minEmitPower = 1.5;
    ps.maxEmitPower = 4;
    ps.minSize = 0.8;
    ps.maxSize = 2.6;
    ps.minLifeTime = 1.5;
    ps.maxLifeTime = 3.2;
    ps.emitRate = 0;
    ps.gravity = new B.Vector3(0, -0.25, 0);
    ps.color1 = new B.Color4(0.82, 0.82, 0.88, 0.55);
    ps.color2 = new B.Color4(0.65, 0.66, 0.72, 0.45);
    ps.colorDead = new B.Color4(0.4, 0.4, 0.45, 0);
    ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    this.smoke = ps;
  }

  private buildStars(): void {
    const positions = new Float32Array(STAR_MAX * 3);
    for (let i = 0; i < STAR_MAX; i++) {
      // Uniform direction on a shell far outside the camera far framing.
      const z = 2 * Math.random() - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const dist =
        this.starMinRadius + Math.random() * (this.starMaxRadius - this.starMinRadius);
      positions[i * 3] = Math.cos(a) * r * dist;
      positions[i * 3 + 1] = z * dist;
      positions[i * 3 + 2] = Math.sin(a) * r * dist;
    }
    const indices = new Array<number>(STAR_MAX);
    for (let i = 0; i < STAR_MAX; i++) indices[i] = i;

    const mesh = new B.Mesh('stars', this.scene);
    mesh.setVerticesData(B.VertexBuffer.PositionKind, positions, false);
    mesh.setIndices(indices);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;

    const mat = new B.StandardMaterial('starsMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new B.Color3(0.8, 0.85, 1);
    mat.pointsCloud = true;
    mat.pointSize = 1.4;
    mesh.material = mat;
    this.stars = mesh;
  }
}
