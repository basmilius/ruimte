import { artifactActions } from '../actions/artifact-actions.ts';
import { artifactToolkit } from '../tools/artifact-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const artifactFeature = defineAgentFeature({
    name: 'artifact',
    toolkit: artifactToolkit,
    actions: artifactActions,
    host: ({ artifacts }) => ({ artifacts: artifacts.artifacts })
});
