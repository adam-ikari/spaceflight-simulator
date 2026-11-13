# Implementation Ledger — crewed-spaceflight-leo

Plan: docs/superpowers/plans/2026-11-10-crewed-spaceflight-leo.md

## Preflight scan (file/interface conflicts)

| pair | produces→consumes | finding |
|---|---|---|
| T2→T3 | PROPELLANTS,CONST → computeEngine | ordered dep, ok |
| T3→T4 | computeEngine → stagePerformance | ordered dep, ok |
| T4→T5 | StageSpec type → archetypes | type dep, ok |
| T4,T6→T8 | stagePerformance,density → AscentDynamics | dep, ok |
| T10b,T10c,T6→T10e | LifeSupport,MaterialThermal,Atmosphere → AccidentScenarios | dep, ok |
| T5,T10b,T10e,T4→T10f | archetypes,LifeSupport,AccidentScenarios,StageSpec → MissionLibrary | dep, ok |
| T1→all | project scaffold | foundation, ok |

No file conflicts (each task distinct file). Global-constraint anchors present in tests: Isp 330-350s(T3), 9.4km/s(T4), solid abort=0(T9), 7672m/s+<0.1%(T7). Scan clean.

## Rulings
- Task1(scaffold)+Task2(constants+propellants) combined into one implementer: tightly coupled foundation, both leaf.
- Dispatch order: T1+2 first → parallel wave(leaf modules needing only constants: T6 Atmosphere, T7 Orbital, T9 Risk, T10 Cost, T10b LifeSupport, T10c MaterialThermal, T10d Radiation) → T3 → T4 → T5,T8,T10e → T10f → integration 11+.

## Progress
- Task1+2 (scaffold+constants+propellants): DONE commit 37089a6
- Task6 Atmosphere: DONE 8f1c7c1
- Task7 OrbitalIntegrator: DONE d1b3d7d (400km drift<0.1% verified)
- Task9 RiskModel: DONE 938012c
- Task10 CostModel: DONE a7c7f1c
- Task10b LifeSupport: DONE 87835f2
- Task10d Radiation: DONE 57168f3
- Task3 PropulsionEngine: RUNNING
- Task10c MaterialThermal: RUNNING
- Next wave (blocked on running): T4(RocketEquation←T3), T5(archetypes←T4), T8(Ascent←T4+T6), T10e(Accident←T10b+T10c+T6), T10f(MissionLib←T5+T10b+T10e+T4)
- Task3 PropulsionEngine: DONE d04d171 (Isp 338.2s in band)
- Task10c MaterialThermal: DONE e06caf1
- Task4 RocketEquation: DONE 2628055
- Task10e AccidentScenarios: DONE 0750e97 (5 scenarios physics-chained)
- Task5 Archetypes: DONE 17d8fa2 (12 archetypes)
- Task8 AscentDynamics: DONE b53e545 (maxQ 22.5kPa, losses<3000)
- Task10g Weather: DONE 7467159
- Task10h ConceptSchemes: DONE 902a59b (9 concepts + feasibility)
- Task10f MissionLibrary: DONE a4cc69f (17 missions)
- PHYSICS CORE COMPLETE: 131/131 green, 17 modules.
- Integration remaining: T11 PhysicsDirector, T12 Scene, T13 cannon ascent, T14 GameLoop, T15 UI, T16 wire

## COMPLETE
- T11 PhysicsDirector: eb83519
- T12 Scene: 72aeb87
- T13 RigidBodyAscent: 00d2615
- T14 GameLoop: 670286d
- T15 UI: 5d220c3
- T16 Wire: 4ed25d8
- FINAL: tsc clean, 150/150 tests, vite build OK. All 16(+8 ext) tasks done.
- ENHANCEMENT (post-MVP): vehicle-aware PLOC fix (director setVehicle) + Chinese UI + multi-camera views (DominantBeetle agent).
- FIX: launch stuck at LIFTOFF — GameLoop.autoAdvance now drives ascent→orbit; warp time-accel (default 10x) + UI selector. Verified reaches ORBIT in browser.
- FIX: static render — visuals now driven by director.positionKm() (single source); removed decoupled cannon RigidBodyAscent; added 指挥室/control view (default). Canvas region pixel-diff 4.84% confirms motion.
- RENDER: Three.js → Babylon.js 9.35 (commit 586c1b1). Verified in headless Chromium: WebGL2 context, no page errors, screenshots show Earth/rocket/plume/trajectory across PAD → ASCENT → ORBIT.
- T16 GAP CLOSED: store + telemetry now carry altitudeKm/speedMs and show 圆轨道速度 + 速度偏差 (sqrt(μ/r) comparison).
  Acceptance split in two: insertion speed error 0.00% (asserted <0.1%); long-term RK4 quality via step-size convergence (dt 10 s vs 0.5 s, one orbit, <0.01%). Measured J2 wobble on instantaneous speed = 0.144% independent of dt (0.5…30 s) → physical, not integrator error; UI green band is 0.2%.
- ROCKET PROPORTIONS: geometry moved to src/render/vehicleGeometry.ts — stage tank volume = propellant mass / bulk density at the mixture ratio, stack fineness 10:1, one uniform exaggeration factor (4) for visibility. Fixed LOX_LH2 rhoOx 70 → 1141 (LH2 stages were absurdly long). Solid first stage renders as a side-booster pair (Shuttle layout) instead of an inline cylinder; booster length capped at 0.96× core body.
- CAMERA: pad-relative views now use the local vertical as upVector (horizon level, rocket upright instead of sideways).
- TESTS: 164/164 green; tsc clean; vite build OK.
- COMPONENT THERMAL + STRUCTURAL CORES (commit f4f2b20): `ComponentThermal.ts` (implicit lumped node, Sutton–Graves, ablation sink, series-resistance regen wall, boil-off) + `StructuralDynamics.ts` (pogo SDOF, first bending, Miles, Miner, over-limit probability). 200 tests green, tsc clean.
- ANCHOR CORRECTION: 1 MW/m² with ε=0.85 radiates at 2130 K, not 3796 K. 3796 K requires 10 MW/m²; the carbon 3500 K limit is ≈7.2 MW/m². Earlier note in the pre-implementation summary was off by 10×; tests now pin the correct values.
- NAME: repo and app renamed gotothemoon → FlightMargin (`adam-ikari/flightmargin`); Pages URL becomes https://adam-ikari.github.io/flightmargin/. README added with anchors and limits.
- NAME (final): 显示名“航天模拟器”，仓库 `adam-ikari/spaceflight-simulator`；Pages https://adam-ikari.github.io/spaceflight-simulator/。FlightMargin/gotothemoon 均为临时名。
- ATMOSPHERE FIX: replaced the layered exponential (50 km ≈ 3.6e-2 kg/m³, 35× the standard) with the USSA-1976 density table (log-linear interpolation). 60 km is now 3.10e-4 kg/m³; 60 km / 7.6 km/s entry flux is 1.4 MW/m², not 6.7. Saturn V max-q falls to 19.6 kPa, so the old 20 kPa test floor was recalibrated to 15–50 kPa (the floor had been passing because the density was wrong).
- COMPONENT WIRING: `ComponentSystems.ts` builds per-stage tank/chamber/nozzle + TPS/avionics/cabin, steps them with phase-dependent heating, and emits thermal/pogo/TPS/fatigue failure branches. `RiskModel` unions those branches into PLOC; `PhysicsDirector.setVehicle(..., stages, payload)` builds the network; store/telemetry panel show the five hottest components, pogo, random g, bending and boil-off. 218 tests green.
