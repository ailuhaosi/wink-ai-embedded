import { PinArbiter } from './pin-arbiter';
import { PinManagerAdapter } from './pin-manager-adapter';
import {
  PeripheralTypeDefinition,
  PeripheralInstance,
  PeripheralDriver,
  PeripheralRegistryEvent,
  RegistryEventHandler,
  PeripheralPinMapping,
  PowerDomain,
} from '../types/peripheral-types';

/**
 * PeripheralRegistry - Central registry for virtual peripherals
 *
 * Manages:
 * - Peripheral type registration (LED, button, servo, etc.)
 * - Peripheral instance lifecycle (create/destroy/power on/off)
 * - Pin mapping and resource allocation
 * - Event notification for UI updates
 * - Fault injection hooks
 */
export class PeripheralRegistry {
  /** Registered peripheral types */
  private types = new Map<string, PeripheralTypeDefinition>();

  /** Active peripheral instances */
  private instances = new Map<string, PeripheralInstance>();

  /** Counter for auto-generated instance IDs */
  private instanceCounter = 0;

  /** Instance cleanup functions (from attachEvents) */
  private instanceCleanup = new Map<string, () => void>();

  /** Event listeners */
  private listeners = new Set<RegistryEventHandler>();

  /** Pin arbiter instance */
  private pinArbiter: PinArbiter;

  /** Legacy pin manager adapter (for backward-compatible drivers) */
  private pinManagerAdapter: PinManagerAdapter;

  /** Track used pins for conflict detection */
  private usedPins = new Map<number, Set<string>>();

  constructor(pinArbiter: PinArbiter) {
    this.pinArbiter = pinArbiter;
    this.pinManagerAdapter = new PinManagerAdapter(pinArbiter);
  }

  //
  // Type Registration
  //

  /**
   * Register a new peripheral type
   * @param definition Peripheral type definition
   */
  registerType(definition: PeripheralTypeDefinition): void {
    if (this.types.has(definition.type)) {
      console.warn(`[PeripheralRegistry] Type "${definition.type}" already registered, overwriting`);
    }
    this.types.set(definition.type, definition);
    this.emit({ type: 'type-registered', peripheralType: definition.type });
  }

  /**
   * Unregister a peripheral type
   * @param type Peripheral type identifier
   */
  unregisterType(type: string): void {
    this.types.delete(type);
    this.emit({ type: 'type-unregistered', peripheralType: type });
  }

  /**
   * Get all registered peripheral types
   */
  getRegisteredTypes(): PeripheralTypeDefinition[] {
    return Array.from(this.types.values());
  }

  /**
   * Get a specific peripheral type definition
   */
  getType(type: string): PeripheralTypeDefinition | undefined {
    return this.types.get(type);
  }

  /**
   * Check if a peripheral type is registered
   */
  hasType(type: string): boolean {
    return this.types.has(type);
  }

  //
  // Instance Management
  //

  /**
   * Create a new peripheral instance
   * @param type Peripheral type identifier
   * @param options Instance configuration options
   * @returns New peripheral instance
   */
  createInstance(
    type: string,
    options: {
      id?: string;
      name?: string;
      pins?: PeripheralPinMapping[];
      properties?: Record<string, any>;
      powerDomain?: PowerDomain;
      powerUpDelayUs?: number;
      element?: HTMLElement;
    } = {}
  ): PeripheralInstance {
    const typeDef = this.types.get(type);
    if (!typeDef) {
      throw new Error(`Peripheral type "${type}" not registered`);
    }

    const instanceId = options.id || `${type}-${++this.instanceCounter}`;

    if (this.instances.has(instanceId)) {
      throw new Error(`Peripheral instance "${instanceId}" already exists`);
    }

    // Merge default properties from type definition with user-provided properties
    const defaultProperties: Record<string, any> = {};
    typeDef.propertySchema.forEach(prop => {
      defaultProperties[prop.prop] = prop.default;
    });

    const instance: PeripheralInstance = {
      id: instanceId,
      type,
      name: options.name || `${typeDef.name} #${this.instances.size + 1}`,
      powerDomain: options.powerDomain || typeDef.defaultPowerDomain,
      powerUpDelayUs: options.powerUpDelayUs ?? typeDef.defaultPowerUpDelayUs,
      pins: options.pins || [],
      properties: { ...defaultProperties, ...options.properties },
      isPowered: false,
      element: options.element,
    };

    // Check for pin conflicts
    this.checkPinConflicts(instance);

    // Create driver instance
    instance.driver = typeDef.driverFactory(instance);

    // Register pins as used
    instance.pins.forEach(pin => {
      if (!this.usedPins.has(pin.mcuPin)) {
        this.usedPins.set(pin.mcuPin, new Set());
      }
      this.usedPins.get(pin.mcuPin)!.add(instanceId);
    });

    this.instances.set(instanceId, instance);
    this.emit({ type: 'peripheral-added', instanceId });

    return instance;
  }

