import { PeripheralRegistry } from '../peripheral-registry';
import { PinArbiter } from '../pin-arbiter';
import { PinManagerAdapter } from '../pin-manager-adapter';
import { PowerDomain, PinDirection, PeripheralDriver } from '../../types/peripheral-types';

describe('PeripheralRegistry', () => {
  let pinArbiter: PinArbiter;
  let registry: PeripheralRegistry;

  beforeEach(() => {
    pinArbiter = new PinArbiter();
    registry = new PeripheralRegistry(pinArbiter);
  });

  afterEach(() => {
    registry.destroy();
  });

  describe('Type Registration', () => {
    test('registerType adds a peripheral type to registry', () => {
      const mockDriver: PeripheralDriver = {};

      registry.registerType({
        type: 'generic-led',
        name: 'LED',
        description: 'Light Emitting Diode',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [
          { name: 'Anode', label: '阳极', direction: PinDirection.SINK, required: true },
          { name: 'Cathode', label: '阴极', direction: PinDirection.GROUND, required: true },
        ],
        propertySchema: [
          { prop: 'color', label: '颜色', type: 'select', default: 'red', options: ['red', 'green', 'blue'] },
        ],
        driverFactory: () => mockDriver,
      });

      expect(registry.hasType('generic-led')).toBe(true);
      expect(registry.getType('generic-led')?.name).toBe('LED');
      expect(registry.getRegisteredTypes()).toHaveLength(1);
    });

    test('unregisterType removes a peripheral type', () => {
      registry.registerType({
        type: 'test-device',
        name: 'Test Device',
        description: 'Test',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [],
        propertySchema: [],
        driverFactory: () => ({}),
      });

      expect(registry.hasType('test-device')).toBe(true);
      registry.unregisterType('test-device');
      expect(registry.hasType('test-device')).toBe(false);
    });

    test('registerType overwrites existing type with warning', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      registry.registerType({
        type: 'duplicate-type',
        name: 'First',
        description: 'First',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [],
        propertySchema: [],
        driverFactory: () => ({}),
      });

      registry.registerType({
        type: 'duplicate-type',
        name: 'Second',
        description: 'Second',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [],
        propertySchema: [],
        driverFactory: () => ({}),
      });

      expect(registry.getType('duplicate-type')?.name).toBe('Second');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Instance Management', () => {
    beforeEach(() => {
      registry.registerType({
        type: 'generic-led',
        name: 'LED',
        description: 'LED',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [
          { name: 'Anode', label: '阳极', direction: PinDirection.SINK, required: true },
        ],
        propertySchema: [
          { prop: 'brightness', label: '亮度', type: 'slider', default: 100, min: 0, max: 100 },
        ],
        driverFactory: () => ({}),
      });
    });

    test('createInstance creates a new peripheral instance', () => {
      const instance = registry.createInstance('generic-led', {
        id: 'led-1',
        name: 'Status LED',
        pins: [{ peripheralPin: 'Anode', mcuPin: 13, direction: PinDirection.SINK }],
      });

      expect(instance.id).toBe('led-1');
      expect(instance.name).toBe('Status LED');
      expect(instance.type).toBe('generic-led');
      expect(instance.pins).toHaveLength(1);
      expect(instance.properties.brightness).toBe(100); // Default value
      expect(registry.getInstance('led-1')).toBe(instance);
      expect(registry.getAllInstances()).toHaveLength(1);
    });

    test('createInstance auto-generates ID if not provided', () => {
      const instance1 = registry.createInstance('generic-led');
      const instance2 = registry.createInstance('generic-led');

      expect(instance1.id).toBeDefined();
      expect(instance2.id).toBeDefined();
      expect(instance1.id).not.toBe(instance2.id);
    });

    test('createInstance throws for unregistered type', () => {
      expect(() => {
        registry.createInstance('unregistered-type');
      }).toThrow('not registered');
    });

    test('createInstance throws for duplicate ID', () => {
      registry.createInstance('generic-led', { id: 'duplicate-id' });

      expect(() => {
        registry.createInstance('generic-led', { id: 'duplicate-id' });
      }).toThrow('already exists');
    });

    test('destroyInstance removes an instance and frees pins', () => {
      registry.createInstance('generic-led', {
        id: 'led-1',
        pins: [{ peripheralPin: 'Anode', mcuPin: 13, direction: PinDirection.SINK }],
      });

      expect(registry.isPinUsed(13)).toBe(true);
      registry.destroyInstance('led-1');
      expect(registry.getInstance('led-1')).toBeUndefined();
      expect(registry.isPinUsed(13)).toBe(false);
    });
  });

  describe('Power Management', () => {
    let mockDriver: PeripheralDriver;

    beforeEach(() => {
      mockDriver = {
        onPowerOn: jest.fn(),
        onPowerOff: jest.fn(),
        attachEvents: jest.fn(() => () => {}),
      };

      registry.registerType({
        type: 'test-device',
        name: 'Test Device',
        description: 'Test',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [],
        propertySchema: [],
        driverFactory: () => mockDriver,
      });
    });

    test('powerOnInstance calls driver hooks and attachEvents', async () => {
      registry.createInstance('test-device', { id: 'test-1' });

      await registry.powerOnInstance('test-1');

      const instance = registry.getInstance('test-1');
      expect(instance?.isPowered).toBe(true);
      expect(mockDriver.onPowerOn).toHaveBeenCalled();
      expect(mockDriver.attachEvents).toHaveBeenCalled();
    });

    test('powerOffInstance calls cleanup and onPowerOff', async () => {
      const cleanupFn = jest.fn();
      (mockDriver.attachEvents as jest.Mock).mockReturnValue(cleanupFn);

      registry.createInstance('test-device', { id: 'test-1' });
      await registry.powerOnInstance('test-1');
      registry.powerOffInstance('test-1');

      const instance = registry.getInstance('test-1');
      expect(instance?.isPowered).toBe(false);
      expect(cleanupFn).toHaveBeenCalled();
      expect(mockDriver.onPowerOff).toHaveBeenCalled();
    });

    test('powerOnAll powers on all instances', async () => {
      registry.createInstance('test-device', { id: 'test-1' });
      registry.createInstance('test-device', { id: 'test-2' });

      await registry.powerOnAll();

      expect(registry.getInstance('test-1')?.isPowered).toBe(true);
      expect(registry.getInstance('test-2')?.isPowered).toBe(true);
    });

    test('powerOffAll powers off all instances', async () => {
      registry.createInstance('test-device', { id: 'test-1' });
      registry.createInstance('test-device', { id: 'test-2' });

      await registry.powerOnAll();
      registry.powerOffAll();

      expect(registry.getInstance('test-1')?.isPowered).toBe(false);
      expect(registry.getInstance('test-2')?.isPowered).toBe(false);
    });

    test('powerOnInstance simulates power-up delay', async () => {
      jest.useFakeTimers();

      registry.registerType({
        type: 'slow-device',
        name: 'Slow Device',
        description: 'Slow',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 10000, // 10ms
        pinDefinitions: [],
        propertySchema: [],
        driverFactory: () => ({ onPowerOn: jest.fn() }),
      });

      registry.createInstance('slow-device', { id: 'slow-1' });

      const promise = registry.powerOnInstance('slow-1');
      expect(registry.getInstance('slow-1')?.isPowered).toBe(false);

      jest.runAllTimers();
      await promise;

      expect(registry.getInstance('slow-1')?.isPowered).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('Property Management', () => {
    let mockDriver: PeripheralDriver;

    beforeEach(() => {
      mockDriver = {
        onPropertyChange: jest.fn(),
      };

      registry.registerType({
        type: 'test-device',
        name: 'Test Device',
        description: 'Test',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [],
        propertySchema: [
          { prop: 'value', label: 'Value', type: 'number', default: 0 },
        ],
        driverFactory: () => mockDriver,
      });
    });

    test('setInstanceProperty updates property and calls hook', () => {
      registry.createInstance('test-device', { id: 'test-1' });

      registry.setInstanceProperty('test-1', 'value', 42);

      expect(registry.getInstance('test-1')?.properties.value).toBe(42);
      expect(mockDriver.onPropertyChange).toHaveBeenCalledWith('value', 0, 42);
    });

    test('setInstanceProperty does nothing if value unchanged', () => {
      registry.createInstance('test-device', { id: 'test-1', properties: { value: 42 } });

      registry.setInstanceProperty('test-1', 'value', 42);

      expect(mockDriver.onPropertyChange).not.toHaveBeenCalled();
    });
  });

  describe('Pin Management', () => {
    beforeEach(() => {
      registry.registerType({
        type: 'generic-led',
        name: 'LED',
        description: 'LED',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [],
        propertySchema: [],
        driverFactory: () => ({}),
      });
    });

    test('isPinUsed returns true for used pins', () => {
      registry.createInstance('generic-led', {
        id: 'led-1',
        pins: [{ peripheralPin: 'Anode', mcuPin: 13, direction: PinDirection.SINK }],
      });

      expect(registry.isPinUsed(13)).toBe(true);
      expect(registry.isPinUsed(14)).toBe(false);
    });

    test('getInstancesUsingPin returns all instances on a pin', () => {
      registry.createInstance('generic-led', {
        id: 'led-1',
        pins: [{ peripheralPin: 'Anode', mcuPin: 5, direction: PinDirection.SINK }],
      });

      registry.createInstance('generic-led', {
        id: 'led-2',
        pins: [{ peripheralPin: 'Anode', mcuPin: 5, direction: PinDirection.SINK }],
      });

      const users = registry.getInstancesUsingPin(5);
      expect(users).toHaveLength(2);
      expect(users).toContain('led-1');
      expect(users).toContain('led-2');
    });

    test('setPinMapping updates pin usage', () => {
      registry.createInstance('generic-led', { id: 'led-1' });

      registry.setPinMapping('led-1', {
        peripheralPin: 'Anode',
        mcuPin: 7,
        direction: PinDirection.SINK,
      });

      expect(registry.isPinUsed(7)).toBe(true);
      expect(registry.getInstancesUsingPin(7)).toContain('led-1');
    });
  });

  describe('Event System', () => {
    beforeEach(() => {
      registry.registerType({
        type: 'test-device',
        name: 'Test Device',
        description: 'Test',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [],
        propertySchema: [],
        driverFactory: () => ({}),
      });
    });

    test('addEventListener receives events', () => {
      const eventHandler = jest.fn();
      registry.addEventListener(eventHandler);

      registry.createInstance('test-device', { id: 'test-1' });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'peripheral-added',
          instanceId: 'test-1',
        })
      );
    });

    test('removeEventListener stops receiving events', () => {
      const eventHandler = jest.fn();
      const unsubscribe = registry.addEventListener(eventHandler);

      unsubscribe();
      registry.createInstance('test-device', { id: 'test-1' });

      expect(eventHandler).not.toHaveBeenCalled();
    });

    test('power events are emitted correctly', async () => {
      const eventHandler = jest.fn();
      registry.addEventListener(eventHandler);

      registry.createInstance('test-device', { id: 'test-1' });
      await registry.powerOnInstance('test-1');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'peripheral-powered-on',
          instanceId: 'test-1',
        })
      );

      registry.powerOffInstance('test-1');
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'peripheral-powered-off',
          instanceId: 'test-1',
        })
      );
    });

    test('type registration events are emitted correctly', () => {
      const eventHandler = jest.fn();
      registry.addEventListener(eventHandler);

      registry.registerType({
        type: 'event-test-device',
        name: 'Event Test Device',
        description: 'Test',
        category: 'output',
        defaultPowerDomain: PowerDomain.VCC_3V3,
        defaultPowerUpDelayUs: 0,
        pinDefinitions: [],
        propertySchema: [],
        driverFactory: () => ({}),
      });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'type-registered',
          peripheralType: 'event-test-device',
        })
      );

      registry.unregisterType('event-test-device');
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'type-unregistered',
          peripheralType: 'event-test-device',
        })
      );
    });
  });

  describe('getPinArbiter and getPinManagerAdapter', () => {
    test('getPinArbiter returns the underlying pin arbiter', () => {
      expect(registry.getPinArbiter()).toBe(pinArbiter);
    });

    test('getPinManagerAdapter returns the adapter instance', () => {
      expect(registry.getPinManagerAdapter()).toBeInstanceOf(PinManagerAdapter);
    });
  });
});
