/**
 * AccidentScenarios — historical accidents reconstructed from physics.
 * DESIGN.md §6e: each accident is a preset the player can load; the failure
 * probability and the accident chain are computed by the physics modules, not
 * scripted. Root causes are the same quantities the sim already models:
 *
 *  - Apollo 1 (1967): pure-O2 cabin + ignition source → flash fire. Enrichment
 *    is measured against the NASA-STD-6001 flammability threshold (23.1 % O2
 *    by volume at 1 atm ⇒ 23.4 kPa ppO2); a 100 % O2 cabin at 1 atm sits at
 *    101.3 kPa ppO2, ~4.8× sea-level air.
 *  - Challenger (1986): Viton field-joint O-ring below its glass transition
 *    (`MaterialThermal.rubberResilience('viton_oring', T)`, Tg ≈ −20 °C) cannot
 *    rebound → hot gas blow-by → burn-through → vehicle breakup. Whether the
 *    escaping jet reaches the External Tank depends on the ascent dynamic
 *    pressure at the joint breach (`Atmosphere.dynamicPressure`).
 *  - Soyuz 11 (1971): descent-module vent valve stuck open → exponential cabin
 *    venting (τ = V/(A·a) for choked flow) → ppO2 below the ~3 kPa hypoxia
 *    threshold long before touchdown, and the crew flew without pressure suits.
 *  - Apollo 13 (1970): O2-tank fan arc → tank rupture → SM O2 gone; the crew
 *    survives on the LM's rated ECLSS budget (`LifeSupport.computeConsumables`,
 *    `stepLifeSupport`), which is short of the 3-crew free-return demand.
 *  - Columbia (2003): foam strike breaches the TPS; entry survives only if the
 *    heat flux stays under `MaterialThermal.tpsLimit(...)`.
 *
 * `prob` is P(the failure chain completes to the loss of mission/crew recorded
 * in that scenario's chain). `chain` is returned only once the chain actually
 * fires (prob ≥ CHAIN_MIN_PROB); otherwise the accident did not happen.
 */

import { rubberResilience, tpsLimit } from './MaterialThermal';
import {
  computeConsumables,
  stepLifeSupport,
  LifeSupportState,
} from './LifeSupport';
import { dynamicPressure } from './Atmosphere';

export interface ScenarioState {
  /** Launch-day ambient temperature (°C); Viton Tg ≈ −20 °C. */
  launchTempC?: number;
  /** Cabin O2 volume fraction (0..1); 0.21 = sea-level air, 1.0 = pure O2. */
  cabinO2Pct?: number;
  /** Ignition source / arc present in the cabin. */
  ignitionPresent?: boolean;
  /** O2-tank stir fan / wiring fault. */
  tankFault?: boolean;
  /** Ascent foam strike on the TPS. */
  foamStrike?: boolean;
  /** TPS material id known to `MaterialThermal.tpsLimit`. */
  tpsMaterialId?: string;
  /** Entry stagnation heat flux, MW/m². */
  reentryHeatFluxMWm2?: number;
  /** Cabin valve / seal open to vacuum. */
  cabinLeak?: boolean;
}

export interface ScenarioResult {
  prob: number;
  chain: string[];
}

export interface Scenario {
  id: string;
  year: number;
  name: string;
  conditions: string;
  triggerFn: (s: ScenarioState) => ScenarioResult;
}

/** Below this probability the chain did not complete: nothing to show. */
const CHAIN_MIN_PROB = 0.05;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

const fired = (prob: number, chain: string[]): ScenarioResult => ({
  prob: clamp01(prob),
  chain: prob >= CHAIN_MIN_PROB ? chain : [],
});

/* ------------------------------------------------------------------ *
 * Challenger 1986
 * ------------------------------------------------------------------ */

const VITON_TG_C = -20;
/** STS-51-L: joint blow-by first observed ≈ T+58 s, ≈ 14 km, ≈ 490 m/s. */
const LEAK_ALT_M = 14_000;
const LEAK_SPEED_MS = 490;
/** Shuttle ascent max-q ≈ 725 psf ≈ 34.7 kPa (Rogers Commission trajectory). */
const SHUTTLE_MAX_Q_PA = 34_700;
const Q_AT_LEAK_PA = dynamicPressure(LEAK_SPEED_MS, LEAK_ALT_M);
const JET_RECIRC = clamp01(Q_AT_LEAK_PA / SHUTTLE_MAX_Q_PA);
/**
 * Empirical: an O-ring leak near max-q leaves the blow-by jet attached to the
 * SRB/ET attachment region (it burns through the tank), while a leak at
 * negligible q is swept aft harmlessly.
 */
