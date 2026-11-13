/**
 * Level definitions and design screening.
 *
 * A level fixes the mission contract — orbit, payload, budget, crew-loss
 * threshold, game-time limit, propellant set and stage ceiling. `validateDesign`
 * answers whether a stage stack can meet that contract, and every rejection
 * names the physical quantity that failed: Δv gap in m/s, Isp against the
 * propellant band, liftoff thrust, chamber wall temperature, PLOC or total cost.
 *
 * The check reuses the same physics as the live mission (PropulsionEngine,
 * RocketEquation, ComponentSystems chamber wall, RiskModel, CostModel). It is a
 * design-time screen, not a second flight model.
 */
import { CONST } from '../physics/constants';
import { computeCost, type CostOutput } from '../physics/CostModel';
import { chamberWallTemperature, CHAMBER_LIMIT_K } from '../physics/ComponentSystems';
import { PROPELLANTS } from '../physics/propellants';
import { computePLOC } from '../physics/RiskModel';
import { stagePerformance, type StageSpec } from '../physics/RocketEquation';
import { overLimitProbability } from '../physics/StructuralDynamics';

export type EscapeSystem = 'tower' | 'propulsive' | 'none';

/**
 * A level stage is a normal StageSpec. Regenerative cooling lives on StageSpec
 * so the design screen and the live thermal model read the same field.
 */
export type LevelStage = StageSpec;

export interface LevelDesign {
  stages: LevelStage[];
  /** Defaults to the level's payload requirement. */
  payloadKg?: number;
  /** Defaults to a launch escape tower. */
  escapeSystem?: EscapeSystem;
}

export interface LevelSpec {
  id: string;
  name: string;
  /** Circular orbit altitude, km. */
  targetOrbitKm: number;
  /** Payload that must reach orbit, kg. */
  payloadKg: number;
  /** One-time mission budget (development + launch + insurance), USD. */
  budgetUsd: number;
  /** Maximum probability of loss of crew, per mission (1/270 ≈ 0.0037). */
  maxPloc: number;
  /** In-game wall-clock limit for one run, minutes. */
  timeLimitMin: number;
  /** Propellants the level permits in any stage. */
  allowedPropellants: string[];
  /** Stage ceiling. */
  maxStages: number;
  /** Insertion Δv budget including gravity and drag losses, m/s. */
  requiredDvMs: number;
  /** Development budget folded into the one-time mission cost, USD. */
  devBudgetUsd: number;
  /** Propellant price, USD/kg. */
  propellantCostPerKg: Record<string, number>;
  /** Design max-q used for the ascent PLOC screen, Pa. */
  designMaxQPa: number;
}

export interface FeasibilityMetrics {
  /** Total ideal Δv of all stages, m/s. */
  totalDvMs: number;
  /** Level requirement including losses, m/s. */
  requiredDvMs: number;
  liftoffTwr: number;
  /** Ascent PLOC plus the in-orbit transit branch. */
  ploc: number;
  costUsd: number;
  /** Hot-gas-side chamber wall per stage, K. */
  wallTempsK: number[];
}

export interface FeasibilityResult {
  /** True only when both the physical screen and the level contract pass. */
  feasible: boolean;
  /**
   * Physical feasibility with the level's budget, PLOC and payload gates
   * removed. Null when the stack is too malformed to evaluate (for example a
   * payload mismatch that the caller still wants to show as a level failure).
   */
  physicallyFeasible: boolean | null;
  /** Empty when feasible; physical reasons first, then level reasons. */
  reasons: string[];
  /** Reasons that make the stack physically unworkable. */
  physicalReasons: string[];
  /** Reasons that miss this level's contract but not physics. */
  levelReasons: string[];
  /** Null when the design is too malformed to evaluate. */
  metrics: FeasibilityMetrics | null;
}

/**
 * Minimum liftoff thrust-to-weight. TWR > 1 is the physical floor; 1.1 is a
 * practical screen that still accepts the historical Saturn V (~1.14–1.19).
 * DESIGN.md's 1.2 is a design-margin target, not a feasibility gate.
 */
export const MIN_LIFTOFF_TWR = 1.1;
/** Van Allen transit share for a 200 km LEO mission (RiskModel §6). */
const RADIATION_TRANSIT_PROB = 0.0005;

/**
 * Level 1 — 200 km crewed LEO, 10 t payload.
 *
 * LOX/RP-1 is the reference propellant: high density, 330–350 s vacuum Isp and
 * a mature structure fraction. LOX/CH4 and LOX/LH2 are allowed as alternatives;
 * NTO/MMH is storable but pays the low-Isp penalty of the table entry.
 */
