# 航天模拟器

> 英文仓库名：`spaceflight-simulator`。

浏览器内的载人航天部件级推演模拟器。它回答一个问题：**给定这个飞行器设计和这条任务，真实实施会成功吗？**

“余量”是这个模拟器的产出：发动机壁温离材料上限还有多少、贮箱每天蒸发多少推进剂、pogo 振动会不会超过机组耐受、热防护在再入热流下是否烧穿。每个数字都从物理量算出来，且能在测试里复算。

在线运行：<https://adam-ikari.github.io/spaceflight-simulator/>

## 模拟了什么

| 域 | 方法 | 代码 |
|---|---|---|
| 燃烧化学 | 混合比 O/F → 室温和平均分子量 → c* / Cf / Isp | `src/physics/CombustionChemistry.ts`、`PropulsionEngine.ts` |
| 部件热网络 | 每个部件独立节点，隐式求解辐射/对流/烧蚀/再生冷却 | `src/physics/ComponentThermal.ts` |
| 结构振动 | pogo 单自由度响应、一阶弯曲、Miles 随机振动、Miner 疲劳 | `src/physics/StructuralDynamics.ts` |
| 轨道力学 | RK4 + J2 摄动 | `src/physics/OrbitalIntegrator.ts` |
| 大气/气动加热 | 分层指数大气 + Sutton–Graves 驻点热流 | `Atmosphere.ts`、`ComponentThermal.ts` |
| 风险/成本 | 故障树 PLOC、成本模型 | `RiskModel.ts`、`CostModel.ts` |

部件节点包括：发动机壁、喷管、各级贮箱、热防护、电子舱、乘员舱。热平衡按集总热容隐式求解，所以在任务积分器的粗时间步下仍然稳定；温度可以超过材料上限并被风险模型看见，求解器不会把超温截断。

## 物理锚点（均有单测）

| 量 | 值 | 来源 |
|---|---|---|
| 太阳平衡温度（α=ε） | 394 K | α·S = ε·σ·T⁴，S = 1361 W/m² |
| 1 MW/m²、ε=0.85 的辐射平衡 | 2130 K | Stefan–Boltzmann |
| 10 MW/m²、ε=0.85 的辐射平衡 | 3796 K | 同上 |
| 碳烧蚀 3500 K 对应热流 | ≈7.2 MW/m² | 同上 |
| Sutton–Graves：60 km、7.6 km/s、1 m 头锥 | ≈1.4 MW/m² | q = 1.83e-4·√(ρ/Rₙ)·V³ |
| 发动机壁温（7 MPa、100 kg/s） | 600–900 K | 气膜/铜衬/冷却剂串联热阻 |
| 发动机壁温（20 MPa、500 kg/s，SSME 级） | 600–900 K | 同上 |
| Saturn V 级 pogo 频率 | 5.5 Hz ±0.5 | √(k/m)，m_eff = 0.1% 推进剂 |
| pogo 共振放大 | Q = 20 | 单自由度 |
| 2.5% 泵流量脉动 → 结构加速度 | ≈0.6 g（Apollo 6 量级） | A = Q，T/W ≈ 1.2 |
| 随机振动 0.04 g²/Hz @150 Hz、Q=10 | 9.7 g_rms | Miles 方程 |
| LH2 贮箱 200 W 漏热 | 38.7 kg/day | 汽化潜热 446 kJ/kg |

## 运行

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm test     # vitest
pnpm build    # tsc + vite build
```

## 部署

推送到 `master` 后，`.github/workflows/deploy.yml` 依次执行安装、测试、构建，再用 GitHub Pages 发布。Vite 使用相对资源路径（`base: './'`），所以项目页和域名根都能跑。

## 明确的限制

- 集总参数模型，不是 FEM/CFD；温度场是节点平均值，不是空间分布。
- O/F 对室温和分子量的影响是对公开 Isp–O/F 曲线的工程拟合，不是 CEA 物种平衡；接口留了替换点。
- 任务主任（`PhysicsDirector`）目前是粗粒度质点：固定上升加速度与 9.4 km/s 预算，入轨速度直接赋值。部件状态已接入，但轨迹本身还不是从各级推力和质量实时积分出来的。
- 这些数字用于判断方案是否成立，不能用于飞行认证。

## 项目名

仓库地址：<https://github.com/adam-ikari/spaceflight-simulator>。此前的 `gotothemoon`、`flightmargin` 都是临时名，GitHub 会重定向旧仓库地址；Pages 地址以 <https://adam-ikari.github.io/spaceflight-simulator/> 为准。
