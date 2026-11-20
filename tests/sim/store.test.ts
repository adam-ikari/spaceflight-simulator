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
    expect(store.get()).not.toHaveProperty('aborted');
    expect(store.get()).not.toHaveProperty('decisions');
  });
});