const JET_DAMAGE = 0.9 + 0.1 * JET_RECIRC;

/** P(seal leak-through) from Viton resilience at the launch temperature. */
function sealLeakProb(tempC: number): number {
  const p = 1 - rubberResilience('viton_oring', tempC);
  if (tempC >= VITON_TG_C) return p;
  // Below Tg the elastomer has no rebound left: the O-ring cannot follow the
  // joint gap at all, so the probability saturates at the deep-cold asymptote
  // (resilience floor 0.1 ⇒ 0.9) over Tg → Tg−10 °C.
  const t = clamp01((VITON_TG_C - tempC) / 10);
  return p + (0.9 - p) * t;
}

const CHALLENGER_CHAIN = [
  'O-ring低温失弹',
  'SRB场接头燃气泄漏',
  '结构失效→解体',
];

/* ------------------------------------------------------------------ *
 * Apollo 1 1967
 * ------------------------------------------------------------------ */

/** Cabin pressure at the pad: 1 atm (Apollo 1 ran pure O2 at 16.7 psia). */
const CABIN_PRESSURE_KPA = 101.325;
/** NASA-STD-6001 O2-enriched threshold: 23.1 % by vol at 1 atm. */
const P_O2_FLAMMABLE_KPA = 23.4;

const APOLLO1_CHAIN = ['纯氧大气', '点火源', '舱火→机组'];

/* ------------------------------------------------------------------ *
 * Soyuz 11 1971
 * ------------------------------------------------------------------ */

/** Descent module (SA) free volume ≈ 4 m³. */
const SA_VOLUME_M3 = 4;
/** Stuck-open ventilation valve, representative orifice ≈ 1 cm². */
const VALVE_ORIFICE_M2 = 1e-4;
/** Choked venting at the local speed of sound (≈ 340 m/s at cabin T). */
const VENT_SPEED_MS = 340;
/** Exponential venting time constant τ = V/(A·a). */
const VENT_TAU_S = SA_VOLUME_M3 / (VALVE_ORIFICE_M2 * VENT_SPEED_MS);
/** Air ppO2 at 1 atm (21 % of 101.3 kPa). */
const P_O2_AIR_KPA = 21.3;
/** Loss-of-consciousness threshold: ≈ 3 kPa ppO2 (≈ 23 mmHg). */
const HYPOXIA_KPA = 3;
/** Seconds from valve opening to ppO2 < hypoxia: t = τ·ln(p0/p·). */
const HYPOXIA_SEC = VENT_TAU_S * Math.log(P_O2_AIR_KPA / HYPOXIA_KPA);
/** Valve opened at orbital-module separation, ≈ 30 min before touchdown. */
const ENTRY_TO_LANDING_SEC = 1800;

const SOYUZ11_CHAIN = ['再入舱阀失压', '无压力服', '缺氧→机组'];

/* ------------------------------------------------------------------ *
 * Apollo 13 1970
 * ------------------------------------------------------------------ */

/** Free-return coast home after the LOI abort: ≈ 4 days. */
const RETURN_DAYS = 4;
/** LM ECLSS was rated for 2 crew × 2 days; it flew with 100 % contingency. */
const LM_RATED = computeConsumables({ crew: 2, durationDays: 2 });
const LM_O2_RESERVE_KG = 2 * LM_RATED.o2Kg;
const RESERVE_SEARCH_SEC = 10 * 86400;
const RESERVE_STEP_SEC = 3600;

/** Seconds of breathable O2 the reserve buys at the given crew size. */
function o2ReserveSec(o2Kg: number, crew: number): number {
  let s: LifeSupportState = {
    o2RemainKg: o2Kg,
    waterRemainKg: 0,
    co2Pct: 0,
    metabolicHeatW: 0,
    failures: [],
  };
  let t = 0;
  while (t < RESERVE_SEARCH_SEC && !s.failures.includes('o2_depleted')) {
    s = stepLifeSupport(s, crew, RESERVE_STEP_SEC);
    t += RESERVE_STEP_SEC;
  }
  return t;
}

const APOLLO13_CHAIN = ['O2罐搅拌电弧', '罐爆', 'ECLSS O2失→在轨危机'];

/* ------------------------------------------------------------------ *
 * Columbia 2003
 * ------------------------------------------------------------------ */

