/**
 * Browser entry — wires the render scene, playback loop and UI panels together.
 * Main owns the single RAF loop: tick playback, sync the scene, render.
 */
import { PlaybackLoop } from './sim/PlaybackLoop';
import { Scene } from './render/Scene';
import type { ViewMode } from './render/Scene';
import { TelemetryPanel } from './ui/TelemetryPanel';
import { store } from './state/store';
import { ARCHETYPES } from './physics/archetypes';

const APOLLO_PAYLOAD_KG = 45_000;

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

function boot(): void {
  const scene = new Scene(el('scene'));
  document.getElementById('loading')?.remove();
  const playback = new PlaybackLoop(10, 'lunar');
  scene.setMission('lunar');
  const saturnV = ARCHETYPES.find((a) => a.id === 'saturn_v');
  if (!saturnV) throw new Error('Missing Saturn V archetype');
  playback.setVehicle(saturnV.escapeSystem, false, saturnV.stages, APOLLO_PAYLOAD_KG);
  scene.setVehicle(saturnV.stages, {
    escapeSystem: saturnV.escapeSystem,
    hasSolidBooster: false,
  });

  playback.pause();
  el('start').addEventListener('click', () => {
    playback.resume();
    el('start-overlay').remove();
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

  const view = document.getElementById('view') as HTMLSelectElement | null;
  view?.addEventListener('change', () => scene.setView(view.value as ViewMode));

  const warp = document.getElementById('warp') as HTMLSelectElement | null;
  warp?.addEventListener('change', () => playback.setWarp(Number(warp.value)));
  if (warp) playback.setWarp(Number(warp.value));

  // Keyboard shortcuts keep the views reachable without leaving the canvas.
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!playback.finished) pause.click();
    } else if (event.key === 'r' || event.key === 'R') {
      el('replay').click();
    } else if (view && /^[1-6]$/.test(event.key)) {
      view.selectedIndex = Number(event.key) - 1;
      view.dispatchEvent(new Event('change'));
    } else if (warp && (event.key === '[' || event.key === ']')) {
      const options = [...warp.options];
      const index = options.findIndex((o) => o.value === warp.value);
      const next = Math.max(0, Math.min(options.length - 1, index + (event.key === '[' ? -1 : 1)));
      warp.selectedIndex = next;
      warp.dispatchEvent(new Event('change'));
    }
  });

  let last = performance.now();
  let lastPos: [number, number, number] | null = null;
  const frame = (now: number): void => {
    const dt = Math.min(Math.max(0, (now - last) / 1000), 0.1);
    last = now;
    playback.tick(dt);
    pause.disabled = playback.finished;
    if (playback.finished) pause.textContent = '已结束';
    const director = playback.director;
    const pos = director.positionKm();
    const moonPos = director.moonPositionKm?.();
    if (lastPos && Math.hypot(
      pos[0] - lastPos[0],
      pos[1] - lastPos[1],
      pos[2] - lastPos[2],
    ) > 1000) {
      scene.clearTrajectory();
    }
    lastPos = [...pos];
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
