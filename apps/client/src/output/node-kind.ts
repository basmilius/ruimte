import { isArtifactView } from '@ruimte/contracts';
import { ArtifactBody, ArtifactViewKindBody } from '@/output/ArtifactKindBody';
import type { NodeKindDefinition } from '@/registry/node-kinds';
import { viewKind } from '@/registry/view-kinds';

export const ARTIFACT_NODE_KIND: NodeKindDefinition = { id: 'artifact', body: ArtifactBody, controls: 'buttons' };

export const ARTIFACT_VIEW_KIND = viewKind({ id: 'artifact', owns: isArtifactView, body: ArtifactViewKindBody });
