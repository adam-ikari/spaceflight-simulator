# 自动播放式航天任务模拟器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打开页面自动播放一次完整载人任务，只呈现物理遥测，不提供关卡判定或飞行决策。

**Architecture:** 保留 `PhysicsDirector` 与全部物理/渲染模块；删除 `src/game/` 的关卡与决策代码，代之以 `src/sim/PlaybackLoop.ts` 自动推进相位。`store` 继续作为遥测出口，去掉游戏字段；UI 只保留展示控制（视角、倍速、暂停/继续、重播）。

**Tech Stack:** TypeScript 5.6、Vite 5、Vitest 2、Babylon.js、cannon-es；无新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-20-autoplay-simulator-design.md`

## Global Constraints

- 不修改 `src/physics/**`、`src/director/**`、`src/render/**`。
- `Phase` 顺序固定：PAD → LIFTOFF → ASCENT → STAGE_SEP → ORBIT_INSERT → ORBIT → RENDEZVOUS → DEORBIT → ENTRY → LANDING；不得跳相。
- 倍速只作用于物理时间；驻留段按墙钟秒计时。
- 无新增依赖；提交前 `pnpm build` 与 `pnpm test` 均须通过。

## Review Focus

- 打开页面停在 PAD 等点击 → Task 3 浏览器验证首帧自动进入 LIFTOFF。
- 倍速 50× 把在轨观赏压成瞬间 → Task 2 加 `warp=50` 驻留测试。
- 飞行中改设计器导致箭体热替换 → Task 2 加 `setVehicle` 即重置测试。
- LANDING 后时间继续跑 → Task 2 全流程测试断言停机后 `t` 不变。
- 暂停时渲染停摆 → Task 3 浏览器验证暂停后视角切换仍响应。

---

### Task 1: 遥测状态去游戏字段，删除关卡 UI

**Files:**
- Modify: `src/state/store.ts`、`src/ui/TelemetryPanel.ts`
- Delete: `src/game/levels.ts`、`src/ui/LevelPanel.ts`、`tests/game/level1.test.ts`、`tests/game/GameLoop.test.ts`
- Create: `tests/sim/store.test.ts`

**Interfaces:**
- Consumes: `SystemsSnapshot` from `../physics/ComponentSystems`（不变）。
- Produces: `SimState`（替代 `GameState`）字段 `phase, t, altitudeKm, speedMs, ploc, costUsd, fuelPct, systems`；`store.get()/set(partial)/subscribe(listener)` 不变。

**Steps:**
- [ ] **Step 1: 写失败测试** `tests/sim/store.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { store } from '../../src/state/store';

describe('telemetry store', () => {
  it('mirrors set() to subscribers and get()', () => {
    const seen: number[] = [];
    const off = store.subscribe((s) => seen.push(s.t));
    store.set({ t: 5 });
    store.set({ t: 9 });
    off();
    expect(store.get().t).toBe(9);
    expect(seen).toEqual([5, 9]);
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm exec vitest run tests/sim/store.test.ts`；Expected: FAIL（模块不存在）。
- [ ] **Step 3: 改 `src/state/store.ts`** — `GameState` → `SimState`；删除 `aborted`、`decisions` 字段与初值；其余保持。
- [ ] **Step 4: 改 `src/ui/TelemetryPanel.ts`** — import `SimState`；删除 `decisions` 局部变量、`最近决策` 列表、`已中止` 行；`systemRows(s: SimState)` 同步改名。
- [ ] **Step 5: 删除列出的 4 个游戏文件。**
- [ ] **Step 6: 运行测试** — `pnpm exec vitest run tests/sim/store.test.ts`；Expected: PASS。此时 `src/game/GameLoop.ts` 仍引用旧字段，类型检查留到 Task 2。

---

### Task 2: 新建自动播控器并替换 GameLoop

**Files:**
- Create: `src/sim/PlaybackLoop.ts`、`tests/sim/PlaybackLoop.test.ts`
- Delete: `src/game/GameLoop.ts`

**Interfaces:**
- Consumes: `PhysicsDirector`（`step(dt)`、`setPhase(Phase)`、`setVehicle(escapeSystem, hasSolidBooster, stages?, payloadKg?)`、`telemetry()`、`positionKm()`）；`store` / `SimState`；`Phase`。
- Produces: `new PlaybackLoop(warp = 1)`；方法 `start(): void`、`stop(): void`、`pause(): void`、`resume(): void`、`reset(): void`、`setWarp(warp: number): void`、`setVehicle(...args: Parameters<PhysicsDirector['setVehicle']>): void`、`tick(dtWallSec: number): void`；属性 `phase: Phase`、`get director(): PhysicsDirector`（供场景读取位置/相位）。`reset()` 重建 director、恢复上次载具配置、直接进入 LIFTOFF 并同步 store。`setVehicle` 保存配置并调用 `reset()`。`tick` 在暂停或 LANDING 驻留结束后为 no-op。

**Steps:**
- [ ] **Step 1: 写失败测试** `tests/sim/PlaybackLoop.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PlaybackLoop } from '../../src/sim/PlaybackLoop';
import { store } from '../../src/state/store';

describe('PlaybackLoop', () => {
  beforeEach(() => new PlaybackLoop().reset());

  it('mirrors director telemetry into the store', () => {
    const loop = new PlaybackLoop(10);
    loop.tick(0.1);
    const s = store.get();
    expect(s.phase).toBe('LIFTOFF');
    expect(s.t).toBeGreaterThan(0);
    expect(s.altitudeKm).toBeGreaterThanOrEqual(0);
    expect(s.fuelPct).toBeLessThanOrEqual(100);
  });

  it('reaches LANDING automatically and stops the clock', () => {
    const loop = new PlaybackLoop(10);
    for (let i = 0; i < 4000 && loop.phase !== 'LANDING'; i++) loop.tick(0.1);
    expect(loop.phase).toBe('LANDING');
    const t = store.get().t;
    for (let i = 0; i < 100; i++) loop.tick(0.1);
    expect(store.get().t).toBe(t);
  });

  it('keeps orbit dwell in wall time at warp 50', () => {
    const loop = new PlaybackLoop(50);
    for (let i = 0; i < 4000 && loop.phase !== 'ORBIT'; i++) loop.tick(0.1);
    expect(loop.phase).toBe('ORBIT');
    for (let i = 0; i < 50; i++) loop.tick(0.1); // 5 s wall < 8 s dwell
    expect(loop.phase).toBe('ORBIT');
  });

  it('pause freezes physics, resume continues', () => {
    const loop = new PlaybackLoop(10);
    loop.tick(0.1);
    const t = store.get().t;
    loop.pause();
    loop.tick(0.1);
    expect(store.get().t).toBe(t);
    loop.resume();
    loop.tick(0.1);
    expect(store.get().t).toBeGreaterThan(t);
  });

  it('setVehicle restarts playback from LIFTOFF', () => {
    const loop = new PlaybackLoop(10);
    for (let i = 0; i < 20; i++) loop.tick(0.1);
    loop.setVehicle('tower', false);
    expect(loop.phase).toBe('LIFTOFF');
    expect(store.get().t).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm exec vitest run tests/sim/PlaybackLoop.test.ts`；Expected: FAIL（模块不存在）。
- [ ] **Step 3: 实现 `src/sim/PlaybackLoop.ts`** — 阈值：ASCENT_KM=3、STAGE_SEP_KM=120、SEP_COAST_S=8（物理秒）、INSERT_DONE_MS=60、ORBIT_DWELL_WALL_S=8、RENDEZVOUS_DWELL_WALL_S=5、DEORBIT_SPEED_MS=5500、DEORBIT_MAX_S=180（物理秒）、ENTRY_TARGET_KM=3.2、LANDING_DWELL_WALL_S=4。相位切换统一走一个 `go(next)` helper，切换时清零驻留/离轨计时。`start/stop` 只管 RAF；`tick(dt)` 实现上述逻辑并调用 `store.set({...telemetry})`。
- [ ] **Step 4: 运行测试** — `pnpm exec vitest run tests/sim/PlaybackLoop.test.ts`；Expected: PASS。若 `DEORBIT` 卡死或 `ENTRY` 高度不收敛，只调阈值，不改物理模块。
- [ ] **Step 5: 全量测试 + 构建** — `pnpm test && pnpm build`；Expected: PASS（旧 `GameLoop` 已删）。

---

### Task 3: UI 切到播控，去掉决策按钮与达标判定

**Files:** Modify `index.html`、`src/main.ts`、`src/ui/RocketDesigner.ts`

**Interfaces:**
- Consumes: `PlaybackLoop`（Task 2）；`Scene.setView(ViewMode)`；`RocketDesigner` 回调 `(stages, payloadKg, config) => void`。
- Produces: 无新增导出；页面首帧自动播放。

**Steps:**
- [ ] **Step 1: 改 `index.html`** — 标题/品牌改“航天项目模拟器”；删除 `#launch`、`#abort`、`#deorbit` 按钮；新增 `#pause`（“暂停”，点击后文案切“继续”）与 `#replay`（“重播”）；保留视角/倍速下拉。
- [ ] **Step 2: 改 `src/main.ts`** — 用 `PlaybackLoop` 替换 `GameLoop`；删除三个决策监听；接 `#pause` → `pause()/resume()` 并切按钮文案，`#replay` → `reset()`；设计器回调内先 `playback.setVehicle(...)`（会重置播放）再 `scene.setVehicle(...)`；RAF 每帧 `playback.tick(dt)` 后用 `playback.director`（Task 2 的 getter）读取 `positionKm()` / `phase` 同步场景。
- [ ] **Step 3: 改 `src/ui/RocketDesigner.ts`** — 删除 `LEO_DV` 常量与 `reachable`/`verdictColor`/`verdict` 及 verdict DOM；保留 `validateRocket`/`RocketValidation`（物理校验错误/警告）、各级比冲/Δv/推重比读数；文件头注释删除“9.4 km/s LEO verdict”。
- [ ] **Step 4: 构建** — `pnpm build`；Expected: PASS。
- [ ] **Step 5: 浏览器验证** — 启动 `pnpm dev`，打开首页：首帧自动进入 LIFTOFF（无点击）；视角切换在空中生效；暂停后 `t` 停住但视角仍可切；重播后回到 LIFTOFF 且 `t≈0`；快进到 LANDING 后画面停住。Expected: 五项均成立。

---

### Task 4: 文档与项目记忆同步，提交

**Files:** Modify `README.md`、`DESIGN.md`；brain 页面 `crewed-spaceflight-sim`

**Steps:**
- [ ] **Step 1: 改 `README.md`** — 定位从“推演游戏/成功吗/达标”改为“观赏用航天项目模拟器/自动播放完整任务”；删关卡与决策描述，保留物理表格与锚点；控制说明改为视角/倍速/暂停/重播。
- [ ] **Step 2: 改 `DESIGN.md`** — 第 3 行与第 11 行的“推演游戏/用户实时决策”改为观赏型自动播放；§8“游戏循环与决策”改为“自动播控与相位推进”，列相位阈值；§124/139/160 的“游戏决策/游戏”措辞改为“遥测/任务流程”。
- [ ] **Step 3: 更新项目脑** — 用 `brain update-truth --id crewed-spaceflight-sim`（stdin 传新 compiled_truth）记录方向反转；事实点：2026-11-20 起为观赏型自动播放模拟器，非游戏；物理/渲染内核不变，关卡与决策层删除；播控阈值见设计文档；并 `brain append-timeline --kind reversal` 记录原因。
- [ ] **Step 4: 终检** — `pnpm test && pnpm build`；Expected: PASS。
- [ ] **Step 5: 提交** — 用 eval 的 `commit` namespace（`d = await commit.draft()`，`await d.commit("feat: autoplay spectator spaceflight simulator", [...])`），不用 `git add`/`git commit`。
