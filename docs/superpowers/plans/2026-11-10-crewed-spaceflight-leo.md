# 载人航天推演模拟器(LEO 首版) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 浏览器内、物理真实的近地轨道载人发射推演游戏：用户设计火箭(含化学燃烧算 Isp)、实时决策(abort/机动)、物理驱动后果、PLOC 与成本动态演化。

**Architecture:** Three.js 渲染 + cannon-es 上升段刚体 + 自研 RK4 轨道积分器;物理纯模块(推进/轨道/大气/风险/成本)与渲染解耦,纯模块先行 TDD,后接阶段调度与游戏循环。

**Tech Stack:** Vite + 原生 ES module + TypeScript, Three.js r16x, cannon-es, Vitest。

**Spec:** `DESIGN.md`(项目根)。计划从 DESIGN.md 论证;执行者同时读 DESIGN.md 与本计划。

## Global Constraints

- 物理真实:所有 Δv/Isp/轨道/风险/成本由真实公式导出,可追溯;Isp 由燃烧化学算,非手填(化学分支)。
- 物理常量:g0=9.80665, R_u=8314.46 J/(kmol·K), μ=3.986004418e14 m³/s², R_earth=6371e3 m, J2=1.08263e-3。
- LEO 验收:400km 圆轨道速度 sqrt(μ/r)≈7672 m/s,积分器误差<0.1%;LOX/RP-1 Isp 复算落 330–350s。
- 模块化:`MissionProfile`/`OrbitalIntegrator` 预留月球/火星接口,不实现。
- YAGNI:无框架(Redux 等),最小自研 store;无未要求抽象。
- TDD:纯物理模块先写失败测试再实现;每任务结束 commit。

## Review Focus

1. **混合比偏离化学最优** → Isp 应下降、燃烧不稳风险上升(用户期望:调 O/F 看性能惩罚)。
2. **总 Δv 不足 9.4 km/s** → 火箭不可达 LEO,应红色告警而非静默入轨。
3. **固体助推(Shuttle)点火后 abort** → 救生成功率应为 0 直至助推分离(Challenger 教训)。
4. **轨道积分长期漂移** → J2 摄动下多圈后能量不应发散。
5. **PLOC 随决策反向** → 推迟离轨收窄再入走廊应使 PLOC↑,数字可追溯到故障节点。

---

## File Structure

```
src/
  physics/
    constants.ts          # 物理常量与天体常数
    propellants.ts        # 推进剂组合参数表(LOX/RP-1 等)
    PropulsionEngine.ts   # 燃烧化学→c*/Cf/Isp/ṁ/F(化学) + 非化学分支
    RocketEquation.ts     # Δv=Isp·g0·ln(m0/mf)、级核算、可行性校验
    archetypes.ts         # 4a 工程原型 + 4b 概念方案数据
    Atmosphere.ts         # US Std 1976 近似 + 阻力/动压
    OrbitalIntegrator.ts  # RK4 + J2、拼接圆锥接口
    AscentDynamics.ts     # 重力转弯、损耗、最大动压
    RiskModel.ts          # 故障树 + PLOC + abort 救生率
    CostModel.ts          # 成本演化
  director/
    PhysicsDirector.ts    # 阶段状态机
    phases.ts             # 阶段定义
  state/store.ts          # 最小自研 store
  render/
    Scene.ts              # Three.js 场景/地球/火箭/轨迹
    RigidBodyAscent.ts    # cannon-es 上升段
  ui/
    RocketDesigner.ts     # 设计器 UI
    TelemetryPanel.ts     # 实时遥测面板
  game/GameLoop.ts        # 决策输入→物理步进→风险/成本→反馈
  main.ts                 # 入口
tests/                     # 镜像 src 结构, *.test.ts
```

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: 可运行 `npm run dev`(Vite) 与 `npm test`(Vitest)。

