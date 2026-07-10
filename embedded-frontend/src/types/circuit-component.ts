export interface CircuitComponentInstance {
  id: string;
  type: string;
  name: string;
  pinConnections: Record<string, import('./peripheral-pins').PinConnectionValue>;
  props: Record<string, any>;
  rotation: number;
}
