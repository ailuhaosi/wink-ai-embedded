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

  /** 仿真观察插件（binding 桥为主路径；observe 为 OLED/超声等过渡） */
  simulation?: {
    observe?: ObserveFn;
  };

  /** 可选：属性面板额外插槽（用于非常规控件，如距离滑块） */
  inspectorExtra?: Component;
}

export type { PinConnectionValue };
