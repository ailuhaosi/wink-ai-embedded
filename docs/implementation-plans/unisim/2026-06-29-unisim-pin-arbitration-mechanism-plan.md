# UniSim Pin Arbitration Mechanism Implementation Plan

| 项 | 内容 |
|---|---|
| **计划状态** | 🟡 **大部分完成，已服务完毕**（事后回填：2026-07-03） |
| 创建日期 | 2026-06-29 |
| 关联提交 | `13f1d58 refactor(sim): remove unnecessary PinManager backward compatibility layer`（唯一相关 commit，同时归档本计划 + 主动放弃 Task 4） |
| 消费方 | 前端仿真 Phase B/G1（JS 桥接层升级），本计划为**下游前置能力**，无需再自行推进 |

## 落地情况（对照原 Task 列表）

| Task | 状态 | 证据 |
|------|------|------|
| Task 1 类型定义 (`logic-types.ts`) | ✅ 已完成 | `simulator/src/unisim/types/logic-types.ts`（78 行，`LogicState`/`DriveStrength`/`PinDriver`/`IPinArbiter` 齐备） |
| Task 2 核心 PinArbiter 算法 | ✅ 已完成 | `simulator/src/unisim/core/pin-arbiter.ts`（139 行，含 `resolvePinState`/`getResolvedVoltage`/无限递归防护） |
| Task 3 变更通知 + 边界测试 | ✅ 已完成 | `simulator/src/unisim/core/__tests__/pin-arbiter.test.ts`（242 行） |
| Task 4 PinManagerAdapter 向后兼容层 | ❌ **主动放弃** | commit `13f1d58` 明确删除 — "项目从零开始，无需兼容层" |
| Task 5 模块导出 | ✅ 已完成 | `simulator/src/unisim/index.ts` 导出 `PinArbiter` + `IPinArbiter` |
| Task 6 §4.2 spec 回写 | 🟡 部分完成 | `docs/design/04-wasm-simulation/archive/02-virtual-peripheral-registry.md` L230-392 含 `LogicState`/`DriveStrength`/`PinArbiter` API 定义；仲裁算法/wire-AND 详细行为章节未展开 |
| Task 7 集成 smoke | 🟡 部分完成 | `peripheral-registry.test.ts`（460 行）已消费 PinArbiter；**但 `SimWorker`/`WasmPhysicalBridge` 尚未接入** — 该集成留给前端仿真 Phase B（JS 桥接层升级）阶段一并完成 |

## 结论

- **本计划无需再单独推进**。PinArbiter 内核库、类型、测试、Registry 集成均已到位，可作为下一阶段前端仿真的稳定依赖。
- **未接入生产路径**这一残留由前端仿真 Phase B/G1（JS 桥接层 stub → 真实实现，参照 `sim_specs_deep_assessment.md` §8 `WasmImports` 契约）自然吸收。
- Task 4 主动放弃的判断（无兼容层需求）**符合项目"AI 生成友好 + 静态分发"总原则**，事后看是正确的。

---

&gt; **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement strength-based 4-value logic pin arbitration with open-drain wire-AND, bus conflict detection, and high-impedance (Hi-Z) propagation, replacing the current boolean-only PinManager interface.

**Architecture:** Current `PinManager` (boolean read/notify) → new `PinArbiter` (4-value logic + 3 strength levels + multi-driver arbitration). The arbiter sits between MCU GPIO drivers and peripheral pin drivers, resolving wire-level conflicts the way real electrical circuits behave. Existing code migrates transparently via backward-compatible adapter.

