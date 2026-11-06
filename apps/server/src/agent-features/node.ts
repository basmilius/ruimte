import { nodeActions, nodePreviews } from '../actions/node-actions.ts';
import { nodeToolkit } from '../tools/node-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const nodeFeature = defineAgentFeature({ name: 'node', toolkit: nodeToolkit, actions: nodeActions, previews: nodePreviews });
