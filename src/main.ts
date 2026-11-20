/**
 * Browser entry — wires the render scene, playback loop and UI panels together.
 * Main owns the single RAF loop: tick playback, sync the scene, render.
 */
import { PlaybackLoop } from './sim/PlaybackLoop';
import { Scene } from './render/Scene';
import type { Mission, ViewMode } from './render/Scene';
import { RocketDesigner } from './ui/RocketDesigner';
import { TelemetryPanel } from './ui/TelemetryPanel';
import { store } from './state/store';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

function boot(): void {
  const scene = new Scene(el('scene'));
  const playback = new PlaybackLoop(10);

  // Designer pushes the chosen stack into physics and rendering; changing it
  // restarts playback so the vehicle never swaps mid-flight.
  new RocketDesigner(el('designer'), (stages, payloadKg, config) => {
    playback.setVehicle(config.escapeSystem, config.hasSolidBooster, stages, payloadKg);
    scene.setVehicle(stages, config);
  });
  new TelemetryPanel(el('telemetry')).render();

  const pause = el('pause') as HTMLButtonElement;
  pause.addEventListener('click', () => {
    if (playback.finished) return;
    if (pause.textContent === '暂停') {
      playback.pause();
      pause.textContent = '继续';
    } else {
      playback.resume();
      pause.textContent = '暂停';
    }
  });
  el('replay').addEventListener('click', () => {
    playback.reset();
    pause.textContent = '暂停';
  });

  const mission = document.getElementById('mission') as HTMLSelectElement | null;
  mission?.addEventListener('change', () => {
    const next = mission.value as Mission;
    playback.setMission(next);
    scene.setMission(next);
    pause.textContent = '暂停';
  });

  const view = document.getElementById('view') as HTMLSelectElement | null;
  view?.addEventListener('change', () => scene.setView(view.value as ViewMode));

  const warp = document.getElementById('warp') as HTMLSelectElement | null;
  warp?.addEventListener('change', () => playback.setWarp(Number(warp.value)));
  if (warp) playback.setWarp(Number(warp.value));

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(Math.max(0, (now - last) / 1000), 0.1);
    last = now;
    playback.tick(dt);
    pause.disabled = playback.finished;
    if (playback.finished) pause.textContent = '已结束';
    const director = playback.director;
    const pos = director.positionKm();
    const moonPos = director.moonPositionKm?.();
    if (moonPos) {
      scene.setLunarFrame(store.get().body ?? 'EARTH', pos, moonPos, director.phase);
      scene.addTrajectoryPoint(pos);
    } else {
      scene.setPhase(director.phase);
      scene.setRocketPosition(pos);
      scene.addTrajectoryPoint(pos);
    }
    scene.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') boot();
