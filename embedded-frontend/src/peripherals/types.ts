import type { Component } from 'vue';
import type { PinConnectionValue } from '@/types/peripheral-pins';
import type { ObserveFn } from './observe-builder';

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

export interface PeripheralPinDef {
  name: string;
  signalType: 'digital' | 'i2c' | 'power' | 'custom';
  description?: string;
  required?: boolean;
  defaultConnection?: PinConnectionValue;
  /** Pin position relative to component top-left (canvas layout) */
  relX?: number;
  relY?: number;
}

export interface PeripheralDefinition {
  /** 画布 / 实例 type，如 'led' */
  type: string;

  /** 用户可见名称 */
  displayName: string;

  /** 分类（用于资产库分组） */
  category: 'display' | 'input' | 'sensor' | 'actuator' | 'other';

  /** 资产库 / catalog 所需字段（P2 与 device-catalog 收敛） */
  catalog?: {
    id: string;
    description: string;
    pins: Array<{ name: string; type: string; description?: string; required?: boolean }>;
    worldCoupling?: 'none' | 'optional' | 'required';
    allowedActuatorMappings?: string[];
    allowedSensorMappings?: string[];
  };

  /** 画布尺寸（未旋转时） */
  size: { width: number; height: number };

  /** 引脚定义 */
  pins: PeripheralPinDef[];

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

  /** P3：仿真观察插件接口 */
  simulation?: {
    worldCoupling?: 'none' | 'optional' | 'required';
    observe?: ObserveFn;
  };

  /** 可选：属性面板额外插槽（用于非常规控件，如距离滑块） */
  inspectorExtra?: Component;
}

export type { PinConnectionValue };
