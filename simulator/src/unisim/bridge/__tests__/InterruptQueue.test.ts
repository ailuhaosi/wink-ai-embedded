import { InterruptQueue, INTERRUPT_QUEUE_CAPACITY } from '../InterruptQueue';

describe('InterruptQueue', () => {
  test('push on unregistered pin is a no-op', () => {
    const q = new InterruptQueue();
    expect(q.push(5)).toBe(false);
    expect(q.size()).toBe(0);
    expect(q.pop()).toBeNull();
  });

  test('register + push enqueues (pin, cbIdx, argPtr)', () => {
    const q = new InterruptQueue();
    q.register(7, 42, 0x1000);
    expect(q.push(7)).toBe(true);
    expect(q.size()).toBe(1);
    expect(q.pop()).toEqual({ pin: 7, cbIdx: 42, argPtr: 0x1000 });
    expect(q.pop()).toBeNull();
  });

  test('deregister stops future push from enqueuing', () => {
    const q = new InterruptQueue();
    q.register(7, 42, 0x1000);
    q.deregister(7);
    expect(q.push(7)).toBe(false);
    expect(q.size()).toBe(0);
  });

  test('deregister on unknown pin is a no-op (idempotent)', () => {
    const q = new InterruptQueue();
    expect(() => q.deregister(99)).not.toThrow();
  });

  test('register overwrites prior mapping for the same pin', () => {
    const q = new InterruptQueue();
    q.register(7, 1, 100);
    q.register(7, 2, 200);
    q.push(7);
    expect(q.pop()).toEqual({ pin: 7, cbIdx: 2, argPtr: 200 });
  });

  test('pop is FIFO order across multiple pins', () => {
    const q = new InterruptQueue();
    q.register(1, 10, 0xA);
    q.register(2, 20, 0xB);
    q.push(1);
    q.push(2);
    q.push(1);
    expect(q.pop()).toEqual({ pin: 1, cbIdx: 10, argPtr: 0xA });
    expect(q.pop()).toEqual({ pin: 2, cbIdx: 20, argPtr: 0xB });
    expect(q.pop()).toEqual({ pin: 1, cbIdx: 10, argPtr: 0xA });
  });

  test('default overflow policy drops newest (preserves oldest entries)', () => {
    const q = new InterruptQueue();
    q.register(1, 10, 0xA);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < INTERRUPT_QUEUE_CAPACITY; i++) q.push(1);
    // One more: should NOT grow the queue (drop-newest rejects the incoming)
    expect(q.push(1)).toBe(false);
    expect(q.size()).toBe(INTERRUPT_QUEUE_CAPACITY);
    expect(q.overflowCount).toBe(1);
    // Head is the very first entry enqueued (oldest preserved)
    expect(q.pop()).toEqual({ pin: 1, cbIdx: 10, argPtr: 0xA });
    warn.mockRestore();
  });

  test('overflow policy drop-oldest evicts head and enqueues incoming', () => {
    const q = new InterruptQueue({ overflowPolicy: 'drop-oldest', warnIntervalMs: 0 });
    q.register(1, 10, 0xA);
    for (let i = 0; i < INTERRUPT_QUEUE_CAPACITY; i++) q.push(1);
    expect(q.push(1)).toBe(true); // incoming enqueued
    expect(q.size()).toBe(INTERRUPT_QUEUE_CAPACITY);
    expect(q.overflowCount).toBe(1);
  });

  test('overflowCount and resetOverflowCount track cumulative drops', () => {
    const q = new InterruptQueue({ warnIntervalMs: 0 });
    q.register(1, 10, 0xA);
    for (let i = 0; i < INTERRUPT_QUEUE_CAPACITY + 5; i++) q.push(1);
    expect(q.overflowCount).toBe(5);
    q.resetOverflowCount();
    expect(q.overflowCount).toBe(0);
  });

  test('rate-limited warning (warnIntervalMs) avoids log spam', () => {
    const q = new InterruptQueue({ warnIntervalMs: 60_000 });
    q.register(1, 10, 0xA);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < INTERRUPT_QUEUE_CAPACITY + 20; i++) q.push(1);
    // Should warn at most once within the 60s window regardless of drops
    expect(warn).toHaveBeenCalledTimes(1);
    expect(q.overflowCount).toBe(20);
    warn.mockRestore();
  });
});
