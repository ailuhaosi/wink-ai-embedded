import type { PinArbiter } from '../core/pin-arbiter';
import type { LogicState } from './logic-types';

/**
 * Peripheral power domain classification
 * Controls which power rail supplies the peripheral and its power-on sequencing
 */
export enum PowerDomain {
  /** 3.3V main system power (always on for MCU) */
  VCC_3V3 = '3v3_sys',
  /** 5V peripheral power (for servos, sensors) */
  VCC_5V = '5v_periph',
  /** Battery-backed RTC domain */
  VBAT = 'vbat',
  /** Software-controlled power switch */
  SWITCHABLE = 'switchable',
}

/**
 * Pin direction classification for peripheral pins
 * Used for automatic pin direction configuration and conflict detection
 */
export enum PinDirection {
  /** Peripheral drives this pin (output) */
  SOURCE = 'source',
  /** Peripheral reads this pin (input) */
  SINK = 'sink',
  /** Bidirectional pin (I2C SDA/SCL) */
  BIDIRECTIONAL = 'bidirectional',
  /** Power supply pin */
  POWER = 'power',
  /** Ground pin */
  GROUND = 'ground',
}

/**
 * Pin mapping definition for a peripheral instance
 * Maps peripheral pin names (e.g., "Anode", "SDA") to physical GPIO pin numbers
 */
export interface PeripheralPinMapping {
  /** Peripheral-side pin name (e.g., "Anode", "SDA", "VCC") */
  peripheralPin: string;
  /** Physical MCU GPIO pin number */
  mcuPin: number;
  /** Pin direction/role */
  direction: PinDirection;
  /** Optional pull-up/down resistor configuration */
  pullUp?: boolean;
  pullDown?: boolean;
}

/**
 * Peripheral instance metadata
 * Tracks the state and configuration of a placed peripheral
 */
export interface PeripheralInstance {
  /** Unique instance ID (e.g., "led-status-1", "button-user-2") */
  id: string;
  /** Peripheral type identifier (matches registered driver type) */
  type: string;
  /** Human-readable display name */
  name: string;
  /** Power domain this peripheral belongs to */
  powerDomain: PowerDomain;
  /** Power-on delay in microseconds (simulated ramp-up time) */
  powerUpDelayUs: number;
  /** Pin mappings for this instance */
  pins: PeripheralPinMapping[];
  /** Peripheral-specific properties (SchemaForm editable) */
  properties: Record<string, any>;
  /** Current power state */
  isPowered: boolean;
  /** Optional DOM element for visual peripherals */
  element?: HTMLElement;
  /** Driver instance (set after initialization) */
  driver?: PeripheralDriver;
}

/**
 * Peripheral driver interface
 * All virtual peripheral drivers must implement this interface
 */
export interface PeripheralDriver {
  /**
   * Called when the peripheral is powered on
   * Use this to initialize state, register pin drivers, etc.
   */
  onPowerOn?(): Promise<void> | void;

  /**
   * Called when the peripheral is powered off
   * Use this to clean up, unregister pin drivers, etc.
   */
  onPowerOff?(): void;

  /**
   * Called when the peripheral is reset
   * Should restore initial state without re-registering pins
   */
  onReset?(): void;

  /**
   * Called when a peripheral property is changed via the property panel
   * @param key Property name that changed
   * @param oldValue Previous value
   * @param newValue New value
   */
  onPropertyChange?(key: string, oldValue: any, newValue: any): void;

  /**
   * Called during simulation initialization to attach to pin arbiter
   * This is where peripherals register pin change listeners and drivers
   * @param arbiter Native PinArbiter with 4-value logic API
   * @param getMappedPin Helper to get MCU pin number from peripheral pin name
   * @param element Optional DOM element for visual interaction
   * @returns Cleanup function to be called on detach
   */
  attachEvents?(
    arbiter: PinArbiter,
    getMappedPin: (peripheralPinName: string) => number | null,
    element?: HTMLElement
  ): () => void;
}

/**
 * Peripheral driver factory function
 * Creates a new driver instance for a peripheral
 */
export type PeripheralDriverFactory = (instance: PeripheralInstance) => PeripheralDriver;

/**
 * Peripheral type definition for registry
 * Contains all metadata and factory for a peripheral type
 */
export interface PeripheralTypeDefinition {
  /** Unique type identifier (e.g., "generic-led", "pushbutton") */
  type: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Category for UI grouping */
  category: 'output' | 'input' | 'sensor' | 'actuator' | 'communication' | 'power';
  /** Default power domain */
  defaultPowerDomain: PowerDomain;
  /** Default power-up delay in microseconds */
  defaultPowerUpDelayUs: number;
  /** Pin definitions (template for the UI) */
  pinDefinitions: Array<{
    name: string;
    label: string;
    direction: PinDirection;
    required: boolean;
  }>;
  /** Property schema (for SchemaForm generation) */
  propertySchema: Array<{
    prop: string;
    label: string;
    type: 'boolean' | 'number' | 'string' | 'select' | 'slider';
    default: any;
    options?: any[];
    min?: number;
    max?: number;
    step?: number;
  }>;
  /** Driver factory function */
  driverFactory: PeripheralDriverFactory;
  /** Optional SVG thumbnail for UI */
  thumbnail?: string;
}

/**
 * Event types emitted by the PeripheralRegistry
 */
export type PeripheralRegistryEvent =
  | { type: 'peripheral-added'; instanceId: string }
  | { type: 'peripheral-removed'; instanceId: string }
  | { type: 'peripheral-powered-on'; instanceId: string }
  | { type: 'peripheral-powered-off'; instanceId: string }
  | { type: 'peripheral-property-changed'; instanceId: string; key: string }
  | { type: 'type-registered'; peripheralType: string }
  | { type: 'type-unregistered'; peripheralType: string };

/**
 * Registry event callback type
 */
export type RegistryEventHandler = (event: PeripheralRegistryEvent) => void;