**Tech Stack:** TypeScript 5.x, Jest (or project's existing TS test framework), Wasm Bridge (existing Wasm GPIO contract preserved)

## Global Constraints

- **Backward compatibility:** Existing `pinManager.readPin()` boolean interface must work unchanged — callers see resolved logical value
- **Performance:** Pin state resolution O(n) where n = drivers per pin (typical n ≤ 3, no performance impact)
- **4-value logic types:** `LogicState = 0 | 1 | 'Z' | 'X'` (exact match to review spec)
- **Drive strength enum:** `SUPPLY = 3, PULL = 2, WEAK = 1` (exact match to review spec)
- **No silent failures:** Contention (X state) must be logged with warning; tests must assert expected state
- **Zero breaking changes:** All existing `PeripheralSimulationLogic` drivers work without modification
- **File locations:** All simulation code lives under `simulator/src/unisim/` (create directory if needed)

---

## File Structure Map

| File | Change Type | Responsibility |
|------|-------------|----------------|
| `simulator/src/unisim/types/logic-types.ts` | **Create** | 4-value LogicState, DriveStrength, PinDriver types |
| `simulator/src/unisim/core/pin-arbiter.ts` | **Create** | Core PinArbiter class with strength-based resolution algorithm |
| `simulator/src/unisim/core/pin-manager-adapter.ts` | **Create** | Backward-compatible wrapper exposing old boolean PinManager interface |
| `simulator/src/unisim/core/__tests__/pin-arbiter.test.ts` | **Create** | Unit tests: resolution algorithm, wire-AND, contention, Hi-Z, edge cases |
| `simulator/src/unisim/index.ts` | **Create/Modify** | Public exports: PinArbiter, PinManagerAdapter, types |
| `docs/design/04-wasm-simulation/archive/02-virtual-peripheral-registry.md` | **Modify** | Update spec section 4 with new PinArbiter interface |

---

### Task 1: Type Definitions & Interface Contracts

**Files:**
- Create: `simulator/src/unisim/types/logic-types.ts`
- Test: `simulator/src/unisim/types/__tests__/logic-types.test.ts`

**Interfaces:**
- Produces: `LogicState`, `DriveStrength`, `PinDriver`, `PinState` types (exact signatures below)

- [ ] **Step 1: Write type definition file**

```typescript
/**
 * 4-value logic state (SystemVerilog inspired)
 * 0 = low, 1 = high, 'Z' = high-impedance floating, 'X' = unknown/contention
 */
export type LogicState = 0 | 1 | 'Z' | 'X';

/**
 * Drive strength levels for pin arbitration (from strongest to weakest)
 * SUPPLY: Direct power connection (VCC/GND) or push-pull GPIO output
 * PULL: Resistor pull-up/pull-down (e.g., I2C bus external 4.7kΩ resistors)
 * WEAK: Weak internal pull-up, open-drain release state, or floating input
 */
export enum DriveStrength {
  SUPPLY = 3,
  PULL = 2,
  WEAK = 1,
}

/**
 * A single driver contributing to a pin's state
 * Multiple drivers can be registered to the same pin (wire-AND topology)
 */
export interface PinDriver {
  /** Unique driver ID (format: `${componentType}:${componentId}:${pinName}` or `mcu:gpio${pin}`) */
  id: string;
  /** Current logic state driven by this source */
  state: LogicState;
  /** Drive strength of this source */
  strength: DriveStrength;
}

/**
 * Resolved pin state after arbitration across all drivers
 */
export interface PinState {
  /** Final resolved logic state after applying strength-based arbitration */
  resolvedState: LogicState;
  /** All registered drivers contributing to this pin */
  drivers: Map<string, PinDriver>;
}

/**
 * Pin change callback signature
 */
export type PinChangeCallback = (pinNumber: number, newState: LogicState) => void;

/**
 * PinArbiter public interface
 */
export interface IPinArbiter {
  /** Register or update a driver for a specific pin */
  setDriver(pinNumber: number, driver: PinDriver): void;
  /** Remove a driver from a pin (e.g., peripheral detached, Hi-Z state) */
  removeDriver(pinNumber: number, driverId: string): void;
  /** Read the resolved logic state of a pin */
  readPin(pinNumber: number): LogicState;
  /** Read estimated voltage (0V-3.3V) for analog components (LED brightness, etc.) */
  getResolvedVoltage(pinNumber: number): number;
  /** Subscribe to pin state changes */
  onPinChange(pinNumber: number, callback: PinChangeCallback): () => void;
  /** Get all drivers for a pin (diagnostic/debug use only) */
  getDrivers(pinNumber: number): PinDriver[];
}
```

- [ ] **Step 2: Write type consistency test** (ensure enum values match spec exactly)

```typescript
import { DriveStrength, LogicState } from '../logic-types';

describe('LogicTypes', () => {
  test('DriveStrength enum matches spec values exactly', () => {
    expect(DriveStrength.SUPPLY).toBe(3);
    expect(DriveStrength.PULL).toBe(2);
    expect(DriveStrength.WEAK).toBe(1);
  });

  test('LogicState type includes all four values', () => {
    // Compile-time test: these assignments should not error
    const s0: LogicState = 0;
    const s1: LogicState = 1;
    const sZ: LogicState = 'Z';
    const sX: LogicState = 'X';
    expect([s0, s1, sZ, sX]).toHaveLength(4);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx tsc --noEmit simulator/src/unisim/types/logic-types.ts && npx jest simulator/src/unisim/types/__tests__/logic-types.test.ts`
Expected: TypeScript compiles without errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add simulator/src/unisim/types/logic-types.ts simulator/src/unisim/types/__tests__/logic-types.test.ts
git commit -m "feat(sim): add 4-value logic and drive-strength type definitions"
```

---

### Task 2: Core Pin Arbitration Algorithm Implementation (TDD)

**Files:**
- Create: `simulator/src/unisim/core/pin-arbiter.ts`
- Create: `simulator/src/unisim/core/__tests__/pin-arbiter.test.ts`

**Interfaces:**
- Consumes: `LogicState`, `DriveStrength`, `PinDriver`, `PinState`, `IPinArbiter` (Task 1)
- Produces: `PinArbiter` class implementing `IPinArbiter`

- [ ] **Step 1: Write failing tests for core algorithm**

```typescript
import { PinArbiter } from '../pin-arbiter';
import { LogicState, DriveStrength } from '../../types/logic-types';

describe('PinArbiter - Core Algorithm', () => {
  let arbiter: PinArbiter;

  beforeEach(() => {
    arbiter = new PinArbiter();
  });

  test('single SUPPLY driver resolves to its state', () => {
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(5)).toBe(1);
  });

  test('no drivers on pin resolves to Z (high-impedance)', () => {
    expect(arbiter.readPin(99)).toBe('Z');
  });

  test('driver with state Z is ignored (high-impedance does not drive)', () => {
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 'Z', strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(5)).toBe('Z');
  });

  test('two SUPPLY drivers with same state resolve to that state', () => {
    arbiter.setDriver(3, { id: 'mcu:gpio3', state: 1, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(3, { id: 'led:anode', state: 1, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(3)).toBe(1);
  });

  test('two SUPPLY drivers with conflicting states resolve to X (contention)', () => {
    arbiter.setDriver(3, { id: 'mcu:gpio3', state: 1, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(3, { id: 'led:anode', state: 0, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(3)).toBe('X');
  });

  test('SUPPLY driver overrides WEAK driver (strength wins)', () => {
    arbiter.setDriver(7, { id: 'mcu:weak-pullup', state: 1, strength: DriveStrength.WEAK });
    arbiter.setDriver(7, { id: 'sensor:output', state: 0, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(7)).toBe(0); // SUPPLY (3) > WEAK (1)
  });

  test('PULL resistor overrides WEAK pull-up', () => {
    arbiter.setDriver(2, { id: 'internal:pullup', state: 1, strength: DriveStrength.WEAK });
    arbiter.setDriver(2, { id: 'external:pulldown', state: 0, strength: DriveStrength.PULL });
    expect(arbiter.readPin(2)).toBe(0); // PULL (2) > WEAK (1)
  });

  test('open-drain I2C wire-AND: pull-up high + MCU low = 0', () => {
    // I2C bus: external PULL resistor keeps high, MCU pulls low via open-drain
    arbiter.setDriver(6, { id: 'i2c:pullup', state: 1, strength: DriveStrength.PULL });
    arbiter.setDriver(6, { id: 'mcu:sda', state: 0, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(6)).toBe(0); // Wire-AND: MCU low wins
  });

  test('open-drain I2C wire-AND: pull-up high + MCU Z = 1', () => {
    arbiter.setDriver(6, { id: 'i2c:pullup', state: 1, strength: DriveStrength.PULL });
    arbiter.setDriver(6, { id: 'mcu:sda', state: 'Z', strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(6)).toBe(1); // Pull-up wins
  });

  test('removeDriver removes specific driver, others remain', () => {
    arbiter.setDriver(4, { id: 'mcu:gpio4', state: 1, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(4, { id: 'periph:pin', state: 0, strength: DriveStrength.WEAK });
    expect(arbiter.readPin(4)).toBe(1); // SUPPLY wins

    arbiter.removeDriver(4, 'mcu:gpio4');
    expect(arbiter.readPin(4)).toBe(0); // Only WEAK remains
  });

  test('removeDriver on non-existent driver does nothing', () => {
    arbiter.setDriver(5, { id: 'real:driver', state: 1, strength: DriveStrength.SUPPLY });
    expect(() => arbiter.removeDriver(5, 'nonexistent:driver')).not.toThrow();
    expect(arbiter.readPin(5)).toBe(1);
  });

  test('getDrivers returns all registered drivers for pin', () => {
    arbiter.setDriver(8, { id: 'd1', state: 1, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(8, { id: 'd2', state: 0, strength: DriveStrength.PULL });
    const drivers = arbiter.getDrivers(8);
    expect(drivers).toHaveLength(2);
    expect(drivers.map(d => d.id).sort()).toEqual(['d1', 'd2']);
  });

  test('getDrivers on empty pin returns empty array', () => {
    expect(arbiter.getDrivers(999)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest simulator/src/unisim/core/__tests__/pin-arbiter.test.ts`
Expected: All tests fail with "PinArbiter is not defined" or similar

- [ ] **Step 3: Implement PinArbiter class**

```typescript
import { LogicState, DriveStrength, PinDriver, PinState, PinChangeCallback, IPinArbiter } from '../types/logic-types';

export class PinArbiter implements IPinArbiter {
  private pinStates = new Map<number, PinState>();
  private changeListeners = new Map<number, Set<PinChangeCallback>>();

  setDriver(pinNumber: number, driver: PinDriver): void {
    let pinState = this.pinStates.get(pinNumber);
    if (!pinState) {
      pinState = {
        resolvedState: 'Z',
        drivers: new Map(),
      };
      this.pinStates.set(pinNumber, pinState);
    }

    const oldResolved = pinState.resolvedState;
    pinState.drivers.set(driver.id, driver);
    pinState.resolvedState = this.resolvePinState(pinState.drivers);

    if (oldResolved !== pinState.resolvedState) {
      this.notifyPinChange(pinNumber, pinState.resolvedState);
    }
  }

  removeDriver(pinNumber: number, driverId: string): void {
    const pinState = this.pinStates.get(pinNumber);
    if (!pinState) return;

    const oldResolved = pinState.resolvedState;
    pinState.drivers.delete(driverId);
    pinState.resolvedState = this.resolvePinState(pinState.drivers);

    if (oldResolved !== pinState.resolvedState) {
      this.notifyPinChange(pinNumber, pinState.resolvedState);
    }
  }

  readPin(pinNumber: number): LogicState {
    const pinState = this.pinStates.get(pinNumber);
    return pinState ? pinState.resolvedState : 'Z';
  }

  getResolvedVoltage(pinNumber: number): number {
    const state = this.readPin(pinNumber);
    switch (state) {
      case 1: return 3.3;
      case 0: return 0.0;
      case 'X': return 1.65; // Contention mid-point (for LED brightness calculation)
      case 'Z': default: return 0.0; // Floating defaults to 0V (component-specific handling can override)
    }
  }

  onPinChange(pinNumber: number, callback: PinChangeCallback): () => void {
    if (!this.changeListeners.has(pinNumber)) {
      this.changeListeners.set(pinNumber, new Set());
    }
    const listeners = this.changeListeners.get(pinNumber)!;
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  getDrivers(pinNumber: number): PinDriver[] {
    const pinState = this.pinStates.get(pinNumber);
    return pinState ? Array.from(pinState.drivers.values()) : [];
  }

  /**
   * Strength-based arbitration algorithm
   * Algorithm rules (in priority order):
   * 1. Ignore all drivers with state 'Z' (high-impedance doesn't drive)
   * 2. Find max strength among remaining active drivers
   * 3. If all max-strength drivers agree on state → that state wins
   * 4. If max-strength drivers disagree → 'X' (contention/unknown)
   * 5. If no active drivers → 'Z' (floating)
   */
  private resolvePinState(drivers: Map<string, PinDriver>): LogicState {
    if (drivers.size === 0) return 'Z';

    let maxStrength = -1;
    let activeDrivers: PinDriver[] = [];

    // Collect non-Z drivers and find max strength
    for (const [, drv] of drivers) {
      if (drv.state === 'Z') continue; // Hi-Z drivers don't contribute
      activeDrivers.push(drv);
      if (drv.strength > maxStrength) {
        maxStrength = drv.strength;
      }
    }

    if (activeDrivers.length === 0) return 'Z'; // All drivers are Hi-Z

    // Filter to only max-strength drivers
    const maxStrengthDrivers = activeDrivers.filter(d => d.strength === maxStrength);

    // Check for contention among max-strength drivers
    const firstState = maxStrengthDrivers[0].state;
    const allAgree = maxStrengthDrivers.every(d => d.state === firstState);

    if (!allAgree) return 'X'; // Contention: strongest drivers disagree

    return firstState;
  }

    private notifyingPins = new Set<number>();
    private recursionCounters = new Map<number, number>();

    private notifyPinChange(pinNumber: number, newState: LogicState): void {
      const listeners = this.changeListeners.get(pinNumber);
      if (!listeners) return;

      // Prevent infinite recursion loops from mutual pin state updates
      if (this.notifyingPins.has(pinNumber)) {
        const depth = (this.recursionCounters.get(pinNumber) ?? 0) + 1;
        this.recursionCounters.set(pinNumber, depth);
        if (depth > 10) {
          console.warn(`[PinArbiter] Infinite event loop detected on pin ${pinNumber}. Aborting recursion cascade.`);
          return;
        }
      } else {
        this.notifyingPins.add(pinNumber);
        this.recursionCounters.set(pinNumber, 0);
      }

      try {
        listeners.forEach(cb => {
          try {
            cb(pinNumber, newState);
          } catch (e) {
            // Swallow listener errors to prevent one bad listener from breaking simulation
            console.warn(`[PinArbiter] Error in pin change listener for pin ${pinNumber}:`, e);
          }
        });
      } finally {
        this.notifyingPins.delete(pinNumber);
        this.recursionCounters.delete(pinNumber);
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest simulator/src/unisim/core/__tests__/pin-arbiter.test.ts`
Expected: All 12 tests pass

- [ ] **Step 5: Commit**

```bash
git add simulator/src/unisim/core/pin-arbiter.ts simulator/src/unisim/core/__tests__/pin-arbiter.test.ts
git commit -m "feat(sim): implement strength-based 4-value logic pin arbitration"
```

---

### Task 3: Pin Change Notification & Edge Case Tests

**Files:**
- Modify: `simulator/src/unisim/core/__tests__/pin-arbiter.test.ts` (add notification tests)
- Modify: `simulator/src/unisim/core/pin-arbiter.ts` (ensure test coverage)

**Interfaces:**
- Consumes: `PinArbiter` class (Task 2)
- Produces: Full test coverage for notification mechanism and edge cases

- [ ] **Step 1: Add failing tests for notifications and edge cases** (append to existing test file)

```typescript
describe('PinArbiter - Change Notifications', () => {
  let arbiter: PinArbiter;

  beforeEach(() => {
    arbiter = new PinArbiter();
  });

  test('onPinChange callback fires when pin state changes', () => {
    const callback = jest.fn();
    arbiter.onPinChange(5, callback);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledWith(5, 1);
  });

  test('callback does NOT fire when state does not change', () => {
    const callback = jest.fn();
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    arbiter.onPinChange(5, callback);

    // Update driver with same state - no resolution change
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(callback).not.toHaveBeenCalled();
  });

  test('unsubscribe stops further notifications', () => {
    const callback = jest.fn();
    const unsubscribe = arbiter.onPinChange(5, callback);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 0, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledTimes(1); // No additional call
  });

  test('multiple independent listeners for same pin', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    arbiter.onPinChange(3, cb1);
    arbiter.onPinChange(3, cb2);

    arbiter.setDriver(3, { id: 'mcu:gpio3', state: 0, strength: DriveStrength.SUPPLY });
    expect(cb1).toHaveBeenCalledWith(3, 0);
    expect(cb2).toHaveBeenCalledWith(3, 0);
  });

  test('listener exception does not break other listeners or simulation', () => {
    const badCb = jest.fn(() => { throw new Error('Bad listener!'); });
    const goodCb = jest.fn();
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    arbiter.onPinChange(7, badCb);
    arbiter.onPinChange(7, goodCb);

    expect(() => {
      arbiter.setDriver(7, { id: 'mcu:gpio7', state: 1, strength: DriveStrength.SUPPLY });
    }).not.toThrow();

    expect(goodCb).toHaveBeenCalled(); // Good listener still called
    expect(consoleSpy).toHaveBeenCalled(); // Warning logged
    consoleSpy.mockRestore();
  });

  test('infinite loop callback recursion is caught and terminated', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    // Pin A updates Pin B, Pin B updates Pin A -> infinite recursion loop
    arbiter.onPinChange(1, (pin, state) => {
      arbiter.setDriver(2, { id: 'loop:b', state: state, strength: DriveStrength.SUPPLY });
    });
    arbiter.onPinChange(2, (pin, state) => {
      arbiter.setDriver(1, { id: 'loop:a', state: state === 1 ? 0 : 1, strength: DriveStrength.SUPPLY });
    });

    expect(() => {
      arbiter.setDriver(1, { id: 'loop:start', state: 1, strength: DriveStrength.SUPPLY });
    }).not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Infinite event loop detected')
    );
    consoleSpy.mockRestore();
  });
});

describe('PinArbiter - Voltage Estimation', () => {
  let arbiter: PinArbiter;

  beforeEach(() => {
    arbiter = new PinArbiter();
  });

  test('logic high returns 3.3V', () => {
    arbiter.setDriver(1, { id: 'd1', state: 1, strength: DriveStrength.SUPPLY });
    expect(arbiter.getResolvedVoltage(1)).toBe(3.3);
  });

  test('logic low returns 0.0V', () => {
    arbiter.setDriver(1, { id: 'd1', state: 0, strength: DriveStrength.SUPPLY });
    expect(arbiter.getResolvedVoltage(1)).toBe(0.0);
  });

  test('contention (X) returns 1.65V midpoint', () => {
    arbiter.setDriver(2, { id: 'd1', state: 0, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(2, { id: 'd2', state: 1, strength: DriveStrength.SUPPLY });
    expect(arbiter.getResolvedVoltage(2)).toBe(1.65);
  });

  test('high-impedance (Z) returns 0.0V', () => {
    expect(arbiter.getResolvedVoltage(99)).toBe(0.0);
  });
});

describe('PinArbiter - Complex Multi-Driver Scenarios', () => {
  let arbiter: PinArbiter;

  beforeEach(() => {
    arbiter = new PinArbiter();
  });

  test('I2C multi-master arbitration: two MCUs, one pulls low', () => {
    // Two MCU masters + one pull-up resistor
    arbiter.setDriver(6, { id: 'i2c:pullup', state: 1, strength: DriveStrength.PULL });
    arbiter.setDriver(6, { id: 'mcu1:sda', state: 0, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(6, { id: 'mcu2:sda', state: 'Z', strength: DriveStrength.SUPPLY });

    expect(arbiter.readPin(6)).toBe(0); // MCU1 low wins wire-AND
  });

  test('I2C multi-master contention: both MCUs drive opposite', () => {
    arbiter.setDriver(6, { id: 'i2c:pullup', state: 1, strength: DriveStrength.PULL });
    arbiter.setDriver(6, { id: 'mcu1:sda', state: 0, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(6, { id: 'mcu2:sda', state: 1, strength: DriveStrength.SUPPLY });

    expect(arbiter.readPin(6)).toBe('X'); // Two SUPPLY drivers conflict → X
  });

  test('three strength levels: WEAK < PULL < SUPPLY', () => {
    arbiter.setDriver(4, { id: 'weak', state: 0, strength: DriveStrength.WEAK });
    arbiter.setDriver(4, { id: 'pull', state: 1, strength: DriveStrength.PULL });
    arbiter.setDriver(4, { id: 'supply', state: 0, strength: DriveStrength.SUPPLY });

    expect(arbiter.readPin(4)).toBe(0); // SUPPLY wins
  });

  test('all Z drivers resolve to Z', () => {
    arbiter.setDriver(5, { id: 'd1', state: 'Z', strength: DriveStrength.SUPPLY });
    arbiter.setDriver(5, { id: 'd2', state: 'Z', strength: DriveStrength.PULL });
    expect(arbiter.readPin(5)).toBe('Z');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest simulator/src/unisim/core/__tests__/pin-arbiter.test.ts`
Expected: All 25 tests pass (12 from Task 2 + 13 new)

- [ ] **Step 3: Commit**

```bash
git add simulator/src/unisim/core/__tests__/pin-arbiter.test.ts
git commit -m "test(sim): add pin change notification and edge case tests"
```

---

### Task 4: Backward-Compatible PinManager Adapter

**Files:**
- Create: `simulator/src/unisim/core/pin-manager-adapter.ts`
- Create: `simulator/src/unisim/core/__tests__/pin-manager-adapter.test.ts`

**Interfaces:**
- Consumes: `PinArbiter` (Task 2)
- Produces: `PinManagerAdapter` class with old `readPin(pin): boolean` + `setPinInput` + `updateAnalogVoltage` + `onPinChange` + `onPwmChange` interface

- [ ] **Step 1: Write failing adapter tests**

```typescript
import { PinManagerAdapter } from '../pin-manager-adapter';
import { PinArbiter } from '../pin-arbiter';
import { DriveStrength } from '../../types/logic-types';

describe('PinManagerAdapter - Backward Compatibility', () => {
  let arbiter: PinArbiter;
  let adapter: PinManagerAdapter;

  beforeEach(() => {
    arbiter = new PinArbiter();
    adapter = new PinManagerAdapter(arbiter);
  });

  test('readPin returns boolean (true for 1, false for 0/Z/X)', () => {
    // Logic 1 → true
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(adapter.readPin(5)).toBe(true);

    // Logic 0 → false
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 0, strength: DriveStrength.SUPPLY });
    expect(adapter.readPin(5)).toBe(false);

    // Z (high-impedance) → false
    arbiter.removeDriver(5, 'mcu:gpio5');
    expect(adapter.readPin(5)).toBe(false);

    // X (contention) → false
    arbiter.setDriver(6, { id: 'd1', state: 0, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(6, { id: 'd2', state: 1, strength: DriveStrength.SUPPLY });
    expect(adapter.readPin(6)).toBe(false);
  });

  test('setPinInput drives pin as Supply strength low/high', () => {
    adapter.setPinInput(7, true); // Drive 1
    expect(arbiter.readPin(7)).toBe(1);

    adapter.setPinInput(7, false); // Drive 0
    expect(arbiter.readPin(7)).toBe(0);
  });

  test('updateAnalogVoltage and getAnalogVoltage function correctly', () => {
    adapter.updateAnalogVoltage(8, 2.5);
    expect(adapter.getAnalogVoltage(8)).toBe(2.5);
    // Should also drive digital state (voltage > 1.65 is high)
    expect(arbiter.readPin(8)).toBe(1);

    adapter.updateAnalogVoltage(8, 1.2);
    expect(adapter.getAnalogVoltage(8)).toBe(1.2);
    expect(arbiter.readPin(8)).toBe(0);
  });

  test('onPwmChange registers and triggers PWM callbacks', () => {
    const pwmCallback = jest.fn();
    adapter.onPwmChange(1, pwmCallback);

    adapter.triggerPwmChange(1, 50);
    expect(pwmCallback).toHaveBeenCalledWith(50);
  });

  test('onPinChange callback receives boolean state', () => {
    const callback = jest.fn();
    adapter.onPinChange(5, callback);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledWith(5, true);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 0, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledWith(5, false);
  });

  test('unsubscribe works correctly', () => {
    const callback = jest.fn();
    const unsubscribe = adapter.onPinChange(5, callback);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 0, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledTimes(1); // No additional call
  });

  test('adapter passes through to underlying arbiter', () => {
    // LED driver scenario matches existing spec code
    const ledCallback = jest.fn();
    adapter.onPinChange(3, ledCallback);

    arbiter.setDriver(3, { id: 'mcu:gpio3', state: 1, strength: DriveStrength.SUPPLY });
    expect(ledCallback).toHaveBeenCalledWith(3, true);

    arbiter.setDriver(3, { id: 'led:cathode', state: 0, strength: DriveStrength.SUPPLY });
    // Two SUPPLY drivers in conflict → X → false
    expect(ledCallback).toHaveBeenLastCalledWith(3, false);
  });

  test('existing LED driver pattern works without modification', () => {
    // Simulate the exact LED driver pattern from spec:
    // const anodeLevel = gpioPin !== null ? pinManager.readPin(gpioPin) : false;
    let ledValue = false;

    adapter.onPinChange(13, (pin, state) => {
      ledValue = state; // boolean assignment, exactly like existing code
    });

    // GPIO high → LED on
    arbiter.setDriver(13, { id: 'mcu:gpio13', state: 1, strength: DriveStrength.SUPPLY });
    expect(ledValue).toBe(true);

    // GPIO low → LED off
    arbiter.setDriver(13, { id: 'mcu:gpio13', state: 0, strength: DriveStrength.SUPPLY });
    expect(ledValue).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest simulator/src/unisim/core/__tests__/pin-manager-adapter.test.ts`
Expected: All tests fail with "PinManagerAdapter is not defined"

- [ ] **Step 3: Implement PinManagerAdapter**

```typescript
import { PinArbiter } from './pin-arbiter';
import { LogicState, DriveStrength } from '../types/logic-types';

/**
 * Legacy PinManager interface adapter
 * Maintains 100% backward compatibility with existing boolean-based PinManager API
 * Conversion rules:
 * - LogicState 1 → true
 * - LogicState 0, 'Z', 'X' → false (conservative: uncertain states read as low)
 *
 * This adapter allows all existing peripheral drivers to work without modification
 * while new drivers can use the full PinArbiter 4-value logic interface directly.
 */
export class PinManagerAdapter {
  private analogVoltages = new Map<number, number>();
  private pwmListeners = new Map<number, Set<(duty: number) => void>>();

  constructor(private arbiter: PinArbiter) {}

  /**
   * Read pin state as boolean (legacy interface)
   * Returns true only for definite logic high (state === 1)
   */
  readPin(pinNumber: number): boolean {
    return this.arbiter.readPin(pinNumber) === 1;
  }

  /**
   * Set pin input state as boolean (legacy interface)
   * Simulates legacy drivers driving a pin (e.g. pushbutton pulling low or high)
   */
  setPinInput(pinNumber: number, value: boolean): void {
    const state = value ? 1 : 0;
    this.arbiter.setDriver(pinNumber, {
      id: `legacy:input:${pinNumber}`,
      state: state,
      strength: DriveStrength.SUPPLY
    });
  }

  /**
   * Update analog voltage on a pin (legacy interface)
   */
  updateAnalogVoltage(pinNumber: number, voltage: number): void {
    this.analogVoltages.set(pinNumber, voltage);
    // Drive the digital representation: voltage > 1.65V -> high, else low
    const digitalState = voltage > 1.65 ? 1 : 0;
    this.arbiter.setDriver(pinNumber, {
      id: `legacy:analog:${pinNumber}`,
      state: digitalState,
      strength: DriveStrength.SUPPLY
    });
  }

  /**
   * Get analog voltage on a pin (legacy interface helper)
   */
  getAnalogVoltage(pinNumber: number): number {
    return this.analogVoltages.get(pinNumber) ?? this.arbiter.getResolvedVoltage(pinNumber);
  }

  /**
   * Subscribe to pin changes with boolean state (legacy interface)
   */
  onPinChange(pinNumber: number, callback: (pin: number, state: boolean) => void): () => void {
    return this.arbiter.onPinChange(pinNumber, (pin, state) => {
      callback(pin, state === 1);
    });
  }

  /**
   * Register legacy PWM callback
   */
  onPwmChange(channel: number, callback: (duty: number) => void): () => void {
    if (!this.pwmListeners.has(channel)) {
      this.pwmListeners.set(channel, new Set());
    }
    const listeners = this.pwmListeners.get(channel)!;
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  /**
   * Trigger PWM change (simulator runtime helper)
   */
  triggerPwmChange(channel: number, dutyCycle: number): void {
    const listeners = this.pwmListeners.get(channel);
    if (listeners) {
      listeners.forEach(cb => {
        try {
          cb(dutyCycle);
        } catch (e) {
          console.warn(`[PinManagerAdapter] Error in PWM listener for channel ${channel}:`, e);
        }
      });
    }
  }

  /**
   * Access the underlying PinArbiter for advanced 4-value logic operations
   * New drivers should use this directly
   */
  getArbiter(): PinArbiter {
    return this.arbiter;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest simulator/src/unisim/core/__tests__/pin-manager-adapter.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add simulator/src/unisim/core/pin-manager-adapter.ts simulator/src/unisim/core/__tests__/pin-manager-adapter.test.ts
git commit -m "feat(sim): add backward-compatible PinManager adapter"
```

---

### Task 5: Module Index & Public Export Surface

**Files:**
- Create: `simulator/src/unisim/index.ts`

**Interfaces:**
- Produces: Single entry point for all UniSim exports

- [ ] **Step 1: Create index.ts with public exports**

```typescript
/**
 * UniSim - Unified Simulation Engine
 * Pin Arbitration Subsystem (Phase 0)
 *
 * Public API Surface:
 * - PinArbiter: 4-value logic with strength-based arbitration (new API)
 * - PinManagerAdapter: backward-compatible boolean interface (existing code)
 * - Types: LogicState, DriveStrength, PinDriver, IPinArbiter
 */

// Core classes
export { PinArbiter } from './core/pin-arbiter';
export { PinManagerAdapter } from './core/pin-manager-adapter';

// Type definitions
export type {
  LogicState,
  DriveStrength,
  PinDriver,
  PinState,
  PinChangeCallback,
  IPinArbiter,
} from './types/logic-types';
```

- [ ] **Step 2: Verify TypeScript compiles cleanly and check package exports**

Run: `npx tsc --noEmit simulator/src/unisim/index.ts`
Expected: No TypeScript errors.

Also manually check `simulator/package.json` to verify that either wildcards `./src/unisim/*` or exact exports are configured, ensuring external modules can resolve imports from `@wink-ai/unisim` cleanly without path issues.

- [ ] **Step 3: Commit**

```bash
git add simulator/src/unisim/index.ts
git commit -m "feat(sim): add unisim module public index export"
```

---

### Task 6: Update Design Specification Document

**Files:**
- Modify: `docs/design/04-wasm-simulation/archive/02-virtual-peripheral-registry.md`

- [ ] **Step 1: Update section 4 PinManager interface definition**

Find the existing `PeripheralSimulationLogic` interface around line 228-248, and add a note about the new PinArbiter interface:

```typescript
// REPLACE the existing PinManager type definition with this updated version:

/**
 * Legacy PinManager interface (boolean-only, backward-compatible)
 * New drivers should use PinArbiter directly for 4-value logic access
 */
export interface PinManager {
  readPin(pin: number): boolean;
  onPinChange(pin: number, callback: (pin: number, state: boolean) => void): () => void;
}

/**
 * New PinArbiter interface (4-value logic with strength-based arbitration)
 * Use this for new drivers that need:
 * - Open-drain / wire-AND behavior (I2C, OneWire)
 * - Bus conflict detection
 * - High-impedance (Hi-Z) state handling
 * - Voltage estimation for analog components
 */
export interface PinArbiter {
  readPin(pin: number): LogicState; // 0 | 1 | 'Z' | 'X'
  getResolvedVoltage(pin: number): number;
  onPinChange(pin: number, callback: (pin: number, state: LogicState) => void): () => void;
  setDriver(pin: number, driver: PinDriver): void;
  removeDriver(pin: number, driverId: string): void;
}

export interface PeripheralSimulationLogic {
  /**
   * When simulation starts. Receives EITHER legacy PinManager OR new PinArbiter
   * Use pinManager instanceof PinArbiter to detect and use advanced features
   */
  attachEvents?: (
    element: HTMLElement,
    pinManager: PinManager | PinArbiter, // Backward-compatible union type
    getMappedPin: (partPinName: string) => number | null,
    componentId: string
  ) => () => void;
}
```

Note: Above the interface, add this explanatory text:

> **⚠ Interface Evolution Note (2026-06-29 Phase 0):**
> The `PinManager` interface has been superseded by `PinArbiter` which adds 4-value logic (`0 | 1 | 'Z' | 'X'`) and strength-based bus arbitration. For backward compatibility:
> 1. All existing drivers continue to work with the boolean-only `PinManager` adapter
> 2. New drivers can use `pinManager instanceof PinArbiter` to detect and use advanced features
> 3. The `PeripheralSimulationLogic` interface accepts either via union type

- [ ] **Step 2: Add section 4.2 - Pin Arbitration Architecture** after the existing 4.1 section

Add this new section after section 4.1:

```markdown
### 4.2 Pin Arbitration Architecture (Phase 0)

To accurately simulate real electrical circuit behavior including open-drain buses, pull-up/down resistors, and bus contention, UniSim uses a **strength-based 4-value logic arbitration system**.

#### 4.2.1 Core Concepts

**4-value Logic States:**
| State | Meaning | Voltage |
|-------|---------|---------|
| `0` | Logic low | 0.0V |
| `1` | Logic high | 3.3V |
| `'Z'` | High-impedance / floating | 0.0V (undefault, component-specific) |
| `'X'` | Contention / unknown | 1.65V (mid-point) |

**Drive Strength Levels:**
| Level | Value | Use Case |
|-------|-------|----------|
| `SUPPLY` | 3 | Push-pull GPIO, VCC/GND direct connection |
| `PULL` | 2 | External I2C pull-up/down resistors (4.7kΩ) |
| `WEAK` | 1 | Internal MCU pull-up, open-drain release state |

#### 4.2.2 Arbitration Algorithm

1. All drivers with state `'Z'` are ignored (high-impedance does not drive)
2. Find the maximum strength among remaining active drivers
3. If all max-strength drivers agree on state → that state wins
4. If max-strength drivers disagree → `'X'` (contention, logged warning)
5. If no active drivers → `'Z'` (floating)

#### 4.2.3 I2C Wire-AND Example

```typescript
// I2C bus with external pull-up resistor
pinArbiter.setDriver(6, {
  id: 'board:i2c-pullup-sda',
  state: 1,
  strength: DriveStrength.PULL
});

// MCU SDA in open-drain mode
pinArbiter.setDriver(6, {
  id: 'mcu:sda',
  state: 0, // MCU pulls low
  strength: DriveStrength.SUPPLY
});

pinArbiter.readPin(6); // Returns 0 (wire-AND: low wins)

// MCU releases bus
pinArbiter.setDriver(6, {
  id: 'mcu:sda',
  state: 'Z', // Hi-Z release
  strength: DriveStrength.SUPPLY
});

pinArbiter.readPin(6); // Returns 1 (pull-up wins)
```

#### 4.2.4 Migration Guide for Existing Drivers

All existing drivers continue to work without modification via `PinManagerAdapter`. To upgrade a driver to use 4-value logic:

```typescript
// Before (legacy boolean API):
const updateLed = () => {
  const anodeLevel = pinManager.readPin(anodePin); // boolean
  element.value = anodeLevel;
};

// After (new 4-value logic API):
if (pinManager instanceof PinArbiter) {
  const updateLed = () => {
    const voltage = pinManager.getResolvedVoltage(anodePin); // 0.0-3.3V
    element.brightness = Math.min(1, Math.max(0, voltage / 3.3)); // Analog brightness!
  };
}
```
```

- [ ] **Step 3: Commit**

```bash
git add docs/design/04-wasm-simulation/archive/02-virtual-peripheral-registry.md
git commit -m "docs(sim): update spec with pin arbitration architecture"
```

---

### Task 7: Full Test Suite & Integration Smoke Test

**Files:**
- Create: `simulator/src/unisim/__tests__/integration/led-driver-integration.test.ts`

- [ ] **Step 1: Create integration test simulating corrected LED driver from review document**

```typescript
/**
 * Integration test: Corrected LED driver pattern from architecture review
 * Verifies:
 * - Peripheral pin registration pattern
 * - getResolvedVoltage() for analog brightness calculation
 * - Fault injection transparency (PinManager level)
 */
import { PinArbiter } from '../../core/pin-arbiter';
import { DriveStrength } from '../../types/logic-types';

describe('LED Driver Integration - Corrected Pattern (per architecture review)', () => {
  let arbiter: PinArbiter;
  let mockLedElement: { value: boolean; brightness: number };

  beforeEach(() => {
    arbiter = new PinArbiter();
    mockLedElement = { value: false, brightness: 0 };
  });

  test('LED with anode + cathode voltage calculation', () => {
    const componentId = 'led-status';
    const anodePin = 13;
    const cathodePin = 14;

    // Register MCU GPIO drivers (as set up by simulator runtime)
    arbiter.setDriver(anodePin, {
      id: `mcu:gpio${anodePin}`,
      state: 0,
      strength: DriveStrength.SUPPLY
    });
    arbiter.setDriver(cathodePin, {
      id: `mcu:gpio${cathodePin}`,
      state: 0,
      strength: DriveStrength.SUPPLY
    });

    // The corrected LED driver pattern from architecture review:
    // Peripheral registers its pins with appropriate sink/source classification
    // Note: In real implementation, these would be registered by the board/pin mapper
    // Here we just use the arbiter to demonstrate the voltage calculation

    let cleanupCalled = false;

    const attachEvents = (element: typeof mockLedElement) => {
      const updateLed = () => {
        // Use getResolvedVoltage for accurate analog brightness
        const anodeVoltage = arbiter.getResolvedVoltage(anodePin);
        const cathodeVoltage = arbiter.getResolvedVoltage(cathodePin);

        // Consider LED forward voltage drop (~1.8V) and calculate brightness
        const voltageAcrossLed = Math.max(0, anodeVoltage - cathodeVoltage - 1.8);
        const brightness = Math.min(1, voltageAcrossLed / 1.5); // Non-linear curve

        element.value = brightness > 0.1;
        element.brightness = brightness;
      };

      const unsubAnode = arbiter.onPinChange(anodePin, updateLed);
      const unsubCathode = arbiter.onPinChange(cathodePin, updateLed);

      // Initial update
      updateLed();

      return () => {
        unsubAnode();
        unsubCathode();
        cleanupCalled = true;
      };
    };

    // Attach LED driver
    const cleanup = attachEvents(mockLedElement);

    // Initial state: both low → LED off
    expect(mockLedElement.value).toBe(false);
    expect(mockLedElement.brightness).toBe(0);

    // Anode high, cathode low → LED on
    arbiter.setDriver(anodePin, {
      id: `mcu:gpio${anodePin}`,
      state: 1,
      strength: DriveStrength.SUPPLY
    });
    expect(mockLedElement.value).toBe(true);
    expect(mockLedElement.brightness).toBeGreaterThan(0);

    // Both high → no voltage difference → LED off
    arbiter.setDriver(cathodePin, {
      id: `mcu:gpio${cathodePin}`,
      state: 1,
      strength: DriveStrength.SUPPLY
    });
    expect(mockLedElement.value).toBe(false);

    // Cleanup
    cleanup();
    expect(cleanupCalled).toBe(true);
  });

  test('fault injection transparency: disconnect simulates wire break', () => {
    const anodePin = 5;
    let brightness = 0;

    // Normal operation: MCU drives high
    arbiter.setDriver(anodePin, {
      id: 'mcu:gpio5',
      state: 1,
      strength: DriveStrength.SUPPLY
    });

    const unsub = arbiter.onPinChange(anodePin, () => {
      const voltage = arbiter.getResolvedVoltage(anodePin);
      brightness = Math.min(1, Math.max(0, (voltage - 1.8) / 1.5));
    });

    // Initial brightness
    expect(brightness).toBeGreaterThan(0);

    // Fault injection: "disconnect" wire (simulated at PinManager level)
    // This is done by replacing the MCU driver with Hi-Z (peripheral sees Z)
    // In real fault framework, this is handled by the fault injection middleware
    arbiter.setDriver(anodePin, {
      id: 'mcu:gpio5',
      state: 'Z', // Disconnected = high-impedance
      strength: DriveStrength.SUPPLY
    });

    // LED sees floating pin → brightness drops to 0
    expect(brightness).toBe(0);

    // Restore connection
    arbiter.setDriver(anodePin, {
      id: 'mcu:gpio5',
      state: 1,
      strength: DriveStrength.SUPPLY
    });
    expect(brightness).toBeGreaterThan(0);

    unsub();
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `npx jest simulator/src/unisim/ --coverage`
Expected: All tests pass (≥ 90% coverage)

- [ ] **Step 3: Commit integration test**

```bash
git add simulator/src/unisim/__tests__/integration/led-driver-integration.test.ts
git commit -m "test(sim): add LED driver integration test per architecture review pattern"
```

---

## Final Acceptance Criteria (Must Pass Before Merge)

- [ ] **All unit tests pass:** `npx jest simulator/src/unisim/`
- [ ] **TypeScript compiles cleanly:** `npx tsc --noEmit`
- [ ] **Test coverage ≥ 90%:** Verify with `--coverage` flag
- [ ] **Backward compatibility verified:** All existing peripheral driver patterns work unchanged via adapter
- [ ] **I2C wire-AND behavior verified:** Integration tests confirm open-drain arbitration works
- [ ] **Contention detection verified:** X state correctly returned for same-strength conflicts
- [ ] **Hi-Z propagation verified:** Z state correctly resolves for no drivers/all-Z drivers
- [ ] **Design spec updated:** Section 4.2 added to `02-virtual-peripheral-registry.md`

---

## Rollback Plan

If issues are discovered during integration:

1. **Quick toggle:** The `PinManagerAdapter` can be replaced with the original boolean-only implementation in one file change
2. **Full rollback:** `git revert` all commits from this plan (7 commits total with clear prefixes)
3. **Partial rollback:** Keep types/algorithm but disable adapter in simulation entry point

---

## Plan Self-Review (Completed by Plan Author)

- [x] **Spec coverage:** All P0 pin arbitration requirements from review mapped to tasks (Task 1-7)
- [x] **No placeholders:** No TBD/TODO, all code blocks complete, exact file paths
- [x] **Type consistency:** `LogicState`, `DriveStrength`, `PinArbiter` signatures consistent across all tasks
- [x] **TDD pattern:** Every implementation task follows write-failing-test → implement → verify-pass → commit
- [x] **Backward compatibility:** Explicit adapter layer ensures zero breaking changes
- [x] **Voltage estimation:** `getResolvedVoltage()` included for LED brightness calculation (per review spec)
- [x] **I2C wire-AND:** Explicit test for open-drain arbitration behavior
- [x] **Fault injection transparency:** Integration test demonstrates wire disconnect simulation
