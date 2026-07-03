import { I2CBus } from '../I2CBus';
import { I2CDevice } from '../../types/runtime/i2c';

class EchoDevice implements I2CDevice {
  readonly addr: number;
  constructor(addr: number) { this.addr = addr; }
  onTransfer(writeBytes: Uint8Array, readLen: number) {
    // Echo back the writeBytes truncated/padded to readLen.
    const out = new Uint8Array(readLen);
    for (let i = 0; i < readLen; i++) {
      out[i] = i < writeBytes.length ? writeBytes[i] : 0;
    }
    return { ack: true, readBytes: out };
  }
}

class NackDevice implements I2CDevice {
  readonly addr: number;
  constructor(addr: number) { this.addr = addr; }
  onTransfer() { return { ack: false }; }
}

describe('I2CBus', () => {
  test('unregistered (port, addr) returns false (NACK)', () => {
    const bus = new I2CBus();
    const writeBytes = new Uint8Array([0xAB]);
    const readBuf = new Uint8Array(1);
    expect(bus.transfer(0, 0x3C, writeBytes, readBuf)).toBe(false);
  });

  test('registered device: transfer succeeds and readBuf is filled', () => {
    const bus = new I2CBus();
    bus.register(0, new EchoDevice(0x3C));
    const writeBytes = new Uint8Array([1, 2, 3]);
    const readBuf = new Uint8Array(3);
    expect(bus.transfer(0, 0x3C, writeBytes, readBuf)).toBe(true);
    expect(Array.from(readBuf)).toEqual([1, 2, 3]);
  });

  test('device NACK yields false and does not touch readBuf', () => {
    const bus = new I2CBus();
    bus.register(0, new NackDevice(0x50));
    const readBuf = new Uint8Array(2);
    readBuf[0] = 0xEE; readBuf[1] = 0xFF;
    expect(bus.transfer(0, 0x50, new Uint8Array(0), readBuf)).toBe(false);
    expect(Array.from(readBuf)).toEqual([0xEE, 0xFF]);
  });

  test('unregister removes the device (subsequent transfer NACKs)', () => {
    const bus = new I2CBus();
    bus.register(0, new EchoDevice(0x3C));
    bus.unregister(0, 0x3C);
    expect(bus.transfer(0, 0x3C, new Uint8Array(0), new Uint8Array(1))).toBe(false);
  });

  test('different ports isolate devices with the same addr', () => {
    const bus = new I2CBus();
    bus.register(0, new EchoDevice(0x3C));
    // Same addr on a different port is unregistered
    expect(bus.transfer(1, 0x3C, new Uint8Array(0), new Uint8Array(1))).toBe(false);
    // Port 0 still works
    expect(bus.transfer(0, 0x3C, new Uint8Array([9]), new Uint8Array(1))).toBe(true);
  });

  test('device readBytes length mismatch triggers a NACK (defensive)', () => {
    class WrongLenDevice implements I2CDevice {
      readonly addr = 0x77;
      onTransfer() { return { ack: true, readBytes: new Uint8Array(2) }; }
    }
    const bus = new I2CBus();
    bus.register(0, new WrongLenDevice());
    // Caller wants 4 bytes but device promises 2 — that's a device-model bug;
    // bus refuses to silently truncate, returns false.
    expect(bus.transfer(0, 0x77, new Uint8Array(0), new Uint8Array(4))).toBe(false);
  });
});
