import type { Component } from 'vue';
import type { PinConnectionValue } from '@/types/peripheral-pins';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { ObserveFn } from './observe-builder';
import type { ActuatorObservation, ActuatorObserveProfile } from '@/types/actuator-observation';

/** 单个属性的定义 schema */
export interface PeripheralPropDef {
  /** 属性值类型 */
  type: 'string' | 'number' | 'boolean' | 'enum' | 'color';

  /** 默认值（必须与 type 匹配） */
  default: string | number | boolean;

  /** 用户可见的描述（可走 i18n key） */
  description: string;

  /** enum 类型的可选值列表 */
  options?: readonly string[];

  /** number 类型的范围约束 */
  range?: { min: number; max: number; step?: number };

  /** 是否为高级属性（默认折叠或仅专家模式显示） */
  advanced?: boolean;
}

/** 属性集合类型 */
export type PeripheralPropsSchema = Record<string, PeripheralPropDef>;

export type CatalogPinType =
  | 'pwm'
  | 'gpio'
  | 'digital_in'
  | 'digital_out'
  | 'i2c'
  | 'power';

/** 统一引脚 SSOT — 画布 + catalog + pin-resolver 共用 */
export interface UnifiedPinDef {
  name: string;
  /** catalog / B-06 / pin-resolver 用语义类型 */
  catalogType: CatalogPinType;
  description?: string;
  required?: boolean;
  /** 画布走线语义 */
  signalType: 'digital' | 'i2c' | 'power' | 'custom';
  defaultConnection?: PinConnectionValue;
  /** Pin position relative to component top-left (canvas layout) */
  relX?: number;
  relY?: number;
}

/** @deprecated Use UnifiedPinDef — alias kept for incremental migration */
export type PeripheralPinDef = UnifiedPinDef;

export interface PeripheralDefinition {
  /** 画布 / 实例 type，如 'led' */
  type: string;

  /** 用户可见名称 */
  displayName: string;

  /** 分类（用于资产库分组） */
  category: 'display' | 'input' | 'sensor' | 'actuator' | 'other';

  /** 资产库 / catalog 元数据（引脚由 definition.pins 派生，不在此重复） */
  catalog?: {
    id: string;
    description?: string;
    worldCoupling: 'none' | 'optional' | 'required';
    allowedActuatorMappings?: string[];
    allowedSensorMappings?: string[];
  };

  /** 画布尺寸（未旋转时） */
  size: { width: number; height: number };

  /** 引脚定义（唯一 SSOT） */
  pins: UnifiedPinDef[];

  /** 属性 schema（用于自动生成属性面板 + 派生默认值） */
  props: PeripheralPropsSchema;

  /** 走线颜色 */
  wireColor?: string;

  /** 画布视图组件 */
  canvas?: {
    component: Component;
  };

  /** 世界视口组件 */
  world?: {
    component: Component;
  };

  /** 仿真观察 / 理想输入注入插件 */
  simulation?: {
    observe?: ObserveFn;
    inject?: PeripheralSimulationInject;
  };

  /** 执行器观测映射声明 (Phase 1/2) */
  actuatorObserve?: {
    profile: ActuatorObserveProfile;
  };

  /** 可选：属性面板额外插槽（用于非常规控件，如距离滑块） */
  inspectorExtra?: Component;

  /** 仿真视图绑定插件（canvas/world props 派生；M2 起替代宿主内 switch 分发） */
  ui?: PeripheralUiBind;
}

export type { PinConnectionValue };

/** 多态引脚信号态（对接 tech-design §13.4），兼容今日 boolean 表示 */
export interface PinSignalState {
  level: boolean;
  voltage?: number;
  mode: 'input' | 'output' | 'high_z' | 'analog';
  pull: 'none' | 'up' | 'down';
}

/** 外设 ui.canvasProps/worldProps 只读上下文（只读冻结，避免 binder 反向写宿主状态） */
export interface SimViewContext {
  readonly pinStates: Record<number, boolean | PinSignalState>;
  /** ② 今日单屏过渡：与 oledFb 同值 */
  readonly displayFb: Uint8Array | null;
  /** @deprecated 别名，binder 内可读 ctx.displayFb */
  readonly oledFb?: Uint8Array | null;
  readonly actuatorObservations: readonly ActuatorObservation[];
}

/**
 * 安全判断引脚是否为高电平。
 * Worker/C 侧偶发回传 0/1 number（非 boolean）；必须在此归一，否则
 * `isPinHigh(0)` 会误走对象分支得到 `undefined`，World LED `level` 崩掉。
 */
export function isPinHigh(
  state: boolean | number | PinSignalState | undefined | null,
): boolean {
  if (state === undefined || state === null) return false;
  if (typeof state === 'boolean') return state;
  if (typeof state === 'number') return state !== 0;
  if (typeof state === 'object' && 'level' in state) {
    return isPinHigh(state.level);
  }
  return Boolean(state);
}

export interface InjectContext {
  event?: 'press' | 'release' | 'props' | 'idle';
  /** 可选：当由确定性测试回放触发时，指示当前注入的仿真微秒时间戳 */
  timestampUs?: string;
  /** 宿主可注入的共享 API，避免外设 import pin-api 造成环依赖 */
  apis: {
    /** 注入 GPIO 理想值，支持时间戳，支持弱拉或强覆盖模式（用于解决同引脚冲突） */
    setPinIdeal: (
      pin: number,
      level: boolean,
      options?: { timestampUs?: string; drive?: 'strong' | 'weak' },
    ) => void;
    setUltrasonicDistance: (
      trig: number,
      echo: number,
      cm: number,
      options?: { timestampUs?: string },
    ) => void;
    /** 获取仿真 Worker 的当前虚拟时间，协助外设进行时序同步 */
    getCurrentSimTimeUs: () => string;
  };
}

/** ④ Ideal Inject 插件契约 */
export interface PeripheralSimulationInject {
  kind: 'gpio_ideal' | 'ultrasonic_distance' | 'ideal_inputs';
  apply: (comp: CircuitComponentInstance, ctx: InjectContext) => void;
  idle?: (comp: CircuitComponentInstance, ctx: InjectContext) => void;
}

/** 外设仿真视图绑定：将 CircuitComponentInstance + SimViewContext 映射为渲染组件 props */
export interface PeripheralUiBind {
  canvasProps?: (
    comp: CircuitComponentInstance,
    ctx: SimViewContext,
  ) => Record<string, unknown>;
  worldProps?: (
    comp: CircuitComponentInstance,
    ctx: SimViewContext,
  ) => Record<string, unknown>;
}
