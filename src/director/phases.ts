/** Mission phases in flight order — DESIGN.md §8 game loop. */
export type Phase =
  | 'PAD'
  | 'LIFTOFF'
  | 'ASCENT'
  | 'STAGE_SEP'
  | 'ORBIT_INSERT'
  | 'ORBIT'
  | 'RENDEZVOUS'
  | 'DEORBIT'
  | 'ENTRY'
  | 'LANDING';

export const PHASE_ORDER: Phase[] = [
  'PAD',
  'LIFTOFF',
  'ASCENT',
  'STAGE_SEP',
  'ORBIT_INSERT',
  'ORBIT',
  'RENDEZVOUS',
  'DEORBIT',
  'ENTRY',
  'LANDING',
];
