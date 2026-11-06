import { isDesignView } from '@ruimte/contracts';
import { NodeChatPills } from '@/nodes/NodeChatPills';
import { DesignBody, DesignViewKindBody } from '@/design/DesignKindBody';
import type { NodeKindDefinition } from '@/registry/node-kinds';
import { viewKind } from '@/registry/view-kinds';

export const DESIGN_NODE_KIND: NodeKindDefinition = {
    id: 'design',
    body: DesignBody,
    controls: 'row',
    afterTitle: NodeChatPills,
    bodyClass: '[--text-sm--line-height:22px]'
};

export const DESIGN_VIEW_KIND = viewKind({ id: 'design', owns: isDesignView, body: DesignViewKindBody });
