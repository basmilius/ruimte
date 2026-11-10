import { alertToolkit } from '../tools/alert-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const alertFeature = defineAgentFeature({ name: 'alert', toolkit: alertToolkit });
