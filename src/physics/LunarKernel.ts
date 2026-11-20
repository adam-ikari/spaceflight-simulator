import wasmBytes from './lunar_kernel.wasm?bytes';
import { CONST } from './constants';
import type { OrbitState } from './OrbitalIntegrator';

const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes));
const memory = instance.exports.memory as WebAssembly.Memory;
const kernel = instance.exports.lunar_rk4 as (
  statePtr: number,
  dt: number,
  muEarth: number,
  muMoon: number,
  phase: number,
  omega: number,
  sma: number,
  epoch: number,
) => void;

const STATE_PTR = 1024;
const stateBuf = new Float64Array(memory.buffer, STATE_PTR, 7);

/** RK4 integration with the same Earth+Moon point-mass model as LunarDynamics. */
export function stepLunarRK4Wasm(
  state: OrbitState,
  dtSec: number,
  phaseRad: number,
  moonOmega: number,
  moonSmaM: number,
  epochSec = 0,
): OrbitState {
  stateBuf[0] = state.pos[0];
  stateBuf[1] = state.pos[1];
  stateBuf[2] = state.pos[2];
  stateBuf[3] = state.vel[0];
  stateBuf[4] = state.vel[1];
  stateBuf[5] = state.vel[2];
  stateBuf[6] = state.t;

  kernel(
    STATE_PTR,
    dtSec,
    CONST.MU_EARTH,
    CONST.MU_MOON,
    phaseRad,
    moonOmega,
    moonSmaM,
    epochSec,
  );

  return {
    pos: [stateBuf[0], stateBuf[1], stateBuf[2]],
    vel: [stateBuf[3], stateBuf[4], stateBuf[5]],
    t: state.t + dtSec,
  };
}
