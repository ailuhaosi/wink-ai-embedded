import { defineStore } from 'pinia';

/** W1 shell — W2 will connect Manifest v2 */
interface ProjectState {
  projectName: string;
  targetBoard: string;
  safetyLevel: string;
  mechanicalParts: unknown[];
}

export const useProjectStore = defineStore('project', {
  state: (): ProjectState => ({
    projectName: 'Untitled Project',
    targetBoard: 'ESP32-S3',
    safetyLevel: 'S2',
    mechanicalParts: [],
  }),
});
