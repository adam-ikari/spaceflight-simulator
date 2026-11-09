/**
 * RocketDesigner — pick an archetype/mission/concept, edit stage parameters,
 * and see Isp/Δv/TWR plus the 9.4 km/s LEO verdict recomputed live.
 * Minimal DOM, no framework (DESIGN.md §4a/§4b/§6f).
 */
import { ARCHETYPES } from '../physics/archetypes';
import { CONCEPT_SCHEMES } from '../physics/ConceptSchemes';
import { MISSIONS, getMission } from '../physics/MissionLibrary';
import { PROPELLANTS } from '../physics/propellants';
import { computeEngine } from '../physics/PropulsionEngine';
import { validateRocket, type StageSpec, type RocketValidation } from '../physics/RocketEquation';
import { CONST } from '../physics/constants';

const LEO_DV = 9400;
const FIELD_STYLE =
  'display:flex;gap:.5rem;align-items:center;justify-content:space-between;margin:.15rem 0';
const INPUT_STYLE = 'width:9rem';
const CARD_STYLE =
  'font:13px/1.4 system-ui,sans-serif;color:#e8eaed;background:#1b1f24;padding:1rem;border-radius:6px;max-width:760px';

type StageNumberField =
  | 'ofRatio'
  | 'pcMPa'
  | 'expansionRatio'
  | 'thrustN'
  | 'propellantMassKg'
  | 'dryMassKg';

export class RocketDesigner {
  private container: HTMLElement;
  private onChange: (stages: StageSpec[], payloadKg: number) => void;
  private stages: StageSpec[] = [];
  private payloadKg = 10000;
  private preset = '';

  constructor(
    container: HTMLElement,
    onChange: (stages: StageSpec[], payloadKg: number) => void,
  ) {
    this.container = container;
    this.onChange = onChange;
    if (typeof document === 'undefined') return;
    const first = ARCHETYPES[0];
    if (first) this.loadArchetype(first.id);
    else this.render();
  }

  loadArchetype(id: string): void {
    if (typeof document === 'undefined') return;
    const a = ARCHETYPES.find((x) => x.id === id);
    if (!a) return;
    this.preset = `arch:${a.id}`;
    this.stages = a.stages.map((s) => ({ ...s }));
    this.render();
  }

  render(): void {
    if (typeof document === 'undefined') return;
    this.container.innerHTML = `
<div style="${CARD_STYLE}">
  <h2 style="margin:0 0 .6rem;font-size:15px">Rocket Designer</h2>
  <label style="${FIELD_STYLE}">Preset
    <select data-role="preset" style="${INPUT_STYLE}">${this.presetOptions()}</select>
  </label>
  <label style="${FIELD_STYLE}">Payload (kg)
    <input data-role="payload" type="number" step="any" value="${this.payloadKg}" style="${INPUT_STYLE}">
  </label>
  ${this.stages.map((s, i) => this.stageMarkup(s, i)).join('')}
  <div data-role="readout" style="margin-top:.75rem;border-top:1px solid #3c4043;padding-top:.6rem"></div>
</div>`;
    this.bind();
    this.refresh();
  }

  private presetOptions(): string {
    const opt = (value: string, label: string): string =>
      `<option value="${value}"${value === this.preset ? ' selected' : ''}>${label}</option>`;
    const groups = [
      `<optgroup label="Archetypes">${ARCHETYPES.map((a) => opt(`arch:${a.id}`, a.name)).join('')}</optgroup>`,
      `<optgroup label="Concepts">${CONCEPT_SCHEMES.map((c) => opt(`concept:${c.id}`, c.name)).join('')}</optgroup>`,
      `<optgroup label="Missions">${MISSIONS.map((m) => opt(`mission:${m.id}`, `${m.name} (${m.agency})`)).join('')}</optgroup>`,
    ];
    return groups.join('');
  }

  private stageMarkup(s: StageSpec, i: number): string {
    const num = (field: StageNumberField, label: string, value: number, step = 'any'): string =>
      `<label style="${FIELD_STYLE}">${label}
        <input data-field="${field}" type="number" step="${step}" value="${value}" style="${INPUT_STYLE}">
      </label>`;
    const propellants = Object.values(PROPELLANTS)
      .map((p) => `<option value="${p.id}"${p.id === s.propellantId ? ' selected' : ''}>${p.name}</option>`)
      .join('');
    return `
<fieldset data-stage="${i}" style="border:1px solid #3c4043;border-radius:4px;margin:.6rem 0;padding:.4rem .6rem">
  <legend style="padding:0 .3rem">Stage ${i + 1}</legend>
  <label style="${FIELD_STYLE}">Propellant
    <select data-field="propellantId" style="${INPUT_STYLE}">${propellants}</select>
  </label>
  ${num('ofRatio', 'O/F ratio', s.ofRatio)}
  ${num('pcMPa', 'Chamber pressure (MPa)', s.pcMPa)}
  ${num('expansionRatio', 'Expansion ratio', s.expansionRatio)}
  ${num('thrustN', 'Thrust (N)', s.thrustN)}
  ${num('propellantMassKg', 'Propellant (kg)', s.propellantMassKg)}
  ${num('dryMassKg', 'Dry mass (kg)', s.dryMassKg)}
  <label style="${FIELD_STYLE}">Solid booster
    <input data-field="isSolid" type="checkbox"${s.isSolid ? ' checked' : ''}>
  </label>
</fieldset>`;
  }

