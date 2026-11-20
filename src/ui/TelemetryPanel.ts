/** TelemetryPanel — mission-control HUD: phase timeline, metric cards, expandable systems. */
import { store, type SimState } from '../state/store';
import { circularOrbitVelocity } from '../physics/OrbitalIntegrator';

interface PhaseGroup {
  label: string;
  phases: string[];
}

const PHASE_GROUPS: PhaseGroup[] = [
  { label: '发射段', phases: ['PAD', 'LIFTOFF', 'ASCENT', 'STAGE_SEP', 'ORBIT_INSERT'] },
  { label: '地球停泊', phases: ['ORBIT', 'PARK', 'RENDEZVOUS', 'DEORBIT'] },
  { label: '地月转移', phases: ['TLI', 'TRANSFER', 'LOI'] },
  { label: '登月作业', phases: ['LUNAR_ORBIT', 'DESCENT', 'MOON_LANDING', 'LUNAR_LAUNCH'] },
  { label: '返回地球', phases: ['TEI', 'EARTH_RETURN', 'EARTH_ENTRY', 'LANDING', 'DONE'] },
];

function metric(label: string, value: string, colour = ''): string {
  return `<div class="metric-card"><span>${label}</span><b${colour ? ` style="color:${colour}"` : ''}>${value}</b></div>`;
}

