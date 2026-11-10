/**
 * Browser entry — wires the render scene, phase director, game loop, rigid-body
 * ascent and UI panels together (Task 16). Main owns the single RAF loop:
 * tick the director via GameLoop, step the rigid body, render.
 */
import { PhysicsDirector } from './director/PhysicsDirector';
import { GameLoop } from './game/GameLoop';
import { Scene } from './render/Scene';
import type { ViewMode } from './render/Scene';
import { RocketDesigner } from './ui/RocketDesigner';
import { TelemetryPanel } from './ui/TelemetryPanel';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

function boot(): void {
  const scene = new Scene(el('scene'));
  const director = new PhysicsDirector();
  const gameLoop = new GameLoop(director, 10);

  // Designer pushes the current stack to the rigid body (constructor does the
  // first push with the default archetype).
  new RocketDesigner(el('designer'), (stages, payloadKg, config) => {
    void payloadKg;
    director.setVehicle(config.escapeSystem, config.hasSolidBooster);
    scene.setVehicle(stages, config);
  });
  new TelemetryPanel(el('telemetry')).render();

  el('launch').addEventListener('click', () => gameLoop.decide({ type: 'go' }));
  el('abort').addEventListener('click', () => gameLoop.decide({ type: 'abort' }));
  el('deorbit').addEventListener('click', () => gameLoop.decide({ type: 'deorbit' }));

  const view = document.getElementById('view') as HTMLSelectElement | null;
  view?.addEventListener('change', () => scene.setView(view.value as ViewMode));

  const warp = document.getElementById('warp') as HTMLSelectElement | null;
  warp?.addEventListener('change', () => gameLoop.setWarp(Number(warp.value)));
  if (warp) gameLoop.setWarp(Number(warp.value));

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(Math.max(0, (now - last) / 1000), 0.1);
    last = now;
    gameLoop.tick(dt);
    const pos = director.positionKm();
    scene.setPhase(director.phase);
    scene.setRocketPosition(pos);
    scene.addTrajectoryPoint(pos);
    scene.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') boot();
