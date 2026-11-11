/**
 * Propellant combination database.
 * Values from DESIGN.md §4 table (combustion chamber temp, mean molecular
 * weight, typical O/F, density of oxidizer/fuel, ratio of specific heats γ,
 * and the vacuum-Isp band a well-expanded engine achieves with this combo).
 * Isp is computed at runtime by PropulsionEngine from T_c, M, γ — these
 * ranges are the expected validation band, not hand-entered performance.
 */
export interface Propellant {
  id: string;
  name: string;
  ofTypical: number;
  ispVacRange: [number, number];
  tcK: number;
  mGmol: number;
  rhoOx: number;
  rhoF: number;
  gamma: number;
}

export const PROPELLANTS: Record<string, Propellant> = {
  LOX_RP1: {
    id: 'LOX_RP1',
    name: 'LOX / RP-1',
    ofTypical: 2.3,
    ispVacRange: [330, 350],
    tcK: 3550,
    mGmol: 21.9,
    rhoOx: 1141,
    rhoF: 810,
    gamma: 1.23,
  },
  LOX_LH2: {
    id: 'LOX_LH2',
    name: 'LOX / LH2',
    ofTypical: 6.0,
    ispVacRange: [450, 465],
    tcK: 3580,
    mGmol: 8.9,
    rhoOx: 1141,
    rhoF: 70,
    gamma: 1.2,
  },
  NTO_MMH: {
    id: 'NTO_MMH',
    name: 'NTO / MMH',
    ofTypical: 2.37,
    ispVacRange: [300, 320],
    tcK: 3250,
    mGmol: 20.7,
    rhoOx: 1450,
    rhoF: 880,
    gamma: 1.22,
  },
  LOX_CH4: {
    id: 'LOX_CH4',
    name: 'LOX / CH4',
    ofTypical: 3.6,
    ispVacRange: [360, 380],
    tcK: 3520,
    mGmol: 18.2,
    rhoOx: 1141,
    rhoF: 422,
    gamma: 1.2,
  },
};
