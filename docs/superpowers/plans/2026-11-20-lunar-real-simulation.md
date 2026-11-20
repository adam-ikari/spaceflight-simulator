# 真实世界登月任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实常数、地月两体引力、有限推力与闭环制导，自动播放从地球发射到月面着陆再返回地球的载人任务。

**Architecture:** 新增 `LunarDynamics`（地月引力与 RK4）、`LunarGuidance`（下降/上升闭环制导）、`LunarDirector`（登月相位与燃烧事件），通过 `MissionDirector` 接口接入现有 `PlaybackLoop`。现有 `PhysicsDirector` 与 LEO 流程不改；`Scene` 增加真实比例的月球与阶段尺度切换。

**Tech Stack:** TypeScript、Vite、Vitest、Babylon.js；无新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-20-lunar-real-simulation-design.md`

## Global Constraints

- 物理坐标始终是真实米/千米；不允许为目标高度/速度直接赋值。
- 燃烧必须有限时长并消耗质量（a = T/m，ṁ = −T/(Isp·g0)）；Isp 来自 `PropulsionEngine`。
- 相位切换只能由物理事件或观赏驻留触发，不能强制跳过物理段。
- 不修改现有 LEO 的 `PhysicsDirector` 行为与其测试；不引入外部星历/地形数据。

## Review Focus

- TLI 后是否真的进入月球 SOI，而不是靠相位跳过 → Task 1/3 测试。
- 月面下降是否真软着陆（触地速度 ≤2 m/s） → Task 2/3 测试。
- 返回段是否真到地球 120 km 以下 → Task 3 测试。
- 巡航段视觉是否用真实比例（半径/间距比）而非示意压缩 → Task 4 浏览器验证。
- 任务切换后 LEO 是否仍正常 → Task 5 全量测试 + 浏览器切换验证。

---

### Task 1: 月球常数与地月两体积分

**Files:** Modify `src/physics/constants.ts`; Create `src/physics/LunarDynamics.ts`、`tests/physics/LunarDynamics.test.ts`

**Interfaces:**
- Consumes: `OrbitState`、`Vec3` from `OrbitalIntegrator`；`CONST`。
- Produces:
```ts
export function moonPositionAt(tSec: number): Vec3;            // ECI 米，圆轨道
export function moonVelocityAt(tSec: number): Vec3;
export function lunarAcceleration(pos: Vec3, tSec: number): Vec3; // 地球+月球引力 m/s²
export function stepLunarRK4(state: OrbitState, dtSec: number): OrbitState;
export interface TransferSolution { tliDvMs: number; tofSec: number; moonPhaseLeadRad: number; }
export function solveEarthMoonTransfer(parkingAltKm: number): TransferSolution;
export function moonRelative(state: OrbitState, tSec: number): { pos: Vec3; vel: Vec3; distM: number; speedMs: number };
```
Constants added: `MU_MOON`、`R_MOON`、`MOON_SMA_M`、`MOON_OMEGA`、`MOON_SOI_M`。

**Steps:**
- [ ] **Step 1: 写失败测试** `tests/physics/LunarDynamics.test.ts`：TLI 解算给出 Δv 3–3.5 km/s、飞行时间 4–6 天；从解算出的停泊轨道状态出发，用 `stepLunarRK4` 积分至 `tofSec`，`moonRelative(...).distM < MOON_SOI_M`；`lunarAcceleration` 在月球附近主要由月球主导。
- [ ] **Step 2: 运行确认 RED。**
- [ ] **Step 3: 实现常数与 `LunarDynamics.ts`**：月球圆轨道以 t=0 为 TLI 时刻，初相位取解算出的领先角；RK4 中加速度依赖时间（月球位置）。
- [ ] **Step 4: 运行测试 GREEN。**

---

### Task 2: 有限推力与月面闭环制导

**Files:** Create `src/physics/LunarGuidance.ts`、`tests/physics/LunarGuidance.test.ts`

**Interfaces:**
```ts
export interface BurnCommand { accel: Vec3; throttle: number; active: boolean }
export function lunarDescentCommand(
  state: OrbitState, tSec: number, maxAccelMs2?: number,
): BurnCommand; // state 为月心惯性系
export function lunarAscentCommand(
  state: OrbitState, tSec: number, targetAltKm?: number, maxAccelMs2?: number,
): BurnCommand;
export function thrustFromIsp(thrustN: number, ispSec: number, massKg: number, dtSec: number): { dvMs: number; massKg: number };
```

**Steps:**
- [ ] **Step 1: 写失败测试**：从 100 km 月球圆轨道初态出发，每步用 `lunarDescentCommand` + 月球引力积分，触地（r ≤ R_MOON+5 m）时速度 ≤2 m/s，且 3600 s 内收敛；`lunarAscentCommand` 从月面静止出发 1200 s 内进入高度 100±10 km、切向速度接近圆轨道 5% 内；`thrustFromIsp` 质量守恒（质量减少 = 推进剂消耗）。
- [ ] **Step 2: 运行确认 RED。**
- [ ] **Step 3: 实现 PD/比例制导与推力质量积分**，推力指令限幅在 `maxAccelMs2`（默认 6 m/s²），不直接设置目标高度/速度。
- [ ] **Step 4: 运行测试 GREEN。**

---

### Task 3: LunarDirector 全流程

**Files:** Create `src/sim/MissionDirector.ts`、`src/sim/LunarDirector.ts`、`tests/sim/LunarDirector.test.ts`

**Interfaces:**
```ts
export interface MissionTelemetry {
  phase: string; t: number; altitudeKm: number; speedMs: number;
  dvRemainingMs: number; ploc: number; costUsd: number; fuelPct: number;
  systems: SystemsSnapshot | null; body?: 'EARTH' | 'MOON';
}
export interface MissionDirector {
  readonly phase: string;
  step(dtSec: number): void;
  telemetry(): MissionTelemetry;
  positionKm(): [number, number, number]; // 地心，真实 km
  setVehicle(...args: Parameters<PhysicsDirector['setVehicle']>): void;
}
```
LunarDirector 自身推进相位：PAD → LIFTOFF → ASCENT → PARK → TLI → TRANSFER → LOI → LUNAR_ORBIT → DESCENT → MOON_LANDING → LUNAR_LAUNCH → RENDEZVOUS → TEI → EARTH_RETURN → ENTRY → LANDING → DONE。

**Steps:**
- [ ] **Step 1: 写失败测试**：`step(1)` 循环至 DONE，记录相位序列必须按上序完整出现；TRANSFER 段结束时月心距离 < SOI；MOON_LANDING 时高度 ≤0.01 km 且速度 ≤2 m/s；EARTH_RETURN 时地球高度 ≤120 km；全程不允许测试直接调用 `setPhase`。
- [ ] **Step 2: 运行确认 RED。**
- [ ] **Step 3: 实现 director**：调用 Task 1 积分与 Task 2 制导；燃烧用 `thrustFromIsp` 扣质量；相位切换由距离/高度/制导收敛触发；遥测 `body` 随参考天体切换。
- [ ] **Step 4: 运行测试 GREEN。**

---

### Task 4: PlaybackLoop 任务预设与真实比例渲染

**Files:** Modify `src/sim/PlaybackLoop.ts`、`tests/sim/PlaybackLoop.test.ts`、`src/render/Scene.ts`、`src/render/sceneScale.ts`

**Steps:**
- [ ] **Step 1: 写失败测试**：`new PlaybackLoop(10, 'lunar')` 的 director 为 LunarDirector，`phase` 走登月相位；`setMission('leo')` 后回到 LIFTOFF 且 director 为 PhysicsDirector；切任务后 `finished` 复位。
- [ ] **Step 2: 运行确认 RED。**
- [ ] **Step 3: `PlaybackLoop` 增加 `mission` 参数与 `setMission()`**；LUNAR 分支把相位推进交给 director，LEO 分支保持原逻辑。
- [ ] **Step 4: `Scene` 扩展**：新增月球球体；新增 `setMission()` 与 `setLunarFrame(body, craftPosKm, moonPosKm, phase)`；转移段用 1 unit = 1000 km，半径/间距比例真实；近地段恢复原尺度；巡航段箭体隐藏并显示位置标记。
- [ ] **Step 5: 运行测试 + 构建 GREEN。**

---

### Task 5: UI、文档、全量验证与提交

**Files:** Modify `index.html`、`src/main.ts`、`src/ui/TelemetryPanel.ts`、`src/state/store.ts`、`README.md`、`DESIGN.md`；brain 页 `crewed-spaceflight-sim`

**Steps:**
- [ ] **Step 1:** 增加任务选择下拉（近地任务 / 完整登月）；切换即重播；遥测显示参考天体（地球/月球）与真实高度/速度。
- [ ] **Step 2:** 文档与项目脑记录真实世界基线与边界（无外部星历/DEM）。
- [ ] **Step 3:** `pnpm test && pnpm build` GREEN。
- [ ] **Step 4:** 浏览器实测任务切换、登月自动播放、月球可见、遥测更新、暂停/重播正常、无 console error。
- [ ] **Step 5:** 用 eval `commit` namespace 提交。
