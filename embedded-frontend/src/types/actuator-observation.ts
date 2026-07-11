/** 统一物理量（SI 或项目约定单位；扩展非电机外设只加 enum 并在外设插件中注册 Converter） */
export type ActuatorQuantity =
  | 'angular_position'   // 角度 (unit: deg 或 rad)
  | 'angular_velocity'   // 角速度 (unit: rpm 或 rad/s)
  | 'linear_position'    // 线位置 (unit: m)
  | 'torque'             // 扭矩 (unit: N·m)
  | 'duty_cycle'         // 原始占空比
  | 'state'              // 开关状态: 'on' | 'off'
  | 'color'              // RGB 颜色 (如: '#ff0000')
  | 'pixel_colors'       // 灯带颜色阵列 (如: string[])
  | 'sound_frequency'    // 蜂鸣器频率 (Hz)
  | 'display_text';      // 文本内容

export interface ActuatorObservation {
  /** = CircuitComponentInstance.id (= manifest devices[].componentId) */
  deviceComponentId: string;
  quantity: ActuatorQuantity;
  value: number | string | any[];
  /** UI 显示单位 */
  unit: 'deg' | 'rpm' | 'percent' | 'bool' | 'hz' | 'rgb' | 'none';
  /**
   * Phase 1 舵机 PWM 镜像固件输出 → role='command'（非传感器 feedback）。
   * 未来编码器/电流采样等才用 'feedback'。
   */
  role: 'command' | 'feedback';
  simTimeUs: string;
  /** Phase 2 预留：动力学平滑 / 质量标记，Phase 1 不填 */
  quality?: 'valid' | 'extrapolated' | 'fault';
}

/** Worker → UI Raw batch（对齐 W3b 设计文档；Phase 1 选定方案 A 嵌入 STATE_UPDATE） */
export interface ActuatorOutputBatch {
  simTimeUs: string;
  gpio: Record<number, boolean>;
  pwm: Record<number, number>;    // channel → duty 0..100
  uart?: Record<number, string>;
  i2c?: Record<number, string>;
  /** 未来：DAL 语义快照直通，Mapper 优先消费 */
  semantic?: ActuatorObservation[];
}

/** 外设插件声明：如何从 Wasm 采集 */
export interface ActuatorObserveSource {
  deviceComponentId: string;    // = comp.id
  transport: 'pwm_channel' | 'gpio_pin' | 'uart_port' | 'can_bus' | 'i2c_bus';
  transportKey: number | string;
  subAddress?: number;
}

/** 外设插件声明：如何映射为物理量（Phase 1 无 manifest binding 时用） */
export interface ActuatorObserveProfile {
  defaultQuantity: ActuatorQuantity;
  unit: ActuatorObservation['unit'];
  convert: string;                // 转换器 ID，注册在 actuatorConverterRegistry
}