- [ ] **Step 1: 写失败测试**
```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('scaffold', () => {
  it('runs vitest', () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 2: 运行验证失败**
Run: `npm test` — Expected: FAIL(no test runner / 依赖未装)。

- [ ] **Step 3: 初始化项目**
`npm create vite`(vanilla-ts) 或手写 package.json;装 deps:`three cannon-es`;devDeps:`typescript vitest @types/three vite-plugin`。`vitest.config.ts` 用 node 环境跑纯物理测试。

- [ ] **Step 4: 运行验证通过**
Run: `npm test` — Expected: PASS。`npm run dev` 起空白页。

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: scaffold vite+ts+vitest, three/cannon deps"
```

---

### Task 2: 物理常量与推进剂表

**Files:**
- Create: `src/physics/constants.ts`, `src/physics/propellants.ts`
- Test: `tests/physics/propellants.test.ts`

**Interfaces:**
- Produces: `CONST.G0=9.80665`, `CONST.RU=8314.46`, `CONST.MU_EARTH`, `CONST.R_EARTH`, `CONST.J2`; `Propellant` 类型 `{ id, name, ofTypical, ispVacRange:[lo,hi], tcK, mGmol, rhoOx, rhoF, gamma }`; `PROPELLANTS: Record<id,Propellant>`。

- [ ] **Step 1: 写失败测试**
```ts
import { PROPELLANTS } from '../../src/physics/propellants';
describe('propellants', () => {
  it('LOX/RP-1 in real Isp range', () => {
    expect(PROPELLANTS['LOX_RP1'].ispVacRange[0]).toBeGreaterThanOrEqual(330);
    expect(PROPELLANTS['LOX_RP1'].ispVacRange[1]).toBeLessThanOrEqual(350);
  });
  it('LH2 has lowest molecular weight', () => {
    expect(PROPELLANTS['LOX_LH2'].mGmol).toBeLessThan(PROPELLANTS['LOX_RP1'].mGmol);
  });
});
```

- [ ] **Step 2: 运行验证失败**
Run: `npm test` — Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 constants.ts 与 propellants.ts**
填 DESIGN.md §4 表四行(LOX/RP-1、LOX/LH2、NTO/MMH、LOX/CH4)真实值:tc、M、ρ、γ、O/F、Isp 区间。

- [ ] **Step 4: 运行验证通过**
Run: `npm test` — Expected: PASS。

- [ ] **Step 5: Commit** `feat: physics constants + propellant database`

---

### Task 3: PropulsionEngine — 燃烧化学算 Isp

**Files:**
- Create: `src/physics/PropulsionEngine.ts`
- Test: `tests/physics/PropulsionEngine.test.ts`

**Interfaces:**
- Consumes: `PROPELLANTS`, `CONST.G0`, `CONST.RU`。
- Produces:
```ts
interface CombustionInput { propellantId: string; ofRatio: number; pcMPa: number; expansionRatio: number; paMPa?: number }
interface EnginePerf { cstar: number; cf: number; ispVac: number; ispSl: number; thrustPerMdot: number }
export function computeEngine(inp: CombustionInput): EnginePerf
```
- `cstar = sqrt(γ·Ru·Tc/M) / (γ·sqrt((2/(γ+1))^((γ+1)/(γ-1))))`
- `Cf` 由喷管公式(Pc,Pa,Pe,γ,ε);Pe 由等熵膨胀比 ε 求解。
- `ispVac = cstar·Cf/g0`;`ispSl = (F_vac − (Pe−Pa)·Ae)/(ṁ·g0)`。

- [ ] **Step 1: 写失败测试(锚真实区间)**
```ts
import { computeEngine } from '../../src/physics/PropulsionEngine';
describe('PropulsionEngine LOX/RP-1', () => {
  const r = computeEngine({ propellantId:'LOX_RP1', ofRatio:2.3, pcMPa:7, expansionRatio:16 });
  it('Isp vac in 330–350s', () => { expect(r.ispVac).toBeGreaterThanOrEqual(330); expect(r.ispVac).toBeLessThanOrEqual(350); });
  it('cstar in 1500–1800 m/s', () => { expect(r.cstar).toBeGreaterThan(1500); expect(r.cstar).toBeLessThan(1800); });
  it('Cf ~1.5–1.8', () => { expect(r.cf).toBeGreaterThan(1.4); expect(r.cf).toBeLessThan(1.9); });
});
```

- [ ] **Step 2: 运行验证失败** — `npm test` FAIL(未定义)。

