import { configFromPreset } from '../lib/types';
import synthwaveAm from '../presets/synthwave-am';

const defaultConfig = configFromPreset(synthwaveAm);

export { synthwaveAm as defaultPreset };
export default defaultConfig;
