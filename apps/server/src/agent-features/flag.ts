import { flagActions } from '../actions/flag-actions.ts';
import { flagToolkit } from '../tools/flag-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const flagFeature = defineAgentFeature({ name: 'flag', toolkit: flagToolkit, actions: flagActions });