- [ ] **Step 3: 实现 computeEngine**
按公式;Pe 用二分/牛顿解 `ε = (1/M_e)·sqrt((2/(γ+1))^(1/(γ-1))·... )` 等熵关系。

- [ ] **Step 4: 运行验证通过** — `npm test` PASS。

- [ ] **Step 5: Commit** `feat: PropulsionEngine combustion->Isp`

---

### Task 4: RocketEquation — 级 Δv 与可行性校验

**Files:**
- Create: `src/physics/RocketEquation.ts`
- Test: `tests/physics/RocketEquation.test.ts`

**Interfaces:**
- Consumes: `computeEngine`。
- Produces:
```ts
interface StageSpec { propellantId: string; ofRatio: number; pcMPa: number; expansionRatio: number;
  propellantMassKg: number; dryMassKg: number; thrustN: number; isSolid?: boolean }
interface StagePerf { ispVac: number; dvVac: number; burnTimeS: number; twr: number; mdot: number }
export function stagePerformance(s: StageSpec, totalMassKg: number, g0?: number): StagePerf
export interface RocketValidation { ok: boolean; totalDv: number; warnings: string[]; errors: string[] }
export function validateRocket(stages: StageSpec[], payloadKg: number): RocketValidation
```
- `dvVac = isp·g0·ln(m0/mf)`;TWR=thrust/(total·g0);9.4 km/s 校验;结构分数下限校验(RP-1 0.05–0.08, LH2 0.08–0.12)。

