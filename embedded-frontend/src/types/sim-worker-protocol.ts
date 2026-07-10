/** Shared Worker ↔ UI message protocol (single source of truth for message shapes). */

export interface SimFaultsConfig {
  bounce_us: number;
  warmup_us: number;
  sample_interval_us: number;
  adc_noise_v: number;
  rc_tau_s: number;
  i2c_drop_permil: number;
  prng_seed: number;
}

export interface SimStatePayload {
  us: string;
  pinStates: Record<number, boolean>;
  oledFb: Uint8Array | null;
  traces: Array<{
    timestamp: number | string;
    type: number;
    pinOrBus: number;
    sequence?: number;
  }>;
  isFaulted: boolean;
}

export interface SimLogPayload {
  level: string;
  message: string;
  timestamp: number;
}

export interface ObservePinsPayload {
  pins: number[];
  oled: boolean;
  oledConfig?: {
    sda: number | string | null;
    scl: number | string | null;
  } | null;
  ultrasonicConfig?: {
    trig: number | string | null;
    echo: number | string | null;
  } | null;
}

export type SimWorkerInbound
  = | { type: 'INIT' }
    | { type: 'START' }
    | { type: 'PAUSE' }
    | { type: 'RESET' }
    | { type: 'SET_PIN_IDEAL'; payload: { pin: number; level: boolean } }
    | {
      type: 'SET_ULTRASONIC_DISTANCE';
      payload: { trigPin: number; echoPin: number; distanceCm: number };
    }
    | { type: 'OBSERVE_PINS'; payload: ObservePinsPayload }
    | { type: 'SET_FAULTS'; payload: SimFaultsConfig }
    | { type: 'SET_SPEED'; payload: number };

export type SimWorkerOutbound
  = | { type: 'INIT_DONE' }
    | { type: 'RESET_DONE' }
    | { type: 'STATE_UPDATE'; payload: SimStatePayload }
    | { type: 'LOG'; payload: SimLogPayload }
    | { type: 'ERROR'; message: string };

export const SimWorkerInboundType = {
  INIT: 'INIT',
  START: 'START',
  PAUSE: 'PAUSE',
  RESET: 'RESET',
  SET_PIN_IDEAL: 'SET_PIN_IDEAL',
  SET_ULTRASONIC_DISTANCE: 'SET_ULTRASONIC_DISTANCE',
  OBSERVE_PINS: 'OBSERVE_PINS',
  SET_FAULTS: 'SET_FAULTS',
  SET_SPEED: 'SET_SPEED',
} as const;

export const SimWorkerOutboundType = {
  INIT_DONE: 'INIT_DONE',
  RESET_DONE: 'RESET_DONE',
  STATE_UPDATE: 'STATE_UPDATE',
  LOG: 'LOG',
  ERROR: 'ERROR',
} as const;