export class TelemetryPanel {
  private container: HTMLElement;
  private unsubscribe?: () => void;
  private detailsOpen = false;
  private bound = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  render(): void {
    if (typeof document === 'undefined') return;
    if (!this.bound) {
      this.container.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.hud-detail summary')) {
          this.detailsOpen = !this.detailsOpen;
        }
      });
      this.bound = true;
    }
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((s) => this.draw(s));
    this.draw(store.get());
  }

  private draw(s: SimState): void {
    if (typeof document === 'undefined') return;
    this.container.innerHTML = `
<div class="hud-top">
  <div class="hud-brand">阿波罗 11</div>
  <div class="phase-track">${this.timeline(s.phase)}</div>
  <div class="hud-clock">T+${s.t.toFixed(0)} s</div>
</div>
<div class="metric-grid">
  ${metric('天体 / 阶段', `${s.body === 'MOON' ? '月球' : '地球'} · ${s.phase}`)}
  ${metric('航天器', this.apolloVehicle(s.phase))}
  ${metric('高度', `${s.altitudeKm.toFixed(1)} km`)}
  ${metric('速度', `${s.speedMs.toFixed(0)} m/s`)}
  ${metric('燃料', `${s.fuelPct.toFixed(1)} %`)}
  ${metric('PLOC', `${(s.ploc * 100).toFixed(2)} %`)}
  ${metric('成本', `$${(s.costUsd / 1e6).toFixed(1)} M`)}
</div>
<details class="hud-detail"${this.detailsOpen ? ' open' : ''}>
  <summary>系统详情</summary>
  <div class="detail-section">任务</div>
  <div class="detail-row"><span>飞船</span><b>CSM Columbia / LM Eagle</b></div>
  <div class="detail-row"><span>乘员</span><b>Armstrong · Aldrin · Collins</b></div>
  ${this.computerRows(s)}
  ${this.lifeRows(s)}
  ${this.orbitRows(s)}
  ${this.systemRows(s)}
</details>`;
  }

  /** Five mission milestones share one timeline across LEO and lunar profiles. */
  private timeline(phase: string): string {
    const active = Math.max(0, PHASE_GROUPS.findIndex((g) => g.phases.includes(phase)));
    return PHASE_GROUPS.map((g, i) => {
      const state = i === active ? 'active' : i < active ? 'done' : '';
      return `<div class="phase-step ${state}">${g.label}</div>`;
    }).join('');
  }

  /** Apollo 11 stack: which vehicle the crew is flying in this phase. */
  private apolloVehicle(phase: string): string {
    if (['PAD', 'LIFTOFF', 'ASCENT', 'STAGE_SEP'].includes(phase)) return '土星五号 S-IC/S-II';
    if (['ORBIT_INSERT', 'ORBIT', 'PARK', 'TLI'].includes(phase)) return 'S-IVB + CSM';
    if (['DESCENT', 'MOON_LANDING', 'LUNAR_LAUNCH'].includes(phase)) return '登月舱 Eagle';
    if (['RENDEZVOUS', 'TRANSFER', 'LOI', 'LUNAR_ORBIT', 'TEI'].includes(phase)) return 'CSM Columbia';
    return '指令舱 Columbia';
  }

  /** Onboard flight-computer programs run continuously; their cycles are live. */
  private computerRows(s: SimState): string {
    const programs = s.computer;
    if (!programs?.length) return '';
    const rows = programs
      .map(
        (p) =>
          `<div class="detail-row"><span>${p.name}</span><b style="color:${p.healthy ? '#2e7d32' : '#c62828'}">${p.cycles} · ${p.lastOutput}</b></div>`,
      )
      .join('');
    return `<div class="detail-section">机载计算机</div>${rows}`;
  }

  /** Life support, radiation dose and chemistry-driven fuel state. */
  private lifeRows(s: SimState): string {
    const life = s.life;
    if (!life) return '';
    return `
  <div class="detail-section">生命保障</div>
  <div class="detail-row"><span>氧气 / 水</span><b>${life.o2RemainKg.toFixed(1)} / ${life.waterRemainKg.toFixed(1)} kg</b></div>
  <div class="detail-row"><span>CO₂</span><b>${life.co2Pct.toFixed(3)} %</b></div>
  <div class="detail-row"><span>辐射剂量</span><b>${(s.radiationMsv ?? 0).toFixed(3)} mSv</b></div>`;
  }

  /**
   * Component-level rows: the hottest components, pogo, random vibration and
   * propellant boil-off. Utilisation is temperature / limit, so 100 % is the
   * service limit, not an arbitrary colour threshold.
   */
  private systemRows(s: SimState): string {
    const y = s.systems;
    if (!y) return '';
    const colour = (u: number): string =>
      u > 0.98 ? '#c62828' : u > 0.85 ? '#f9a825' : '#2e7d32';
    const rows = y.components
      .slice()
      .sort((a, b) => b.utilisation - a.utilisation)
      .slice(0, 5)
      .map(
        (c) =>
          `<div class="detail-row"><span>${c.label}</span><b style="color:${colour(c.utilisation)}">${c.tempK.toFixed(0)} K · ${(c.utilisation * 100).toFixed(0)}%</b></div>`,
      )
      .join('');
    const pogo =
      y.pogoG > 0.001
        ? `<div class="detail-row"><span>pogo</span><b>${y.pogoG.toFixed(2)} g · ${y.pogoHz.toFixed(1)} Hz</b></div>`
        : '';
    const failures = y.failures.length
      ? `<div style="margin-top:.25rem;color:#c62828">超限：${y.failures
          .slice(0, 2)
          .map((f) => f.detail)
          .join('；')}</div>`
      : '';
    return `
  <div class="detail-section">分系统</div>
  ${rows}
  <div class="detail-row"><span>热防护</span><b style="color:${colour(y.tpsK / 3500)}">${y.tpsK.toFixed(0)} K</b></div>
  ${pogo}
  <div class="detail-row"><span>随机振动</span><b>${y.randomGrms.toFixed(1)} g_rms</b></div>
  <div class="detail-row"><span>弯曲频率</span><b>${y.bendingHz.toFixed(2)} Hz</b></div>
  <div class="detail-row"><span>蒸发损失</span><b>${y.boiloffKg.toFixed(1)} kg · ${y.boiloffPct.toFixed(3)} %</b></div>
  ${failures}`;
  }

  /**
   * Circular-speed comparison: green inside 0.2 % because J2 adds a physical
   * ±0.15 % wobble in LEO.
   */
  private orbitRows(s: SimState): string {
    if (s.altitudeKm < 100) return '';
    const vc = circularOrbitVelocity(s.altitudeKm * 1000);
    const devPct = vc > 0 ? ((s.speedMs - vc) / vc) * 100 : 0;
    const colour = Math.abs(devPct) < 0.2 ? '#2e7d32' : '#f9a825';
    return `
  <div class="detail-section">轨道</div>
  <div class="detail-row"><span>圆轨道速度</span><b>${vc.toFixed(0)} m/s</b></div>
  <div class="detail-row"><span>速度偏差</span><b style="color:${colour}">${devPct >= 0 ? '+' : ''}${devPct.toFixed(2)} %</b></div>`;
  }
}
