# 自动播放式航天任务模拟器 — 设计（2026-11-20）

## 意图

项目从“关卡达标推演游戏”改为“以观赏为目的的航天项目模拟器”：打开页面即自动播放一次完整载人任务（发射 → 上升 → 级间 → 入轨 → 在轨 → 交会 → 离轨 → 再入 → 着陆）。所有数字仍由现有物理模块计算，不伪造动画数据；界面只呈现过程与遥测，不做判定、不要求人工决策。

## 目标

- 启动即播放；LANDING 后停机保留末帧，可重播。
- 保留现有物理链（轨道 RK4/J2、部件热网络、结构振动、PLOC、成本）与渲染（场景、发射场、箭体、特效、六视角）。
- 遥测显示相位、时间、高度、速度、燃料、PLOC、成本、部件温度/振动；不显示决策记录。
- 展示控制：视角、倍速、暂停/继续、重播。
- 设计器保留开播前选型号/改级参数；去掉 Δv 达标判定与等级卡片。

## 非目标 / 反目标

- 关卡、预算/PLOC 达标、成功失败评分——任何“过关”语义都是反目标。
- 飞行中的中止/离轨决策按钮。
- 新物理模型、新渲染特性、新依赖。

## 约束

- `PhysicsDirector` 与 `Phase` 阶段机不动；自动过渡阈值只写在播控层。
- `store` 仍是遥测唯一出口，移除 `aborted` / `decisions` 字段。
- TypeScript / Vite / Vitest 工具链不变。

## 方案（已选 A）

- **A（选）**：保留物理/渲染内核，替换游戏外壳。删除 `src/game/levels.ts`、`src/ui/LevelPanel.ts`、`GameLoop.decide`；新建 `src/sim/PlaybackLoop.ts` 驱动全流程；`src/state/store.ts` 去游戏字段。改动集中，物理与渲染零改动。
- **B（否）**：全量重写时间轴播控器。重复已有自动推进逻辑，回归风险大。
- **C（否）**：只隐藏按钮/判定 UI。游戏代码留存，与“不再是游戏”冲突。

## 已定细节

- 目录：`src/game/` 整体删除，播控器放 `src/sim/PlaybackLoop.ts`；测试迁到 `tests/sim/`，删除关卡测试。
- 相位推进：沿用 LIFTOFF→ASCENT（3 km）、ASCENT→STAGE_SEP（120 km）、STAGE_SEP→ORBIT_INSERT（8 s 物理时间）、ORBIT_INSERT→ORBIT（剩余 Δv ≤ 60 m/s）。新增：ORBIT 驻留 8 s 墙钟 → RENDEZVOUS，RENDEZVOUS 驻留 5 s 墙钟 → DEORBIT；DEORBIT 持续至速度 ≤ 5500 m/s 或 180 s 物理时间（防卡死）；ENTRY 至高度 ≤ 3.2 km → LANDING；LANDING 驻留 4 s 墙钟后停机。
- 观赏段用墙钟计时、推进段用物理时间：倍速只加速飞行，不把在轨画面压成零点几秒。
- `PlaybackLoop` API：`start()` / `stop()` / `pause()` / `resume()` / `reset()` / `tick(dt)`；`tick` 仍是测试入口。
- 设计器改动载具即从头重播，避免飞行中换箭（我的取舍：比在飞行中热替换物理状态更可预测）。
- 测试：改写 `GameLoop.test.ts` 为播控测试，覆盖自动全流程到达 LANDING、暂停不推进、重播归零；删除关卡测试。

## 留给实现者

- 自动相位阈值若与 `PhysicsDirector` 实际轨迹不匹配，按测试观察到的高度/速度调整，不改物理模块。
