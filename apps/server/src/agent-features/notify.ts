import { notifyToolkit } from '../tools/notify-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const notifyFeature = defineAgentFeature({ name: 'notify', toolkit: notifyToolkit });