export const LEVEL_1: LevelSpec = {
  id: 'leo-200km-crew',
  name: '第一关：200 km 近地轨道载人发射',
  targetOrbitKm: 200,
  payloadKg: 10_000,
  budgetUsd: 400e6,
  maxPloc: 1 / 270,
  timeLimitMin: 15,
  allowedPropellants: ['LOX_RP1', 'LOX_CH4', 'LOX_LH2', 'NTO_MMH'],
  maxStages: 3,
  requiredDvMs: 9_400,
  // One-time program: development is amortized over this single mission.
  devBudgetUsd: 320e6,
  propellantCostPerKg: {
    LOX_RP1: 1.1,
    LOX_CH4: 1.6,
    LOX_LH2: 4.5,
    NTO_MMH: 28,
  },
  designMaxQPa: 20_000,
};

/** Mass of stage i plus every stage above it plus the payload, kg. */
function stackMassFrom(stages: StageSpec[], index: number, payloadKg: number): number {
  const upper = stages
    .slice(index + 1)
    .reduce((m, s) => m + s.dryMassKg + s.propellantMassKg, 0);
  return stages[index].dryMassKg + stages[index].propellantMassKg + upper + payloadKg;
}

/**
 * One-time mission cost using the shared CostModel. Propellant is priced per
 * stage and summed, then passed as one blended line so the CostModel's
 * key/array pairing cannot mis-price duplicate propellants across stages.
 */
function estimateCost(
  level: LevelSpec,
  stages: StageSpec[],
  payloadKg: number,
  ploc: number,
): CostOutput {
  const propellantMassKg = stages.reduce((m, s) => m + s.propellantMassKg, 0);
  const propellantCost = stages.reduce(
    (c, s) => c + s.propellantMassKg * (level.propellantCostPerKg[s.propellantId] ?? 0),
    0,
  );
  return computeCost({
    stagesDryMassKg: stages.map((s) => s.dryMassKg),
    propellantMassKg: [propellantMassKg],
    propellantCostPerKg: {
      blended: propellantMassKg > 0 ? propellantCost / propellantMassKg : 0,
    },
    reuseCount: 1,
    devBudget: level.devBudgetUsd,
    plannedLaunches: 1,
    ploc,
    // The 10 t payload is not itself the dominant loss term; crew and
    // reputation (CREW_REPUTATION_VALUE) already enter the expected failure.
    payloadValue: 0,
  });
}

/**
 * Screen a design against a level contract.
 *
 * Order is deliberate: shape/propellant errors first (they make the physics
 * meaningless), then performance (Isp, Δv, thrust), then thermal/risk/cost.
 */
