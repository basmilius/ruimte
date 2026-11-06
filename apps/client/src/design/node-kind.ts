import { NodeChatPills } from '@/chat/NodeChatPills';
import { DesignBody } from '@/design/DesignKindBody';
import type { NodeKindDefinition } from '@/registry/node-kinds';

export const DESIGN_NODE_KIND: NodeKindDefinition = {
    id: 'design',
    body: DesignBody,
    controls: 'row',
    afterTitle: NodeChatPills,
    bodyClass: '[--text-sm--line-height:22px]'
};
