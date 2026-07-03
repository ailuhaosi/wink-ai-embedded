import { VirtualClock, VirtualClockResetError } from '../VirtualClock';

describe('VirtualClock.sleep / sleepUs', () => {
  test('sleep(ms) resolves after advance() crosses the wake time', async () => {
    const clock = new VirtualClock();
    let resolved = false;
    const p = clock.sleep(100).then(() => { resolved = true; });

    clock.advance(50_000n);
    // Yield to let any spuriously-resolved microtasks fire
    await Promise.resolve();
    expect(resolved).toBe(false);

    clock.advance(50_000n);
    await p;
    expect(resolved).toBe(true);
  });

  test('resolves multiple pending sleeps in wakeAt-ascending order', async () => {
    const clock = new VirtualClock();
    const log: string[] = [];
    const p1 = clock.sleep(50).then(() => log.push('a'));
    const p2 = clock.sleep(100).then(() => log.push('b'));
    const p3 = clock.sleep(75).then(() => log.push('c'));

    clock.advance(200_000n);
    await Promise.all([p1, p2, p3]);
    // 50ms (a) and 75ms (c) both < 100ms (b); wake order is by wakeAt ascending.
    expect(log).toEqual(['a', 'c', 'b']);
  });

  // ─── Global Constraint: sleep(0) / sleepUs(0n) still wait ───
  test('sleep(0) does NOT resolve on advance(0n) (zero-tick pump is safe)', async () => {
    const clock = new VirtualClock();
    let resolved = false;
    void clock.sleep(0).then(() => { resolved = true; });
    clock.advance(0n);           // zero-tick — must NOT flush the sleep
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
  });

  test('sleep(0) resolves on the next non-zero advance', async () => {
    const clock = new VirtualClock();
    const p = clock.sleep(0);
    clock.advance(1n);
    await expect(p).resolves.toBeUndefined();
  });

  test('sleepUs(0n) does NOT resolve on advance(0n); does resolve on advance(1n)', async () => {
    const clock = new VirtualClock();
    let resolved = false;
    const p = clock.sleepUs(0n).then(() => { resolved = true; });
    clock.advance(0n);
    await Promise.resolve();
    expect(resolved).toBe(false);
    clock.advance(1n);
    await p;
    expect(resolved).toBe(true);
  });

  // ─── Global Constraint: busy_wait_us sub-millisecond precision ───
  test('sleepUs(500n) resolves after exactly 500us, not next-ms boundary', async () => {
    const clock = new VirtualClock();
    let resolved = false;
    const p = clock.sleepUs(500n).then(() => { resolved = true; });
    clock.advance(499n);
    await Promise.resolve();
    expect(resolved).toBe(false);
    clock.advance(1n);
    await p;
    expect(resolved).toBe(true);
  });

  test('sleepUs(1n) resolves after exactly 1us advance', async () => {
    const clock = new VirtualClock();
    const p = clock.sleepUs(1n);
    clock.advance(1n);
    await expect(p).resolves.toBeUndefined();
  });

  test('sleepUs rejects negative bigint at enqueue time', () => {
    const clock = new VirtualClock();
    expect(() => clock.sleepUs(-1n)).toThrow(RangeError);
  });

  // ─── Global Constraint: reset() rejects pending sleeps ───
  test('reset() rejects pending sleeps with VirtualClockResetError', async () => {
    const clock = new VirtualClock();
    const p1 = clock.sleep(100);
    const p2 = clock.sleepUs(500n);
    clock.reset();
    await expect(p1).rejects.toBeInstanceOf(VirtualClockResetError);
    await expect(p2).rejects.toBeInstanceOf(VirtualClockResetError);
    // Post-reset advance MUST NOT re-fire the rejected promises.
    clock.advance(1_000_000n);
    // No-op assertion — presence of any second reject/resolve would be an
    // unhandled promise rejection Jest surfaces; reaching here is the pass.
  });

  test('reset() zeroes the clock and clears the pending queue', async () => {
    const clock = new VirtualClock();
    clock.advance(5000n);
    const p = clock.sleep(10);
    // Swallow the reset-driven rejection; we're testing state not error.
    p.catch(() => {});
    clock.reset();
    expect(clock.getUs()).toBe(0n);
    // A fresh sleep after reset behaves normally.
    const p2 = clock.sleep(10);
    clock.advance(10_000n);
    await expect(p2).resolves.toBeUndefined();
  });

  test('existing getUs/getMs unaffected', () => {
    const clock = new VirtualClock();
    clock.advance(1_234_567n);
    expect(clock.getUs()).toBe(1_234_567n);
    expect(clock.getMs()).toBe(1234n);
  });

  // ─── Global Constraint: advance() single-tick-per-sync-block ───
  test('consecutive advance() in one sync block: nested sleep sees post-advance clock', async () => {
    // This test DOCUMENTS the expected (and potentially surprising) semantics:
    // advance() calls resolve() synchronously, but .then() callbacks run in the
    // microtask queue AFTER the current sync block. So if we advance(500n) then
    // advance(500n) back-to-back, a sleep resolved at t=500µs will see
    // this.us = 1000n when its callback fires (NOT 500n).
    //
    // This is WHY the Global Constraint requires callers to yield between
    // advance() calls. This test encodes the ACTUAL behaviour so a future
    // refactor that changes it will break loudly.
    const clock = new VirtualClock();
    let observedUs: bigint | null = null;
    let nestedSleepResolved = false;

    // Enqueue a sleep that wakes at 500µs and immediately does another sleep
    void clock.sleepUs(500n).then(() => {
      observedUs = clock.getUs();
      // Nested sleep: "wait 100µs more from NOW"
      void clock.sleepUs(100n).then(() => { nestedSleepResolved = true; });
    });

    // Two back-to-back advances WITHOUT yielding microtask queue between them.
    clock.advance(500n);
    clock.advance(500n);
    // At this point the .then() callback hasn't run yet (it's in microtask queue).
    expect(observedUs).toBeNull();

    // Now yield — the sleep(500) .then fires, sees clock at 1000µs
    await Promise.resolve();
    expect(observedUs).toBe(1000n);
    // The nested sleep(100) enqueued at clock=1000µs, wakeAt=1100µs.
    // Current clock is 1000µs, so it hasn't resolved yet.
    expect(nestedSleepResolved).toBe(false);

    clock.advance(100n);
    await Promise.resolve();
    expect(nestedSleepResolved).toBe(true);
  });

  test('single advance + yield between calls preserves correct time observation', async () => {
    // Correct usage pattern: one advance per sync block, yield, repeat.
    const clock = new VirtualClock();
    let observedUs: bigint | null = null;

    void clock.sleepUs(500n).then(() => {
      observedUs = clock.getUs();
    });

    clock.advance(500n);
    await Promise.resolve(); // yield — callback sees clock at 500µs
    expect(observedUs).toBe(500n); // CORRECT: ISR at 500µs sees 500µs

    clock.advance(500n);
    await Promise.resolve();
    // Second advance sees clock at 1000µs — no stale observation.
  });
});