  private bind(): void {
    this.container
      .querySelector<HTMLSelectElement>('[data-role="preset"]')
      ?.addEventListener('change', (e) => this.onPreset((e.target as HTMLSelectElement).value));

    const payload = this.container.querySelector<HTMLInputElement>('[data-role="payload"]');
    payload?.addEventListener('input', () => {
      this.payloadKg = Number(payload.value);
      this.refresh();
    });

    this.container.querySelectorAll<HTMLElement>('[data-field]').forEach((el) => {
      const input = el as HTMLInputElement | HTMLSelectElement;
      const event = input instanceof HTMLSelectElement || (input as HTMLInputElement).type === 'checkbox'
        ? 'change'
        : 'input';
      input.addEventListener(event, () => this.updateStage(input));
    });
  }

  private onPreset(value: string): void {
    this.preset = value;
    const [kind, id] = value.split(':');
    if (kind === 'arch') {
      this.loadArchetype(id);
      return;
    }
    if (kind === 'mission') {
      const m = getMission(id);
      if (m) this.stages = m.stages.map((s) => ({ ...s }));
    }
    this.render();
  }

  private updateStage(el: HTMLInputElement | HTMLSelectElement): void {
    const stageEl = el.closest<HTMLElement>('[data-stage]');
    if (!stageEl) return;
    const stage = this.stages[Number(stageEl.dataset.stage)];
    const field = el.dataset.field;
    if (!stage || !field) return;

    if (field === 'propellantId') {
      stage.propellantId = el.value;
    } else if (field === 'isSolid') {
      stage.isSolid = (el as HTMLInputElement).checked;
    } else {
      stage[field as StageNumberField] = Number(el.value);
    }
    this.refresh();
  }

  /** Recompute the readout and push the current design to the caller. */
  private refresh(): void {
    const readout = this.container.querySelector<HTMLElement>('[data-role="readout"]');
    if (readout) readout.innerHTML = this.readoutHtml();
    this.onChange(
      this.stages.map((s) => ({ ...s })),
      this.payloadKg,
    );
  }

  private readoutHtml(): string {
    const concept = CONCEPT_SCHEMES.find((c) => this.preset === `concept:${c.id}`);
    if (concept) {
      const color =
        concept.feasibility === 'infeasible'
          ? '#c62828'
          : concept.feasibility === 'concept'
            ? '#f9a825'
            : '#2e7d32';
      return `
<div style="color:${color};font-weight:600">${concept.name} — ${concept.feasibility}</div>
<div style="margin-top:.3rem;color:#bdc1c6">${concept.bottleneck}</div>
<div style="margin-top:.3rem;color:#9aa0a6">Concept schemes carry no chemical stage stack; select an archetype or mission to edit stages.</div>`;
    }

    const g0 = CONST.G0;
    const rows: string[] = [];
    const computeErrors: string[] = [];

    this.stages.forEach((s, i) => {
      const upperMassKg = this.stages
        .slice(i + 1)
        .reduce((m, u) => m + u.dryMassKg + u.propellantMassKg, 0);
      const m0 = s.dryMassKg + s.propellantMassKg + upperMassKg + this.payloadKg;
      const mf = m0 - s.propellantMassKg;
      try {
        const { ispVac } = computeEngine({
          propellantId: s.propellantId,
          ofRatio: s.ofRatio,
          pcMPa: s.pcMPa,
          expansionRatio: s.expansionRatio,
        });
        if (mf <= 0 || !Number.isFinite(m0)) {
          computeErrors.push(`Stage ${i + 1}: propellant exceeds stack mass`);
          return;
        }
        const dv = ispVac * g0 * Math.log(m0 / mf);
        const twr = s.thrustN / (m0 * g0);
        const name = PROPELLANTS[s.propellantId]?.name ?? s.propellantId;
        rows.push(
          `<div>Stage ${i + 1} · ${name}${s.isSolid ? ' (solid)' : ''} · Isp ${ispVac.toFixed(1)} s · Δv ${(dv / 1000).toFixed(2)} km/s · TWR ${twr.toFixed(2)}</div>`,
        );
      } catch (err) {
        computeErrors.push(`Stage ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    let validation: RocketValidation | undefined;
    try {
      validation = validateRocket(this.stages, this.payloadKg);
    } catch (err) {
      computeErrors.push(err instanceof Error ? err.message : String(err));
    }

    const errors = [...(validation?.errors ?? []), ...computeErrors];
    const warnings = validation?.warnings ?? [];
    const reachable = validation?.ok === true && (validation?.totalDv ?? 0) >= LEO_DV;
    const verdictColor = reachable ? '#2e7d32' : '#c62828';
    const verdict = reachable
      ? 'LEO 9.4 km/s: REACHABLE'
      : 'LEO 9.4 km/s: INSUFFICIENT';

    return `
<div style="color:${verdictColor};font-weight:700">${verdict}</div>
<div style="margin-top:.4rem">Total Δv: ${((validation?.totalDv ?? 0) / 1000).toFixed(2)} km/s</div>
<div style="margin-top:.3rem">${rows.join('')}</div>
${warnings.length ? `<div style="margin-top:.4rem;color:#f9a825">${warnings.join('<br>')}</div>` : ''}
${errors.length ? `<div style="margin-top:.4rem;color:#c62828">${errors.join('<br>')}</div>` : ''}`;
  }
}
