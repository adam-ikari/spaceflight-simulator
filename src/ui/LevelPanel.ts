/**
 * LevelPanel — the level contract and a live feasibility screen.
 *
 * It does not recompute physics: `validateLevelDesign` returns the verdict plus
 * the quantities behind it (Δv, liftoff TWR, chamber wall, PLOC, cost), and this
 * panel only formats them. Any designer edit calls `update`, so the player sees
 * why a stack fails instead of a bare true/false.
 */
import { LEVEL_1, validateLevelDesign, type LevelSpec } from '../game/levels';
import type { StageSpec } from '../physics/RocketEquation';
import type { EscapeSystem } from '../game/levels';

const CARD_STYLE =
  'font:13px/1.5 system-ui,sans-serif;color:#e8eaed;background:#1b1f24;padding:1rem;border-radius:6px;min-width:220px';
const ROW_STYLE = 'display:flex;justify-content:space-between;gap:1rem';
const BADGE_STYLE =
  'display:inline-block;padding:.05rem .35rem;margin:0 .25rem .25rem 0;border:1px solid #3c4043;border-radius:999px;color:#bdc1c6';

const OK = '#2e7d32';
const BAD = '#c62828';
const WARN = '#f9a825';

export class LevelPanel {
  constructor(
    private readonly container: HTMLElement,
    private readonly level: LevelSpec = LEVEL_1,
  ) {
    if (typeof document === 'undefined') return;
    this.container.innerHTML = `
<div style="${CARD_STYLE}">
  <h2 style="margin:0 0 .4rem;font-size:15px">关卡 1 · ${this.level.name.replace(/^第一关：/, '')}</h2>
  <div style="color:#9aa0a6">等待设计器数据…</div>
</div>`;
  }

  /** Re-run the level screen for the current designer state. */
  update(stages: StageSpec[], payloadKg: number, escapeSystem: EscapeSystem): void {
    if (typeof document === 'undefined') return;
    const result = validateLevelDesign(this.level, { stages, payloadKg, escapeSystem });
    const m = result.metrics;
    const verdict = result.feasible
      ? `<b style="color:${OK}">可行</b>`
      : `<b style="color:${BAD}">不可行</b>`;

    const badges = [
      `${this.level.targetOrbitKm} km 圆轨道`,
      `载荷 ${(this.level.payloadKg / 1000).toFixed(0)} t`,
      `预算 $${(this.level.budgetUsd / 1e6).toFixed(0)}M`,
      `PLOC ≤ 1/${Math.round(1 / this.level.maxPloc)}`,
      `≤ ${this.level.timeLimitMin} min`,
      `≤ ${this.level.maxStages} 级`,
    ]
      .map((b) => `<span style="${BADGE_STYLE}">${b}</span>`)
      .join('');

    const metrics = m
      ? `
  <div style="${ROW_STYLE}"><span>总 Δv</span><b style="color:${m.totalDvMs >= m.requiredDvMs ? OK : BAD}">${(m.totalDvMs / 1000).toFixed(2)} / ${(m.requiredDvMs / 1000).toFixed(2)} km/s</b></div>
  <div style="${ROW_STYLE}"><span>起飞推重比</span><b style="color:${m.liftoffTwr >= 1.2 ? OK : BAD}">${m.liftoffTwr.toFixed(2)} / 1.20</b></div>
  <div style="${ROW_STYLE}"><span>最高壁温</span><b style="color:${Math.max(...m.wallTempsK) <= 1000 ? OK : BAD}">${Math.max(...m.wallTempsK).toFixed(0)} / 1000 K</b></div>
  <div style="${ROW_STYLE}"><span>PLOC</span><b style="color:${m.ploc <= this.level.maxPloc ? OK : BAD}">${(m.ploc * 100).toFixed(2)}% (1/${m.ploc > 0 ? Math.round(1 / m.ploc) : '∞'})</b></div>
  <div style="${ROW_STYLE}"><span>总成本</span><b style="color:${m.costUsd <= this.level.budgetUsd ? OK : BAD}">$${(m.costUsd / 1e6).toFixed(1)}M / $${(this.level.budgetUsd / 1e6).toFixed(0)}M</b></div>
  <div style="${ROW_STYLE}"><span>级数</span><b style="color:${stages.length <= this.level.maxStages ? OK : BAD}">${stages.length} / ${this.level.maxStages}</b></div>`
      : '';

    const reasons = result.reasons.length
      ? `<div style="margin-top:.5rem;color:${BAD}">${result.reasons
          .map((r) => `<div>• ${r}</div>`)
          .join('')}</div>`
      : `<div style="margin-top:.5rem;color:${OK}">全部门槛通过。</div>`;

    this.container.innerHTML = `
<div style="${CARD_STYLE}">
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem">
    <h2 style="margin:0;font-size:15px">关卡 1 · ${this.level.name.replace(/^第一关：/, '')}</h2>
    ${verdict}
  </div>
  <div style="margin:.45rem 0 .55rem">${badges}</div>
  ${metrics}
  ${reasons}
  <div style="margin-top:.55rem;color:${WARN};font-size:12px">修改设计器参数会实时重算；逃逸方式影响 PLOC。</div>
</div>`;
  }
}
