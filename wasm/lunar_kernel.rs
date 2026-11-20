//! Apollo lunar transfer RK4 kernel. State layout: [px,py,pz,vx,vy,vz,t].
//! Build: rustc --edition 2021 --target wasm32-unknown-unknown -C opt-level=3 \
//!   -C panic=abort --crate-type cdylib wasm/lunar_kernel.rs -o /tmp/lunar.wasm \
//!   && wasm-opt -Oz --strip-debug /tmp/lunar.wasm -o src/physics/lunar_kernel.wasm

#[inline(always)]
fn acceleration(pos: [f64; 3], t: f64, mu_earth: f64, mu_moon: f64, phase: f64, omega: f64, sma: f64) -> [f64; 3] {
    let r2 = pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2];
    let r = r2.sqrt().max(1e-6);
    let k_earth = -mu_earth / (r * r * r);

    let theta = phase + omega * t;
    let moon = [sma * theta.cos(), sma * theta.sin(), 0.0];
    let d = [pos[0] - moon[0], pos[1] - moon[1], pos[2] - moon[2]];
    let d = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt().max(1e-3);
    let k_moon = -mu_moon / (d * d * d);

    [k_earth * pos[0] + k_moon * (pos[0] - moon[0]), k_earth * pos[1] + k_moon * (pos[1] - moon[1]), k_earth * pos[2]]
}

#[no_mangle]
pub unsafe extern "C" fn lunar_rk4(
    ptr: *mut f64,
    dt: f64,
    mu_earth: f64,
    mu_moon: f64,
    phase: f64,
    omega: f64,
    sma: f64,
) {
    let s = core::slice::from_raw_parts_mut(ptr, 7);
    let pos = [s[0], s[1], s[2]];
    let vel = [s[3], s[4], s[5]];
    let t = s[6];

    let a1 = acceleration(pos, t, mu_earth, mu_moon, phase, omega, sma);
    let p2 = [pos[0] + vel[0] * dt * 0.5, pos[1] + vel[1] * dt * 0.5, pos[2] + vel[2] * dt * 0.5];
    let v2 = [vel[0] + a1[0] * dt * 0.5, vel[1] + a1[1] * dt * 0.5, vel[2] + a1[2] * dt * 0.5];
    let a2 = acceleration(p2, t + dt * 0.5, mu_earth, mu_moon, phase, omega, sma);
    let p3 = [pos[0] + v2[0] * dt * 0.5, pos[1] + v2[1] * dt * 0.5, pos[2] + v2[2] * dt * 0.5];
    let v3 = [vel[0] + a2[0] * dt * 0.5, vel[1] + a2[1] * dt * 0.5, vel[2] + a2[2] * dt * 0.5];
    let a3 = acceleration(p3, t + dt * 0.5, mu_earth, mu_moon, phase, omega, sma);
    let p4 = [pos[0] + v3[0] * dt, pos[1] + v3[1] * dt, pos[2] + v3[2] * dt];
    let v4 = [vel[0] + a3[0] * dt, vel[1] + a3[1] * dt, vel[2] + a3[2] * dt];
    let a4 = acceleration(p4, t + dt, mu_earth, mu_moon, phase, omega, sma);

    let sixth = dt / 6.0;
    s[0] = pos[0] + sixth * (vel[0] + 2.0 * v2[0] + 2.0 * v3[0] + v4[0]);
    s[1] = pos[1] + sixth * (vel[1] + 2.0 * v2[1] + 2.0 * v3[1] + v4[1]);
    s[2] = pos[2] + sixth * (vel[2] + 2.0 * v2[2] + 2.0 * v3[2] + v4[2]);
    s[3] = vel[0] + sixth * (a1[0] + 2.0 * a2[0] + 2.0 * a3[0] + a4[0]);
    s[4] = vel[1] + sixth * (a1[1] + 2.0 * a2[1] + 2.0 * a3[1] + a4[1]);
    s[5] = vel[2] + sixth * (a1[2] + 2.0 * a2[2] + 2.0 * a3[2] + a4[2]);
    s[6] = t + dt;
}
