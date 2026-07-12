import type { UnifiedPinDef } from './types';
import type { NetDefinition } from '@/types/peripheral-pins';

/**
 * 纯函数：根据 UnifiedPinDef 引脚列表派生走线网表 NetDefinition[]。
 *
 * 规则：
 * 1. 同一 wireNet 值的引脚合并到同一个 NetDefinition 的 pinCandidates 中。
 * 2. 稳定排序输出：primary -> secondary -> vcc -> gnd。
 * 3. 启发式 fallback 规则处理未显式标注 wireNet 的引脚。
 */
export function deriveNetDefinitions(pins: readonly UnifiedPinDef[]): NetDefinition[] {
  const assignedRoles = new Map<UnifiedPinDef, 'primary' | 'secondary' | 'vcc' | 'gnd'>();

  // 1. 先扫描所有显式声明了 wireNet 的引脚，并占位信号槽
  let primaryOccupied = false;
  let secondaryOccupied = false;

  for (const pin of pins) {
    if (pin.wireNet) {
      assignedRoles.set(pin, pin.wireNet);
      if (pin.wireNet === 'primary') {
        primaryOccupied = true;
      } else if (pin.wireNet === 'secondary') {
        secondaryOccupied = true;
      }
    }
  }

  // 2. 按引脚数组顺序为未声明 wireNet 的引脚执行启发式 Fallback
  for (const pin of pins) {
    if (pin.wireNet) continue; // 已显式声明的跳过

    if (pin.signalType === 'power') {
      const defConn = pin.defaultConnection;
      const nameUpper = pin.name.toUpperCase();
      if (defConn === 'GND' || nameUpper === 'GND') {
        assignedRoles.set(pin, 'gnd');
      } else if (
        defConn === 'VCC' ||
        defConn === '3V3' ||
        nameUpper === 'VCC' ||
        nameUpper === '3V3' ||
        nameUpper === 'VIN'
      ) {
        assignedRoles.set(pin, 'vcc');
      }
    } else if (
      pin.signalType === 'digital' ||
      pin.signalType === 'i2c' ||
      pin.signalType === 'custom'
    ) {
      if (!primaryOccupied) {
        assignedRoles.set(pin, 'primary');
        primaryOccupied = true;
      } else if (!secondaryOccupied) {
        assignedRoles.set(pin, 'secondary');
        secondaryOccupied = true;
      }
      // 3个及以后的信号脚静默忽略
    }
  }

  // 3. 聚合成 NetDefinition 结果
  const modes: Array<'primary' | 'secondary' | 'vcc' | 'gnd'> = ['primary', 'secondary', 'vcc', 'gnd'];
  const results: NetDefinition[] = [];

  for (const mode of modes) {
    const pinsInMode = pins.filter((p) => assignedRoles.get(p) === mode);
    if (pinsInMode.length === 0) continue;

    const pinCandidates = pinsInMode.map((p) => p.name);

    // 默认连接取该组内第一个非 null/undefined 的连接
    let defaultConnection = undefined;
    for (const p of pinsInMode) {
      if (p.defaultConnection !== null && p.defaultConnection !== undefined) {
        defaultConnection = p.defaultConnection;
        break;
      }
    }

    let signalType: 'digital' | 'i2c' | 'power';
    if (mode === 'vcc' || mode === 'gnd') {
      signalType = 'power';
    } else {
      const firstPinType = pinsInMode[0].signalType;
      if (firstPinType === 'i2c') {
        signalType = 'i2c';
      } else {
        // digital / custom 均映射为 digital，以防 mode 无法画线
        signalType = 'digital';
      }
    }

    const netDef: NetDefinition = {
      mode,
      signalType,
      pinCandidates,
    };

    if (defaultConnection !== undefined) {
      netDef.defaultConnection = defaultConnection;
    }

    results.push(netDef);
  }

  return results;
}
