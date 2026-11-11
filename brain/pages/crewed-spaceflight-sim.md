---
id: crewed-spaceflight-sim
title: "载人航天推演模拟器设计决策"
category: decision
status: active
tags: [simulation, physics, rocket]
created: "2026-11-09T23:28:13"
updated: "2026-11-11T12:24:52"
---

<!-- compiled_truth -->
<current best understanding — replace this with the real content>

## Timeline

- time: 2026-11-09T23:28:13
  kind: decision
  summary: "Created this page: 载人航天推演模拟器设计决策"
  source: created via brain create-page
  affects: [crewed-spaceflight-sim]

- time: 2026-11-09T23:30:43
  kind: decision
  summary: "扩展火箭方案族: 历史(Saturn V)/传统(Soyuz)/航天飞机(Shuttle)/现代重设计(Falcon9推进逃逸,Starship全复用甲烷)/用户自研甲烷复用. 固体助推=点火不可关→PLOC↑(Challenger); 重复使用=结构↑/回收Δv预留/成本摊销. DESIGN.md 4a节."
  source: DESIGN.md
  affects: [crewed-spaceflight-sim]

- time: 2026-11-10T00:23:51
  kind: decision
  summary: "方案族分两层: 4a工程实现(SaturnV/Shuttle/F9/Starship/自研) + 4b概念理论(NERVA核热/离子/太阳帆/猎户座核脉冲/聚变Daedalus/行星发动机). 概念方案用真实物理做可行性核算: 行星发动机=地球5.97e24kg,需F~6e19N,ve~10km/s则年耗~3%地球质量烧穿地壳→物理不可行. 不破坏'所有数据符合物理'约束,数字真实结论真实. 非化学分支(核热/电推进)Isp直接给定,仅化学走燃烧核算."
  source: DESIGN.md
  affects: [crewed-spaceflight-sim]

- time: 2026-11-10T00:42:30
  kind: decision
  summary: "追加航天器系统物理: 6a结构强度(薄壁应力σ=pr/t,屈服强度,安全系数1.4)+热(Sutton-Graves气动加热q̇=1.83e-4√(ρ/r_n)v³,辐射平衡温度)+电力EPS(太阳常数1361W/m²,阴影期36min). 6b ECLSS生保(O2 0.84kg/人/日,水2.7L,食物0.62kg,代谢热100W)消耗品质量计入载荷预算. 6c材料温度依变(橡胶Tg低温失弹=Challenger O-ring,金属DBTT,低温boil-off,TPS热限). 6d辐射(GCR 0.5-1mSv/日,SPE太阳风暴Sv级,范艾伦带,聚乙烯屏蔽,阈值>1Sv放射病). 6e历史事故复现: Apollo1纯氧火/Challenger O-ring/Soyuz11失压/Apollo13 O2罐/Columbia泡沫TPS. 所有事故链由物理模型判定非脚本."
  source: DESIGN.md
  affects: [crewed-spaceflight-sim]

- time: 2026-11-10T00:52:20
  kind: decision
  summary: "追加: 6f历史任务库(NASA Mercury/Gemini/Apollo/Skylab/STS/Hubble修复/SpaceX Demo-2;苏联 Vostok/Voskhod/Soyuz/Salyut礼炮号/Mir/Buran;中国神舟/天宫;ISS). 任务场景分类:发射入轨/空间站(交会对接驻留)/维修(Hubble EVA)/事故复现. 礼炮号:Salyut1+Soyuz11归途失压;Salyut7(1985)失电抢救对接. 计划增 Task10b ECLSS/10c MaterialThermal/10d Radiation/10e AccidentScenarios/10f MissionLibrary."
  source: DESIGN.md
  affects: [crewed-spaceflight-sim]

- time: 2026-11-10T01:48:14
  kind: evidence
  summary: "LEO首版实现完成: 17物理模块+director+scene+rigidbody+gameloop+UI+main端到端. 验证: tsc干净, 150/150测试绿, vite build成功. 物理锚已验: LOX/RP1 Isp 338.2s(330-350区间), 400km圆轨道7672m/s漂移<0.1%, Saturn V过9.4km/s校验, maxQ 22.5kPa, Challenger低温O-ring prob>常温, mass_driver地表不可行. 20次提交."
  source: "git log; npm test"
  affects: [crewed-spaceflight-sim]