export function validateLevelDesign(level: LevelSpec, design: LevelDesign): FeasibilityResult {
  const physicalReasons: string[] = [];
  const levelReasons: string[] = [];
  const stages = design.stages;
  const payloadKg = design.payloadKg ?? level.payloadKg;

  const finish = (
    feasible: boolean,
    physicallyFeasible: boolean | null,
    metrics: FeasibilityMetrics | null,
  ): FeasibilityResult => ({
    feasible,
    physicallyFeasible,
    reasons: [...physicalReasons, ...levelReasons],
    physicalReasons,
    levelReasons,
    metrics,
  });

  if (stages.length === 0) {
    physicalReasons.push('未配置任何级：至少需要 1 级');
    return finish(false, false, null);
  }
  if (stages.length > level.maxStages) {
    levelReasons.push(`级数 ${stages.length} 超过关卡上限 ${level.maxStages} 级`);
    return finish(false, null, null);
  }
  if (payloadKg !== level.payloadKg) {
    levelReasons.push(
      `载荷 ${(payloadKg / 1000).toFixed(1)} t 不符合关卡要求 ${(level.payloadKg / 1000).toFixed(1)} t`,
    );
    return finish(false, null, null);
  }

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const label = `级 ${i + 1}`;
    if (!PROPELLANTS[s.propellantId]) {
      physicalReasons.push(`${label} 推进剂 "${s.propellantId}" 不在推进剂数据库中`);
    } else if (!level.allowedPropellants.includes(s.propellantId)) {
      levelReasons.push(`${label} 推进剂 ${PROPELLANTS[s.propellantId].name} 不在本关允许集合内`);
    }
    if (!(s.propellantMassKg > 0)) physicalReasons.push(`${label} 推进剂质量必须大于 0 kg`);
    if (!(s.dryMassKg > 0)) physicalReasons.push(`${label} 结构质量必须大于 0 kg`);
    if (!(s.thrustN > 0)) physicalReasons.push(`${label} 推力必须大于 0 N`);
    const stackMass = stackMassFrom(stages, i, payloadKg);
    if (!(stackMass - s.propellantMassKg > 0)) {
      physicalReasons.push(
        `${label} 推进剂 ${(s.propellantMassKg / 1000).toFixed(1)} t 超过该级点火总质量 ${(stackMass / 1000).toFixed(1)} t`,
      );
    }
  }

  // Unknown/invalid propellants or masses make the performance numbers
  // meaningless, so stop before stagePerformance. A merely disallowed
  // propellant is a level rule and can still be screened physically.
  if (physicalReasons.length > 0) return finish(false, false, null);

  // --- Performance: Isp, Δv, thrust -------------------------------------
  let totalDv = 0;
  const ispVac: number[] = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const stackMass = stackMassFrom(stages, i, payloadKg);
    const perf = stagePerformance(s, stackMass);
    totalDv += perf.dvVac;
    ispVac.push(perf.ispVac);

    const band = PROPELLANTS[s.propellantId].ispVacRange;
    if (perf.ispVac < band[0]) {
      physicalReasons.push(
        `级 ${i + 1} Isp ${perf.ispVac.toFixed(1)} s 低于 ${PROPELLANTS[s.propellantId].name} 包线下限 ${band[0]} s（混合比/喷管效率不足）`,
      );
    }
  }

  if (totalDv < level.requiredDvMs) {
    const gap = level.requiredDvMs - totalDv;
    physicalReasons.push(
      `总 Δv ${totalDv.toFixed(0)} m/s 低于 ${level.targetOrbitKm} km LEO 需求 ${level.requiredDvMs} m/s，缺口 ${gap.toFixed(0)} m/s（一级 Isp ${ispVac[0].toFixed(1)} s）`,
    );
  }

  const liftoffMassKg = stages.reduce((m, s) => m + s.dryMassKg + s.propellantMassKg, 0) + payloadKg;
  const liftoffTwr = stages[0].thrustN / (liftoffMassKg * CONST.G0);
  if (liftoffTwr < MIN_LIFTOFF_TWR) {
    physicalReasons.push(
      `起飞推重比 ${liftoffTwr.toFixed(2)} < ${MIN_LIFTOFF_TWR.toFixed(2)}：${(stages[0].thrustN / 1e6).toFixed(2)} MN 推力对 ${(liftoffMassKg / 1000).toFixed(0)} t 起飞质量不足`,
    );
  }
  // Upper-stage TWR is not a physical gate. A stage already near orbital
  // velocity can thrust below its weight and still insert; the historical
  // Saturn V S-IVB runs ~0.4 with a 140 t payload. The Δv budget above already
  // prices the gravity loss that a low-TWR upper stage pays.

  // --- Thermal: chamber wall --------------------------------------------
  const componentBranches: { node: string; prob: number }[] = [];
  const wallTempsK: number[] = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const wall = chamberWallTemperature(s, s.thrustN);
    wallTempsK.push(wall.wallHotK);
    if (wall.wallHotK > CHAMBER_LIMIT_K) {
      const mode = s.regenerativeCooling === false ? '无再生冷却' : '再生冷却不足';
      physicalReasons.push(
        `级 ${i + 1} 燃烧室壁温 ${wall.wallHotK.toFixed(0)} K > ${CHAMBER_LIMIT_K} K 铜衬里上限（${mode}）`,
      );
      componentBranches.push({
        node: `thermal:stage${i}_chamber`,
        prob: overLimitProbability(wall.wallHotK, CHAMBER_LIMIT_K, 0.1 * CHAMBER_LIMIT_K),
      });
    }
  }

  // --- Risk: ascent PLOC plus the in-orbit transit branch ---------------
  const ascent = computePLOC({
    solidBoosterLit: stages[0].isSolid === true,
    mach: 1.1,
    dynamicPressurePa: level.designMaxQPa,
    escapeSystem: design.escapeSystem ?? 'tower',
    phase: 'ascent',
    crewed: true,
    componentBranches,
  });
  const ploc = 1 - (1 - ascent.ploc) * (1 - RADIATION_TRANSIT_PROB);
  if (ploc > level.maxPloc) {
    levelReasons.push(
      `PLOC ${(ploc * 100).toFixed(2)}%（1/${Math.round(1 / ploc)}）超过门槛 1/${Math.round(1 / level.maxPloc)}（${(level.maxPloc * 100).toFixed(2)}%）`,
    );
  }

  // --- Cost -------------------------------------------------------------
  const cost = estimateCost(level, stages, payloadKg, ploc);
  if (cost.total > level.budgetUsd) {
    levelReasons.push(
      `总成本 $${(cost.total / 1e6).toFixed(1)}M 超过 $${(level.budgetUsd / 1e6).toFixed(1)}M 预算（硬件 $${(cost.hardware / 1e6).toFixed(1)}M + 摊销 $${(cost.amortized / 1e6).toFixed(1)}M + 保险 $${(cost.insurance / 1e6).toFixed(1)}M + 失败期望 $${(cost.expectedFailure / 1e6).toFixed(1)}M）`,
    );
  }

  return finish(
    physicalReasons.length === 0 && levelReasons.length === 0,
    physicalReasons.length === 0,
    {
      totalDvMs: totalDv,
      requiredDvMs: level.requiredDvMs,
      liftoffTwr,
      ploc,
      costUsd: cost.total,
      wallTempsK,
    },
  );
}
