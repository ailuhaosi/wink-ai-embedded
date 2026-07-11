import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { ActuatorObserveSource } from '@/types/actuator-observation';

export interface ObserveBuilder {
  /** 声明需要观察的 GPIO 引脚 */
  watchGpio(pins: number[]): void;

  /** 声明 I2C 总线配置 */
  watchI2C(sda: number | null, scl: number | null): void;

  /** 声明超声波传感器配置 */
  watchUltrasonic(trig: number | null, echo: number | null): void;

  /** 声明执行器观察源配置 */
  watchActuatorSource(source: ActuatorObserveSource): void;

  /** 声明自定义仿真参数（透传给 Worker） */
  setParam(key: string, value: unknown): void;
}

export type ObserveResult = {
  pins: number[];
  oled: boolean;
  oledConfig: { sda: number | null; scl: number | null } | null;
  ultrasonicConfig: { trig: number | null; echo: number | null } | null;
  actuatorSources: ActuatorObserveSource[];
  [key: string]: unknown;
};

export type ObserveFn = (comp: CircuitComponentInstance, builder: ObserveBuilder) => void;

/** ObserveBuilder 内部实现（聚合所有外设声明） */
export class ObserveBuilderImpl implements ObserveBuilder {
  private gpioPins: number[] = [];
  private i2cConfigs: Array<{ sda: number | null; scl: number | null }> = [];
  private ultrasonicConfigs: Array<{ trig: number | null; echo: number | null }> = [];
  private actuatorSources: ActuatorObserveSource[] = [];
  private params: Record<string, unknown> = {};

  watchGpio(pins: number[]): void {
    this.gpioPins.push(...pins);
  }

  watchI2C(sda: number | null, scl: number | null): void {
    this.i2cConfigs.push({ sda, scl });
  }

  watchUltrasonic(trig: number | null, echo: number | null): void {
    this.ultrasonicConfigs.push({ trig, echo });
  }

  watchActuatorSource(source: ActuatorObserveSource): void {
    this.actuatorSources.push(source);
  }

  setParam(key: string, value: unknown): void {
    this.params[key] = value;
  }

  build(): ObserveResult {
    return {
      pins: this.gpioPins,
      oled: this.i2cConfigs.length > 0,
      oledConfig: this.i2cConfigs[0] ?? null,
      ultrasonicConfig: this.ultrasonicConfigs[0] ?? null,
      actuatorSources: this.actuatorSources,
      ...this.params,
    };
  }
}