- time: 2026-11-10T08:09:53
  kind: decision
  summary: "三项UI/正确性增强: (1)修复PLOC接线根因——PhysicsDirector硬编码solidBoosterLit/escapeSystem='tower'导致固推与推进逃逸PLOC无差异; 改为setVehicle(escapeSystem,hasSolidBooster)喂入真实配置(Shuttle tower+固推 vs Falcon9 propulsive). (2)多视角相机: orbit/chase/ground/cockpit/overview. (3)UI中文化. Archetype新增escapeSystem字段."
  source: "src/director; src/ui"
  affects: [crewed-spaceflight-sim]

- time: 2026-11-10T10:16:36
  kind: decision
  summary: "修复发射卡LIFTOFF: GameLoop新增autoAdvance(dt)按高度/Δv自动推进 LIFTOFF(3km)→ASCENT(120km)→STAGE_SEP(8s coast)→ORBIT_INSERT(Δv≤60)→ORBIT; 新增warp时间倍速(构造参数+setWarp+UI选择器, 默认10×). ORBIT后停住等待用户离轨决策. 回归测试验证到ORBIT."
  source: src/game/GameLoop.ts
  affects: [crewed-spaceflight-sim]

- time: 2026-11-10T11:08:51
  kind: decision
  summary: "修复画面不动的根因: 视觉原由RigidBodyAscent(cannon-es,实时dt)驱动,而director(warp 10-50x)自动推进阶段在~0.2s内关闭推力窗口,导致cannon物体几乎不动即下落. 改为单一事实源: main每帧用director.positionKm()驱动Scene.setRocketPosition/addTrajectoryPoint, 删除RigidBodyAscent(死代码). 新增指挥室视角(control,默认)."
  source: "src/main.ts;src/render/Scene.ts"
  affects: [crewed-spaceflight-sim]

- time: 2026-11-10T11:43:43
  kind: decision
  summary: "渲染层从 Three.js 迁移到 Babylon.js(@babylonjs/core): 原生TS、ParticleSystem(GPU粒子)、GlowLayer(再入)、PBR、Inspector;物理/测试不动. 先做详细火箭模型(多级/喷管簇/级间环/逃逸塔/固体助推/尾翼). 保持Scene公开API(setView/setPhase/setRocketPosition/addTrajectoryPoint/update/setVehicle). 选Babylon理由: TS全栈契合+内置视觉工具链; 轨道物理仍自研RK4(引擎刚体物理对轨道无用)."
  source: src/render
  affects: [crewed-spaceflight-sim]

- time: 2026-11-11T11:51:30
  kind: decision
  summary: "计划T16的『入轨速度误差<0.1%』拆成两条可验证命题: (1) 入轨瞬间速度=当地圆轨道速度, 误差0.00%(circularize构造, GameLoop测试断言<0.1%); (2) 长期漂移用步长收敛性证明: 同一400km圆轨道跑一整圈, dt=10s与dt=0.5s末态半径/速度差<0.01%, 说明RK4数值误差远小于阈值. 另测得J2使LEO瞬时速度围绕当地圆速度摆动0.144%, 且dt=0.5…30s不变, 属物理摄动而非积分误差, 因此遥测面板绿色阈值取0.2%."
  source: "tests/game/GameLoop.test.ts;tests/physics/OrbitalIntegrator.test.ts;src/ui/TelemetryPanel.ts"
  affects: [crewed-spaceflight-sim]

- time: 2026-11-11T12:19:05
  kind: decision
  summary: "项目更名为 FlightMargin（adam-ikari/flightmargin），Pages 新地址 https://adam-ikari.github.io/flightmargin/。原因：模拟器的产出是各部件余量（温度/振动离上限多远），旧名 gotothemoon 读起来像休闲游戏。里程碑：ComponentThermal.ts 与 StructuralDynamics.ts 已提交，200 测试通过；锚点更正——1 MW/m² ε=0.85 辐射平衡是 2130 K，3796 K 对应 10 MW/m²，碳 3500 K 上限约 7.2 MW/m²。"
  source: "rename + component modules commit f4f2b20"
  affects: [crewed-spaceflight-sim]

- time: 2026-11-11T12:24:52
  kind: decision
  summary: "最终名称：显示名「航天模拟器」，仓库 adam-ikari/spaceflight-simulator，Pages https://adam-ikari.github.io/spaceflight-simulator/。gotothemoon 与 FlightMargin 均为临时名，不再使用。"
  source: "user: 就叫航天模拟器"
  affects: [crewed-spaceflight-sim]
