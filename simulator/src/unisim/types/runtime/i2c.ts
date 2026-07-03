/**
 * I²C runtime types — device contract + bus API surface.
 *
 * Consumed by:
 *   - bridge/I2CBus.ts (Task 9) — concrete bus implementation (implements I2CBusApi)
 *   - bridge/createUnisimImports.ts (Task 11) — receives `bus: I2CBusApi` via
 *     UnisimBridgeDeps and routes js_pal_i2c_transfer into it after doing the
 *     wasm-heap ptr+len marshalling.
 *
 * Semantics: transfer() first writes `writeBytes` to the device (or empty for
 * a read-only transfer), then requests `readLen` bytes back. Device returns
 * either the bytes it wants copied into the read buffer or a NACK indicator.
 * Real-hardware differences (repeated start, clock stretching) are not
 * modelled at Phase B — Phase C ships fault-injection knobs.
 */

export interface I2CTransferResult {
  /** true = ACK, transfer succeeded; false = NACK, wasm side sees the transfer as failed. */
  ack: boolean;
  /**
   * Bytes to place into the read buffer. Length must equal the `readLen`
   * originally passed to `transfer()`. Ignored on NACK. Ignored when
   * readLen is 0 (write-only transfer).
   */
  readBytes?: Uint8Array;
}

export interface I2CDevice {
  /** The 7-bit device address on the bus. Matches `dev_addr` in wasm_bridge.h. */
  readonly addr: number;

  /**
   * Called by I2CBus.transfer(). `writeBytes` may be empty (Uint8Array(0))
   * for read-only transfers; `readLen` may be 0 for write-only.
   * Implementations MUST NOT mutate writeBytes.
   */
  onTransfer(writeBytes: Uint8Array, readLen: number): I2CTransferResult;
}

export interface I2CBusApi {
  /** Register a device on `(port, addr)`. Replaces any existing registration. */
  register(port: number, device: I2CDevice): void;

  /** Remove the device at `(port, addr)`. Idempotent. */
  unregister(port: number, addr: number): void;

  /**
   * Dispatch a transfer. Returns false if no device is registered at
   * `(port, addr)` (mimics a real bus NACK — an improvement over the
   * wink_sim_js.js default stub which returned true unconditionally).
   * If a device is registered, its onTransfer() decides ack vs. NACK
   * and produces read bytes.
   *
   * writeBytes and readBuf are plain Uint8Array VIEWS into the wasm heap
   * that createUnisimImports() built via memoryView(). transfer() is
   * responsible for copying I2CTransferResult.readBytes into readBuf.
   */
  transfer(
    port: number,
    addr: number,
    writeBytes: Uint8Array,
    readBuf: Uint8Array,
  ): boolean;
}
