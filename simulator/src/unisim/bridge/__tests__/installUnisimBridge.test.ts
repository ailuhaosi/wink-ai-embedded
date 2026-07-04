import { installUnisimBridge, EmscriptenModuleLike } from '../installUnisimBridge';
import { createUnisimImports } from '../createUnisimImports';
import { VirtualClock } from '../../core/VirtualClock';
import { PinArbiter } from '../../core/pin-arbiter';
import { I2CBus } from '../I2CBus';
import { InterruptQueue } from '../InterruptQueue';

function makeModule(): EmscriptenModuleLike {
  return {} as EmscriptenModuleLike;
}

describe('installUnisimBridge', () => {
  test('assigns every WasmImports field onto the Module object', () => {
    const buf = new ArrayBuffer(1024);
    const imports = createUnisimImports({
      clock: new VirtualClock(),
      arbiter: new PinArbiter(),
      i2cBus: new I2CBus(),
      irqQueue: new InterruptQueue(),
      memoryView: () => new Uint8Array(buf),
    });
    const module = makeModule();
    installUnisimBridge(module, imports);
    const keys = [
      'js_pal_gpio_write', 'js_pal_gpio_read', 'js_pal_pwm_set_duty',
      'js_pal_i2c_transfer',
      'js_pal_register_interrupt', 'js_pal_deregister_interrupt', 'js_pal_poll_interrupt',
      'js_pal_os_sleep_ms', 'js_pal_os_busy_wait_us',
      'js_sim_trigger_ultrasonic', 'js_sim_measure_echo_pulse_us',
    ] as const;
    for (const key of keys) {
      expect(typeof (module as any)[key]).toBe('function');
      expect((module as any)[key]).toBe((imports as any)[key]);
    }
  });

  test('overwrites any existing Module.js_* placeholders', () => {
    const buf = new ArrayBuffer(1024);
    const imports = createUnisimImports({
      clock: new VirtualClock(),
      arbiter: new PinArbiter(),
      i2cBus: new I2CBus(),
      irqQueue: new InterruptQueue(),
      memoryView: () => new Uint8Array(buf),
    });
    const module = makeModule() as any;
    module.js_pal_gpio_write = () => { throw new Error('should have been overwritten'); };
    installUnisimBridge(module, imports);
    expect(() => module.js_pal_gpio_write(0, false)).not.toThrow();
  });
});
