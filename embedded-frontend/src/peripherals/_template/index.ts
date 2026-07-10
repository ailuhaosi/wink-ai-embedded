/**
 * Template package entry — DO NOT side-effect register.
 *
 * Copy this folder to create a new peripheral, then:
 * 1. Rename exports (templateDefinition → myPeripheralDefinition)
 * 2. Uncomment registry.register() below (or call registerExample() from app bootstrap)
 * 3. Add `import './my-peripheral'` to peripherals/index.ts
 */
import { registry } from '../registry';
import { templateDefinition } from './definition';

export { templateDefinition } from './definition';

/** Call explicitly when bootstrapping a new peripheral (not used by production barrel). */
export function registerExample(): void {
  registry.register(templateDefinition);
}

// registry.register(templateDefinition);
