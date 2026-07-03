import { InterruptQueue, INTERRUPT_QUEUE_CAPACITY } from '../InterruptQueue';

describe('InterruptQueue', () => {
  test('push on unregistered pin is a no-op', () => {
    const q = new InterruptQueue();
    expect(q.push(5)).toBe(false);
    expect(q.size()).toBe(0);
    expect(q.pop()).toBeNull();
  });

  test('register + push enqueues (cbIdx, argPtr)', () => {
    const q = new InterruptQueue();
    q.register(7, 42, 0x1000);
    expect(q.push(7)).toBe(true);
    expect(q.size()).toBe(1);
    expect(q.pop()).toEqual({ cbIdx: 42, argPtr: 0x1000 });
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
    expect(q.pop()).toEqual({ cbIdx: 2, argPtr: 200 });
  });

  test('pop is FIFO order across multiple pins', () => {
    const q = new InterruptQueue();
    q.register(1, 10, 0xA);
    q.register(2, 20, 0xB);
    q.push(1);
    q.push(2);
    q.push(1);
    expect(q.pop()).toEqual({ cbIdx: 10, argPtr: 0xA });
    expect(q.pop()).toEqual({ cbIdx: 20, argPtr: 0xB });
    expect(q.pop()).toEqual({ cbIdx: 10, argPtr: 0xA });
  });

  test('overflow drops oldest and warns once per burst', () => {
    const q = new InterruptQueue();
    q.register(1, 10, 0xA);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < INTERRUPT_QUEUE_CAPACITY + 3; i++) q.push(1);
    expect(q.size()).toBe(INTERRUPT_QUEUE_CAPACITY);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
