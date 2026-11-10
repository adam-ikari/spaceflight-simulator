/** TelemetryPanel — live phase/PLOC/cost/fuel readout subscribed to the store. */
import { store, type GameState } from '../state/store';

const CARD_STYLE =
  'font:13px/1.5 system-ui,sans-serif;color:#e8eaed;background:#1b1f24;padding:1rem;border-radius:6px;min-width:220px';
const ROW_STYLE = 'display:flex;justify-content:space-between;gap:1rem';

export class TelemetryPanel {
  private container: HTMLElement;
  private unsubscribe?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  render(): void {
    if (typeof document === 'undefined') return;
    this.unsubscribe?.();
    this.unsubscribe = store.subscribe((s) => this.draw(s));
    this.draw(store.get());
  }

  private draw(s: GameState): void {
    if (typeof document === 'undefined') return;
    const decisions = s.decisions.length
      ? s.decisions.slice(-5).reverse().map((d) => `<li>${d}</li>`).join('')
      : '<li style="color:#9aa0a6">无</li>';
    this.container.innerHTML = `
<div style="${CARD_STYLE}">
  <h2 style="margin:0 0 .5rem;font-size:15px">遥测</h2>
  <div style="${ROW_STYLE}"><span>阶段</span><b>${s.phase}</b></div>
  <div style="${ROW_STYLE}"><span>时间</span><b>${s.t.toFixed(1)} s</b></div>
  <div style="${ROW_STYLE}"><span>机组损失概率（PLOC）</span><b>${(s.ploc * 100).toFixed(2)} %</b></div>
  <div style="${ROW_STYLE}"><span>成本</span><b>$${(s.costUsd / 1e6).toFixed(2)} M</b></div>
  <div style="${ROW_STYLE}"><span>燃料</span><b>${s.fuelPct.toFixed(1)} %</b></div>
  <div style="${ROW_STYLE}"><span>已中止</span><b style="color:${s.aborted ? '#c62828' : '#2e7d32'}">${s.aborted ? '是' : '否'}</b></div>
  <div style="margin-top:.5rem">最近决策</div>
  <ul style="margin:.2rem 0 0;padding-left:1.1rem">${decisions}</ul>
</div>`;
  }
}
