import { artifactActions } from '../actions/artifact-actions.ts';
import type { Artifacts } from '../artifacts/artifacts.ts';
import { artifactToolkit } from '../tools/artifact-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The Output of the caller's project, where results that should stay are kept; absent on a host that keeps none. */
        artifacts?: Pick<Artifacts, 'publish' | 'list' | 'read'>;
    }
}

export const artifactFeature = defineAgentFeature({
    name: 'artifact',
    toolkit: artifactToolkit,
    actions: artifactActions,
    host: ({ artifacts }) => ({ artifacts: artifacts.artifacts })
});