const DEFAULT_TPS = 'silica_tile';
/** A strike that stays inside the TPS limit leaves a survivable tile gouge. */
const GOUGE_PROB = 0.02;

const COLUMBIA_CHAIN = ['泡沫击穿TPS', '再入热气侵入', '结构/热失效'];

/* ------------------------------------------------------------------ *
 * Catalog
 * ------------------------------------------------------------------ */

export const SCENARIOS: Scenario[] = [
  {
    id: 'apollo1',
    year: 1967,
    name: 'Apollo 1 座舱火灾',
    conditions:
      '发射台插接试验：舱内 100 % 纯氧 @ 1 atm（ppO2 ≈ 101 kPa），可燃材料满舱，电气点火源存在',
    triggerFn: (s) => {
      const frac = s.cabinO2Pct ?? 0.21;
      if (frac < 0 || frac > 1) {
        throw new Error(`cabinO2Pct must be within 0..1, got ${frac}`);
      }
      const pO2 = CABIN_PRESSURE_KPA * frac;
      const enrich = clamp01(
        (pO2 - P_O2_FLAMMABLE_KPA) / (CABIN_PRESSURE_KPA - P_O2_FLAMMABLE_KPA),
      );
      // Ignition source turns enrichment into flame spread; without one the
      // enriched atmosphere alone cannot ignite.
      const prob = s.ignitionPresent
        ? 0.02 + 0.95 * enrich
        : 0.005 * enrich;
      return fired(prob, APOLLO1_CHAIN);
    },
  },
  {
    id: 'challenger',
    year: 1986,
    name: 'Challenger STS-51-L 解体',
    conditions:
      '发射日环境温度远低于 Viton O-ring 玻璃化温度（Tg ≈ −20 °C）：SRB 场接头失去回弹密封',
    triggerFn: (s) => {
      const tempC = s.launchTempC ?? 20;
      const prob = sealLeakProb(tempC) * JET_DAMAGE;
      return fired(prob, CHALLENGER_CHAIN);
    },
  },
  {
    id: 'soyuz11',
    year: 1971,
    name: 'Soyuz 11 再入舱失压',
    conditions:
      '返回段通气阀异常开启：再入舱对真空泄压，机组未穿压力服（1971 年标准配置）',
    triggerFn: (s) => {
      // Without a pressure suit the crew breathes only cabin gas; the valve
      // vents the cabin to vacuum, so survival is decided by the venting time
      // constant vs. the time left to touchdown.
      const lethal = HYPOXIA_SEC < ENTRY_TO_LANDING_SEC;
      const prob = s.cabinLeak ? (lethal ? 0.8 : 0.3) : 0.01;
      return fired(prob, SOYUZ11_CHAIN);
    },
  },
  {
    id: 'apollo13',
    year: 1970,
    name: 'Apollo 13 O2 罐爆炸',
    conditions:
      '2 号 O2 罐低温搅拌风扇导线打火：罐内特氟龙绝缘破损 → 压力升高 → 罐爆，SM O2 全失',
    triggerFn: (s) => {
      if (!s.tankFault) return fired(0.01, APOLLO13_CHAIN);
      // With the SM tanks gone the crew lives off the LM's rated ECLSS budget;
      // the chain escalates to a crew-loss risk when that budget runs dry
      // before the free-return coast ends.
      const depletionSec = o2ReserveSec(LM_O2_RESERVE_KG, 3);
      const shortfall = depletionSec < RETURN_DAYS * 86400;
      return fired(shortfall ? 0.7 : 0.5, APOLLO13_CHAIN);
    },
  },
  {
    id: 'columbia',
    year: 2003,
    name: 'Columbia STS-107 再入解体',
    conditions:
      '上升段外贮箱泡沫脱落击中机翼前缘：TPS（二氧化硅瓦，许用 1.5 MW/m²）出现穿透缺口',
    triggerFn: (s) => {
      if (!s.foamStrike) return fired(0.005, COLUMBIA_CHAIN);
      const limit = tpsLimit(s.tpsMaterialId ?? DEFAULT_TPS).maxHeatFluxMWm2;
      const q = s.reentryHeatFluxMWm2 ?? 0;
      if (q <= limit) return fired(GOUGE_PROB, COLUMBIA_CHAIN);
      // Past the limit the breach has no margin left: hot-gas ingress heats the
      // wing spar. The margin shrinks as (q − limit)/limit grows.
      const over = (q - limit) / (0.35 * limit);
      return fired(0.5 + 0.5 * (1 - Math.exp(-over)), COLUMBIA_CHAIN);
    },
  },
];
