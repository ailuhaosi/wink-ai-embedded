/**
 * I2CBus — runtime dispatch for js_pal_i2c_transfer.
 *
 * Wires the (port, addr) transfer request coming from wasm into an I2CDevice
 * mock registered by the host. Compared to wink_sim_js.js's default stub
 * (which returns true unconditionally), an unregistered address correctly
 * NACKs — matching real-hardware behaviour.
 *
 * Marshalling wasm heap <-> device is done by createUnisimImports (Task 11);
 * this class receives already-decoded Uint8Array views.
 */
import { I2CBusApi, I2CDevice } from '../types/runtime/i2c';

export class I2CBus implements I2CBusApi {
  private devices = new Map<string, I2CDevice>();

  private key(port: number, addr: number): string {
    return `${port}:${addr}`;
  }

  register(port: number, device: I2CDevice): void {
    this.devices.set(this.key(port, device.addr), device);
  }

  unregister(port: number, addr: number): void {
    this.devices.delete(this.key(port, addr));
  }

  transfer(
    port: number,
    addr: number,
    writeBytes: Uint8Array,
    readBuf: Uint8Array,
  ): boolean {
    const device = this.devices.get(this.key(port, addr));
    if (!device) return false;

    const result = device.onTransfer(writeBytes, readBuf.length);
    if (!result.ack) return false;

    if (readBuf.length > 0) {
      if (!result.readBytes || result.readBytes.length !== readBuf.length) {
        // Device model buggy — refuse to silently truncate/pad.
        // eslint-disable-next-line no-console
        console.warn(
          `[I2CBus] device 0x${addr.toString(16)} on port ${port} returned ` +
          `readBytes.length=${result.readBytes?.length ?? 0} but caller wants ${readBuf.length}; treating as NACK.`,
        );
        return false;
      }
      readBuf.set(result.readBytes);
    }
    return true;
  }
}
