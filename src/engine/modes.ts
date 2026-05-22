import type { CellInterpreter, EngineConfig } from '../lib/types';
import { createLiteralInterpreter } from './interpreters';
import defaultConfig from './defaultConfig';

export interface Mode {
  id: string;
  label: string;
  config: EngineConfig;
  createInterpreter: (config: EngineConfig) => CellInterpreter;
}

export const drumMode: Mode = {
  id: 'drums',
  label: 'Drums',
  config: defaultConfig,
  createInterpreter: createLiteralInterpreter,
};

/** All available modes, in display order */
export const modes: Mode[] = [drumMode];

export function getModeById(id: string): Mode | undefined {
  return modes.find((m) => m.id === id);
}
