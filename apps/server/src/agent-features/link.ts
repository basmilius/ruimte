import { linkActions } from '../actions/link-actions.ts';
import { linkToolkit } from '../tools/link-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const linkFeature = defineAgentFeature({ name: 'link', toolkit: linkToolkit, actions: linkActions });