- [ ] **Step 1: 写失败测试**
```ts
import { stagePerformance, validateRocket } from '../../src/physics/RocketEquation';
describe('rocket equation', () => {
  it('ideal dv matches closed form', () => {
    const r = stagePerformance({ propellantId:'LOX_RP1', ofRatio:2.3, pcMPa:7, expansionRatio:16,
      propellantMassKg:100000, dryMassKg:8000, thrustN:7.6e6 }, 150000);
    expect(r.dvVac).toBeCloseTo(r.ispVac*9.80665*Math.log(150000/(150000-100000)), 1);
  });
  it('rejects rocket under 9.4 km/s', () => {
    const v = validateRocket([{ propellantId:'LOX_RP1', ofRatio:2.3, pcMPa:7, expansionRatio:16,
      propellantMassKg:50000, dryMassKg:5000, thrustN:5e6 }], 5000);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/Δv|9.4/);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 stagePerformance/validateRocket**

- [ ] **Step 4: 运行验证通过**

- [ ] **Step 5: Commit** `feat: rocket equation + feasibility validation`

---

### Task 5: 方案族数据(4a+4b)

**Files:**
- Create: `src/physics/archetypes.ts`
- Test: `tests/physics/archetypes.test.ts`

**Interfaces:**
- Produces: `ARCHETYPES: Archetype[]`,每项 `{ id, name, era, category:'engineering'|'concept', feasibility:'flyable'|'researched'|'concept'|'infeasible', stages: StageSpec[], notes }`。
  含:Saturn V、Soyuz、Shuttle(固体 isSolid)、Falcon9、Starship、用户自研模板;4b:NERVA、Ion、SolarSail、Orion、Daedalus、PlanetaryEngine。

- [ ] **Step 1: 写失败测试**
```ts
import { ARCHETYPES } from '../../src/physics/archetypes';
describe('archetypes', () => {
  it('Saturn V flyable with 3 stages', () => {
    const a = ARCHETYPES.find(x=>x.id==='saturn_v'); expect(a?.category).toBe('engineering');
    expect(a?.stages.length).toBe(3);
  });
  it('Shuttle has solid booster', () => {
    const a = ARCHETYPES.find(x=>x.id==='shuttle');
    expect(a?.stages.some(s=>s.isSolid)).toBe(true);
  });
  it('PlanetaryEngine infeasible', () => {
    const a = ARCHETYPES.find(x=>x.id==='planetary_engine'); expect(a?.feasibility).toBe('infeasible');
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现 archetypes.ts** 真实参数(见 DESIGN.md §4a/§4b)。

- [ ] **Step 4: 运行验证通过**

- [ ] **Step 5: Commit** `feat: archetype library 4a+4b`

---

### Task 6: 大气模型

**Files:**
- Create: `src/physics/Atmosphere.ts`
- Test: `tests/physics/Atmosphere.test.ts`

**Interfaces:**
- Produces: `density(h:number): number`(US Std 1976 分层指数近似);`dragForce(v,h,Cd,A): number`;`dynamicPressure(v,h): number`(=½ρv²)。

- [ ] **Step 1: 写失败测试**
```ts
import { density, dynamicPressure } from '../../src/physics/Atmosphere';
describe('atmosphere', () => {
  it('density ~1.225 at sea level', () => { expect(density(0)).toBeCloseTo(1.225, 1); });
  it('density ~0 at 100km', () => { expect(density(100000)).toBeLessThan(1e-5); });
  it('max-q ~30-40kPa in realistic ascent region', () => {
    expect(dynamicPressure(300, 11000)).toBeGreaterThan(10000);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现** 分层标高(0-11km H=8434, 11-25 H=12716 等)指数模型。

- [ ] **Step 4: 运行验证通过**

- [ ] **Step 5: Commit** `feat: atmosphere model + drag/dynamic pressure`

---

### Task 7: OrbitalIntegrator — RK4+J2

**Files:**
- Create: `src/physics/OrbitalIntegrator.ts`
- Test: `tests/physics/OrbitalIntegrator.test.ts`

**Interfaces:**
- Consumes: `CONST.MU_EARTH`, `CONST.R_EARTH`, `CONST.J2`。
- Produces:
```ts
export type Vec3 = [number,number,number];
export interface OrbitState { pos: Vec3; vel: Vec3; t: number }
export function stepRK4(s: OrbitState, dt: number): OrbitState   // 含 J2 加速度
export function circularOrbitVelocity(altitudeM: number): number // sqrt(μ/r)
```
- 加速度 = −μ·r/r³ + J2 项(`a_J2 = -(3/2)J2 μ R²/r⁵ · [...]`)。

- [ ] **Step 1: 写失败测试**
```ts
import { stepRK4, circularOrbitVelocity } from '../../src/physics/OrbitalIntegrator';
describe('orbital integrator', () => {
  it('circular velocity 400km ≈7672 m/s', () => {
    expect(circularOrbitVelocity(400000)).toBeCloseTo(7672, -1);
  });
  it('400km circular orbit stays closed over 1 orbit (<0.1% drift)', () => {
    const r = 6371e3+400e3; const v = circularOrbitVelocity(400000);
    let s = { pos:[r,0,0] as [number,number,number], vel:[0,v,0] as [number,number,number], t:0 };
    const T = 2*Math.PI*Math.sqrt(r**3/3.986004418e14);
    const dt = 1; const n = Math.round(T/dt);
    for (let i=0;i<n;i++) s = stepRK4(s, dt);
    const r0 = r; const r1 = Math.hypot(...s.pos);
    expect(Math.abs(r1-r0)/r0).toBeLessThan(0.001);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现** RK4 + J2 加速度函数。

- [ ] **Step 4: 运行验证通过**

- [ ] **Step 5: Commit** `feat: RK4 orbital integrator with J2`

---

### Task 8: AscentDynamics — 重力转弯与损耗

**Files:**
- Create: `src/physics/AscentDynamics.ts`
- Test: `tests/physics/AscentDynamics.test.ts`

**Interfaces:**
- Consumes: `stagePerformance`, `density`, `dynamicPressure`。
- Produces: `simulateAscent(stages, payload): AscentResult` 含 `{ maxQ, gravityLoss, dragLoss, finalState }`。简化:俯仰程序随时间重力转弯;积分速度/高度。

- [ ] **Step 1: 写失败测试**
```ts
import { simulateAscent } from '../../src/physics/AscentDynamics';
describe('ascent', () => {
  it('max-q in 20-50 kPa for reasonable rocket', () => {
    // 用 archetypes Saturn V
    const r = simulateAscent(...);  // 见 archetypes
    expect(r.maxQ).toBeGreaterThan(20000); expect(r.maxQ).toBeLessThan(50000);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现** 1D/2D 上升积分(俯仰角程序 + 重力 + 阻力损耗)。

- [ ] **Step 4: 运行验证通过**

- [ ] **Step 5: Commit** `feat: ascent dynamics gravity-turn + losses`

---

### Task 9: RiskModel — 故障树与 PLOC

**Files:**
- Create: `src/physics/RiskModel.ts`
- Test: `tests/physics/RiskModel.test.ts`

**Interfaces:**
- Produces:
```ts
export interface RiskInput { solidBoosterLit: boolean; mach: number; dynamicPressurePa: number;
  escapeSystem: 'tower'|'propulsive'|'none'; phase: string; crewed: boolean }
export interface RiskOutput { ploc: number; contributors: {node:string, prob:number}[] }
export function abortSuccessRate(inp: RiskInput): number  // 0..1
export function computePLOC(inp: RiskInput): RiskOutput
```
- 基线:运载失败 1/100;逃逸塔大动压区性能下降;固体点火后 abortSuccessRate=0 直至分离(Challenger);推进逃逸全段可 abort。

- [ ] **Step 1: 写失败测试**
```ts
import { abortSuccessRate, computePLOC } from '../../src/physics/RiskModel';
describe('risk', () => {
  it('solid booster lit -> abort rate 0', () => {
    expect(abortSuccessRate({ solidBoosterLit:true, mach:1.5, dynamicPressurePa:30000,
      escapeSystem:'tower', phase:'ascent', crewed:true })).toBe(0);
  });
  it('propulsive escape abort > 0 at high mach', () => {
    expect(abortSuccessRate({ solidBoosterLit:false, mach:2, dynamicPressurePa:30000,
      escapeSystem:'propulsive', phase:'ascent', crewed:true })).toBeGreaterThan(0.5);
  });
  it('PLOC decreases with better escape system', () => {
    const tow = computePLOC({ solidBoosterLit:false, mach:2, dynamicPressurePa:30000, escapeSystem:'tower', phase:'ascent', crewed:true }).ploc;
    const pro = computePLOC({ solidBoosterLit:false, mach:2, dynamicPressurePa:30000, escapeSystem:'propulsive', phase:'ascent', crewed:true }).ploc;
    expect(pro).toBeLessThan(tow);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现** 故障树概率表 + 条件概率。

- [ ] **Step 4: 运行验证通过**

- [ ] **Step 5: Commit** `feat: risk model fault tree + abort success`

---

### Task 10: CostModel

**Files:**
- Create: `src/physics/CostModel.ts`
- Test: `tests/physics/CostModel.test.ts`

**Interfaces:**
- Produces:
```ts
export interface CostInput { stagesDryMassKg[]; propellantMassKg[]; propellantCostPerKg: Record<id,number>;
  reuseCount: number; devBudget: number; plannedLaunches: number; ploc: number; payloadValue: number }
export interface CostOutput { hardware: number; propellant: number; ops: number; amortized: number; insurance: number; expectedFailure: number; total: number }
export function computeCost(inp: CostInput): CostOutput
```
- 硬件按级质量×$/kg,复用次数摊销;保险∝(1+k·PLOC);失败期望=PLOC×(载荷+机组货币化)。

- [ ] **Step 1: 写失败测试**
```ts
import { computeCost } from '../../src/physics/CostModel';
describe('cost', () => {
  const base = { stagesDryMassKg:[8000], propellantMassKg:[100000], propellantCostPerKg:{LOX_RP1:0.5},
    reuseCount:1, devBudget:1e9, plannedLaunches:20, ploc:0.005, payloadValue:1e8 };
  it('higher PLOC raises insurance + total', () => {
    const a = computeCost(base);
    const b = computeCost({ ...base, ploc:0.02 });
    expect(b.insurance).toBeGreaterThan(a.insurance);
    expect(b.total).toBeGreaterThan(a.total);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现**

- [ ] **Step 4: 运行验证通过**

- [ ] **Step 5: Commit** `feat: cost model with ploc-driven insurance`

---

### Task 10b: LifeSupport (ECLSS 生保消耗)

**Files:**
- Create: `src/physics/LifeSupport.ts`
- Test: `tests/physics/LifeSupport.test.ts`

**Interfaces:**
- Produces:
```ts
export interface CrewConfig { crew: number; durationDays: number }
export interface Consumables { o2Kg: number; waterKg: number; foodKg: number; liohKg: number; totalKg: number }
export function computeConsumables(c: CrewConfig): Consumables
export interface LifeSupportState { o2RemainKg: number; waterRemainKg: number; co2Pct: number; metabolicHeatW: number; failures: string[] }
export function stepLifeSupport(s: LifeSupportState, crew: number, dtSec: number): LifeSupportState
```

- [ ] **Step 1: 写失败测试** — 3 人 1 日 O2 耗 ~2.52kg;CO2 升高;消耗品 totalKg 含全部。
- [ ] **Step 2: 运行验证失败**
- [ ] **Step 3: 实现** — 0.84 kg/人/日 O2、2.7L 水、0.62kg 食;步进消耗;CO2 累积。
- [ ] **Step 4: 运行验证通过**
- [ ] **Step 5: Commit** `feat: life support consumables + step`

---

### Task 10c: MaterialThermal (材料温度依变)

**Files:**
- Create: `src/physics/MaterialThermal.ts`
- Test: `tests/physics/MaterialThermal.test.ts`

**Interfaces:**
- Produces: `rubberResilience(materialId, tempC): number`(0..1,Tg 以下急剧↓);`dbttFactor(metalId, tempC)`;`cryoBoiloff(propellantId, dtSec, insulationWm2K)`;`tpsLimit(materialId)`。
- Challenger 锚:`rubberResilience('viton_oring', -1)` 显著低于 `+20`。

- [ ] **Step 1: 写失败测试** — Viton@-1°C 弹性 < @20°C;TPS 限值断言。
- [ ] **Step 2-4:** TDD 实现材料表(Tg/DBTT/热限)。
- [ ] **Step 5: Commit** `feat: material thermal-dependence + cryo boiloff`

---

### Task 10d: Radiation (辐射)

**Files:**
- Create: `src/physics/Radiation.ts`
- Test: `tests/physics/Radiation.test.ts`

**Interfaces:**
- Produces: `gcrDoseRateMsvPerDay(leoShieldingFactor)`,`speDoseMsv(eventIntensity, shieldingGMcm2)`,`vanAllenDoseMsv(transitProfile)`,`accumulate(prevMsv, doseMsv)`。
- 屏蔽:聚乙烯质量厚度 g/cm² → 剂量衰减;阈值 >1 Sv 急性病。

- [ ] **Step 1: 写失败测试** — GCR 深空 ~0.5-1 mSv/日;SPE 屏蔽后剂量降;累积超 1Sv 标志。
- [ ] **Step 2-4:** TDD。
- [ ] **Step 5: Commit** `feat: radiation GCR/SPE/VanAllen + shielding`

---

### Task 10e: AccidentScenarios (历史事故复现)

**Files:**
- Create: `src/physics/AccidentScenarios.ts`
- Test: `tests/physics/AccidentScenarios.test.ts`

**Interfaces:**
- Produces: `SCENARIOS: Scenario[]`(apollo1/challenger/soyuz11/apollo13/columbia),每项 `{ id, year, name, conditions, triggerFn(state)->{prob, chain:string[]} }`。
- Challenger:发射环境温度 → `MaterialThermal.rubberResilience('viton_oring', T)` → 失密封概率;T 低 prob 高。
- Columbia:泡沫碎片命中 → TPS 缺陷 → 再入热气侵入(Sutton-Graves + tpsLimit)。
- Apollo13:O₂ 罐故障 → ECLSS O₂ 失;Soyuz11:舱失压 → 缺氧;Apollo1:纯氧+点火。

- [ ] **Step 1: 写失败测试** — Challenger@低温 prob > @常温;Columbia TPS 超限触发;Apollo1 纯氧+点火触发。
- [ ] **Step 2-4:** TDD;复用 MaterialThermal/LifeSupport/Atmosphere。
- [ ] **Step 5: Commit** `feat: historical accident scenarios (chain from physics)`

---

### Task 10f: MissionLibrary (历史任务/计划库 + 哈勃/空间站场景)

**Files:**
- Create: `src/physics/MissionLibrary.ts`
- Test: `tests/physics/MissionLibrary.test.ts`

**Interfaces:**
- Produces: `MISSIONS: MissionPreset[]`,每项 `{ id, agency, name, year, category, targetOrbitKm, inclinationDeg, crew, durationDays, stages: StageSpec[], events?: Scenario[] }`。
  category ∈ `'launch'|'station'|'servicing'|'accident'`。
  含(见 DESIGN §6f):Mercury/Gemini/Apollo/Skylab/STS/Hubble/Demo-2/Vostok/Voskhod/Soyuz/Salyut/Mir/Buran/神舟/天宫/ISS。
- 空间站类:加载即设 RENDEZVOUS+DOCKING+驻留(长期 ECLSS 消耗)+返回;EVA(航天员舱外,系绳生保+辐射暴露+MMOD 风险)。
- 维修类(Hubble):540km 交会+机械臂捕获+EVA 换件。
- 礼炮号:Salyut1(Soyuz11 归途失压事故链);Salyut7(1985)失电漂移→抢救对接(电力 EPS 失压+交会)。

- [ ] **Step 1: 写失败测试** — ISS 预设 420km/51.6°/长驻留消耗品正确;Hubble 540km;Salyut1 关联 Soyuz11 事故;Mercury 单人。
- [ ] **Step 2-4:** TDD;数据层复用 archetypes/LifeSupport/AccidentScenarios。
- [ ] **Step 5: Commit** `feat: mission library NASA/SpaceX/Soviet/Russia/China + Hubble/station`

---

### Task 10g: Weather (天气模拟)

**Files:**
- Create: `src/physics/Weather.ts`
- Test: `tests/physics/Weather.test.ts`

**Interfaces:**
- Produces:
```ts
export interface WeatherState { groundWindMs: number; windShearPerKm: number; tempC: number; lightningRisk: number; cloudCeilingM: number; seaWaveM: number }
export interface LaunchCommit { go: boolean; violations: string[] }
export function evaluateLaunch(w: WeatherState): LaunchCommit
export function windLoadMoment(w: WeatherState, altKm: number): number  // 上升结构弯矩贡献
```
- 阈值:地面阵风 >10 m/s、风切变 >30 m/s·km、tempC < -1(触发 O-ring 低温告警,喂 MaterialThermal)、lightningRisk >0.3、云底 <1000m、浪 >3m → 违反。
- windLoadMoment:风载随高度积分贡献结构弯矩(喂 Structure 风险)。

- [ ] **Step 1: 写失败测试** — 强风/低温/高闪电各触发 violation 且 go=false;windLoadMoment 单调随风速。
- [ ] **Step 2-4:** TDD。
- [ ] **Step 5: Commit** `feat: weather model + launch commit criteria`

---

### Task 10h: ConceptSchemes (新方案可行性验证)

**Files:**
- Create: `src/physics/ConceptSchemes.ts`
- Test: `tests/physics/ConceptSchemes.test.ts`

**Interfaces:**
- Produces:
```ts
export type Feasibility = 'flyable' | 'researched' | 'concept' | 'infeasible'
export interface ConceptScheme { id: string; name: string; ispS?: number; feasibility: Feasibility; bottleneck: string }
export const CONCEPT_SCHEMES: ConceptScheme[]  // solar_sail/ntr_mars/fusion_direct/sabre/laser_launch/mass_driver/space_elevator/skyhook/antimatter
export function tensileFeasibility(materialTensileGPa: number, taperRequired: number): Feasibility
export function laserLaunchFeasibility(payloadKg: number, laserPowerGW: number): { dvMs: number; feasible: Feasibility }
export function massDriverFeasibility(altitudeKm: number): Feasibility
export function sailAcceleration(areaKm2: number, distanceAU: number, payloadKg: number): number  // m/s²
```
- 锚:太空电梯需 ~50 GPa;碳纳米管 ~63 GPa(理论);mass_driver@0km → infeasible;太阳帆加速度 ~9e-6·area/payload/distance²。

- [ ] **Step 1: 写失败测试** — tensileFeasibility(63, 1.5)≠infeasible;massDriverFeasibility(0)=infeasible;sailAcceleration(1,1,1000)~9e-6。
- [ ] **Step 2-4:** TDD。
- [ ] **Step 5: Commit** `feat: concept schemes feasibility verification`

---

### Task 11: PhysicsDirector 阶段状态机

**Files:**
- Create: `src/director/phases.ts`, `src/director/PhysicsDirector.ts`
- Test: `tests/director/PhysicsDirector.test.ts`

**Interfaces:**
- Produces: `Phase` 枚举;`PhysicsDirector` 持当前阶段、调用对应物理模块 step、暴露 `telemetry()`。

- [ ] **Step 1-5:** TDD: 阶段转换(PAD→LIFTOFF→ASCENT→...→LANDING)、错误阶段拒绝。Commit `feat: physics director phase machine`。

---

### Task 12: Three.js 场景

**Files:**
- Create: `src/render/Scene.ts`
- Test: 浏览器手测(`npm run dev` 看地球+火箭模型)。

**Interfaces:**
- Produces: `Scene` 类(init/update/dispose);加载地球纹理、火箭 mesh、轨迹线。

- [ ] **Step 1: 起开发服务器看空白 3D 场景**(无单测,视觉验收)。
- [ ] **Step 2: 加地球+火箭+轨迹线**。
- [ ] **Step 3: Commit** `feat: three.js scene earth+rocket+trajectory`

---

### Task 13: cannon-es 上升段刚体

**Files:**
- Create: `src/render/RigidBodyAscent.ts`
- Test: 浏览器手测。

**Interfaces:**
- Consumes: `AscentDynamics`(提供俯仰/推力),`PhysicsDirector`。
- 上升段用 cannon-es 刚体驱动姿态/着陆碰撞;入轨后切自研积分器。

- [ ] **Step 1: 接入刚体火箭**;**Step 2: 阶段切换**;**Step 3: Commit** `feat: cannon-es ascent rigid body + phase handoff`。

---

### Task 14: GameLoop + 决策输入

**Files:**
- Create: `src/game/GameLoop.ts`, `src/state/store.ts`
- Test: 集成手测 + 仪表数值断言。

**Interfaces:**
- 决策(abort/go/no-go/机动 Δv/离轨时机)→ 物理步进 → 风险/成本更新 → store notify。

- [ ] **Step 1-5:** TDD: abort 在固体点火时无效(store 断言 PLOC 不降);机动 Δv 改变轨道状态。Commit `feat: game loop + decision handling`。

---

### Task 15: RocketDesigner UI + TelemetryPanel

**Files:**
- Create: `src/ui/RocketDesigner.ts`, `src/ui/TelemetryPanel.ts`
- Test: 浏览器手测。

**Interfaces:**
- Designer:选原型→改参数→实时显示 Isp/Δv/TWR/可行性;Telemetry:实时 Δv/Isp/PLOC/Cost/燃料。

- [ ] **Step 1-3:** DOM/最小 UI;接 store。Commit `feat: rocket designer + telemetry panel`。

---

### Task 16: 端到端验收

**Files:** `src/main.ts` 串接。
- [ ] 设计 Saturn V/Falcon9 原型 → 校验可达 LEO。
- [ ] 上升重力转弯可视化 + 最大动压显示。
- [ ] RK4 入轨 400km 速度误差<0.1%(Telemetry 比对 circularOrbitVelocity)。
- [ ] abort(Shuttle 固体段 vs Dragon 推进逃逸)后果对比。
- [ ] LOX/RP-1 Isp 显示落 330–350s。
- [ ] Commit `feat: wire end-to-end LEO mission acceptance`。

---

## 执行说明

- 任务 1-10 纯物理模块,可并行(无相互文件冲突),适合 subagent-driven-development 并行分派;任务 11+ 有依赖,串行。
- 每任务 TDD:先红后绿后 commit。
- 概念方案(4b 行星发动机)在 Task 5 仅作数据展示,不接入 PropulsionEngine(非化学);其"不可行"由 UI 标 feasibility=infeasible 展示核算结论。
