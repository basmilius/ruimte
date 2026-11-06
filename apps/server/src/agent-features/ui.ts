import { uiToolkit } from '../tools/ui-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const uiFeature = defineAgentFeature({ name: 'ui', toolkit: uiToolkit });