  /**
   * Destroy a peripheral instance
   * @param instanceId Instance identifier
   */
  destroyInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    // Power off first if powered
    if (instance.isPowered) {
      this.powerOffInstance(instanceId);
    }

    // Unregister pins
    instance.pins.forEach(pin => {
      const pinUsers = this.usedPins.get(pin.mcuPin);
      if (pinUsers) {
        pinUsers.delete(instanceId);
        if (pinUsers.size === 0) {
          this.usedPins.delete(pin.mcuPin);
        }
      }
    });

    this.instances.delete(instanceId);
    this.emit({ type: 'peripheral-removed', instanceId });
  }

  /**
   * Get all peripheral instances
   */
  getAllInstances(): PeripheralInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get a specific peripheral instance
   */
  getInstance(instanceId: string): PeripheralInstance | undefined {
    return this.instances.get(instanceId);
  }

  //
  // Power Management
  //

  /**
   * Power on a peripheral instance
   * @param instanceId Instance identifier
   */
  async powerOnInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Peripheral instance "${instanceId}" not found`);
    }

    if (instance.isPowered) {
      console.warn(`[PeripheralRegistry] Instance "${instanceId}" already powered on`);
      return;
    }

    // Simulate power-up delay if specified
    if (instance.powerUpDelayUs > 0) {
      // Convert microseconds to milliseconds for setTimeout
      await new Promise(resolve => setTimeout(resolve, instance.powerUpDelayUs / 1000));
    }

    // Call driver power-on hook
    if (instance.driver?.onPowerOn) {
      await instance.driver.onPowerOn();
    }

    // Attach events to pin arbiter
    if (instance.driver?.attachEvents) {
      const getMappedPin = (peripheralPinName: string): number | null => {
        const mapping = instance.pins.find(p => p.peripheralPin === peripheralPinName);
        return mapping?.mcuPin ?? null;
      };

      const cleanup = instance.driver.attachEvents(
        this.pinArbiter,
        getMappedPin,
        instance.element
      );
      this.instanceCleanup.set(instanceId, cleanup);
    }

    instance.isPowered = true;
    this.emit({ type: 'peripheral-powered-on', instanceId });
  }

  /**
   * Power off a peripheral instance
   * @param instanceId Instance identifier
   */
  powerOffInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    if (!instance.isPowered) {
      console.warn(`[PeripheralRegistry] Instance "${instanceId}" already powered off`);
      return;
    }

    // Call cleanup function from attachEvents
    const cleanup = this.instanceCleanup.get(instanceId);
    if (cleanup) {
      try {
        cleanup();
      } catch (e) {
        console.warn(`[PeripheralRegistry] Error during cleanup for "${instanceId}":`, e);
      }
      this.instanceCleanup.delete(instanceId);
    }

    // Call driver power-off hook
    if (instance.driver?.onPowerOff) {
      instance.driver.onPowerOff();
    }

    instance.isPowered = false;
    this.emit({ type: 'peripheral-powered-off', instanceId });
  }

  /**
   * Reset a peripheral instance (power off -> power on)
   * @param instanceId Instance identifier
   */
  async resetInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    if (instance.driver?.onReset) {
      instance.driver.onReset();
    } else {
      // Fallback: power cycle
      this.powerOffInstance(instanceId);
      await this.powerOnInstance(instanceId);
    }
  }

  /**
   * Power on all peripherals in a specific power domain
   */
  async powerOnDomain(domain: PowerDomain): Promise<void> {
    const instances = this.getAllInstances().filter(i => i.powerDomain === domain);
    await Promise.all(instances.map(i => this.powerOnInstance(i.id)));
  }

  /**
   * Power off all peripherals in a specific power domain
   */
  powerOffDomain(domain: PowerDomain): void {
    this.getAllInstances()
      .filter(i => i.powerDomain === domain)
      .forEach(i => this.powerOffInstance(i.id));
  }

  /**
   * Power on all registered peripherals
   */
  async powerOnAll(): Promise<void> {
    await Promise.all(this.getAllInstances().map(i => this.powerOnInstance(i.id)));
  }

  /**
   * Power off all registered peripherals
   */
  powerOffAll(): void {
    this.getAllInstances().forEach(i => this.powerOffInstance(i.id));
  }

  //
  // Property Management
  //

  /**
   * Update a peripheral instance property
   * Triggers onPropertyChange hook on the driver
   */
  setInstanceProperty(instanceId: string, key: string, value: any): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const oldValue = instance.properties[key];
    if (oldValue === value) return; // No change

    instance.properties[key] = value;

    if (instance.driver?.onPropertyChange) {
      instance.driver.onPropertyChange(key, oldValue, value);
    }

    this.emit({ type: 'peripheral-property-changed', instanceId, key });
  }

  /**
   * Update multiple properties at once
   */
  setInstanceProperties(instanceId: string, properties: Record<string, any>): void {
    Object.entries(properties).forEach(([key, value]) => {
      this.setInstanceProperty(instanceId, key, value);
    });
  }

  //
  // Pin Management
  //

  /**
   * Add or update a pin mapping for an instance
   */
  setPinMapping(instanceId: string, pinMapping: PeripheralPinMapping): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    // Remove old mapping if it exists
    const existingIndex = instance.pins.findIndex(
      p => p.peripheralPin === pinMapping.peripheralPin
    );

    if (existingIndex >= 0) {
      const oldMapping = instance.pins[existingIndex];
      // Unregister old pin
      const pinUsers = this.usedPins.get(oldMapping.mcuPin);
      if (pinUsers) {
        pinUsers.delete(instanceId);
        if (pinUsers.size === 0) {
          this.usedPins.delete(oldMapping.mcuPin);
        }
      }
      instance.pins.splice(existingIndex, 1);
    }

    // Check for conflicts on the new pin
    const existingUsers = this.usedPins.get(pinMapping.mcuPin);
    if (existingUsers && existingUsers.size > 0 && !existingUsers.has(instanceId)) {
      console.warn(
        `[PeripheralRegistry] Pin ${pinMapping.mcuPin} already in use by:`,
        Array.from(existingUsers)
      );
    }

    // Register new pin
    if (!this.usedPins.has(pinMapping.mcuPin)) {
      this.usedPins.set(pinMapping.mcuPin, new Set());
    }
    this.usedPins.get(pinMapping.mcuPin)!.add(instanceId);
    instance.pins.push(pinMapping);
  }

  /**
   * Get all instances using a specific pin
   */
  getInstancesUsingPin(pinNumber: number): string[] {
    const users = this.usedPins.get(pinNumber);
    return users ? Array.from(users) : [];
  }

  /**
   * Check if a pin is already in use by any peripheral
   */
  isPinUsed(pinNumber: number): boolean {
    const users = this.usedPins.get(pinNumber);
    return users ? users.size > 0 : false;
  }

  //
  // Event System
  //

  /**
   * Subscribe to registry events
   */
  addEventListener(handler: RegistryEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /**
   * Unsubscribe from registry events
   */
  removeEventListener(handler: RegistryEventHandler): void {
    this.listeners.delete(handler);
  }

  //
  // Internal Helpers
  //

  private emit(event: PeripheralRegistryEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (e) {
        console.warn('[PeripheralRegistry] Error in event listener:', e);
      }
    });
  }

  private checkPinConflicts(instance: PeripheralInstance): void {
    instance.pins.forEach(pin => {
      const existingUsers = this.usedPins.get(pin.mcuPin);
      if (existingUsers && existingUsers.size > 0) {
        console.warn(
          `[PeripheralRegistry] Pin ${pin.mcuPin} already in use by:`,
          Array.from(existingUsers)
        );
      }
    });
  }

  /**
   * Get the underlying pin arbiter
   */
  getPinArbiter(): PinArbiter {
    return this.pinArbiter;
  }

  /**
   * Get the legacy pin manager adapter
   */
  getPinManagerAdapter(): PinManagerAdapter {
    return this.pinManagerAdapter;
  }

  /**
   * Destroy the registry and clean up all resources
   */
  destroy(): void {
    this.powerOffAll();
    this.instances.clear();
    this.instanceCleanup.clear();
    this.usedPins.clear();
    this.listeners.clear();
  }
}
