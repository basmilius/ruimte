import { ArtifactBody } from '@/output/ArtifactKindBody';
import type { NodeKindDefinition } from '@/registry/node-kinds';

export const ARTIFACT_NODE_KIND: NodeKindDefinition = { id: 'artifact', body: ArtifactBody, controls: 'buttons' };
