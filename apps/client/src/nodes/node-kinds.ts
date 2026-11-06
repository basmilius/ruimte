import { NodeChatPills } from '@/chat/NodeChatPills';
import { BrowserNodeBody, ChatNodeBody, TerminalAfterTitle, TerminalContextPill, TerminalNodeBody } from '@/nodes/NodeKindBodies';
import type { NodeKindDefinition } from '@/registry/node-kinds';

export const NODE_BODY_KINDS: readonly NodeKindDefinition[] = [
    { id: 'terminal', body: TerminalNodeBody, afterTitle: TerminalAfterTitle, beforeStatus: TerminalContextPill },
    // A thread reads at the node's own 14px, over the 22px a chat gives its prose.
    { id: 'chat', body: ChatNodeBody, afterTitle: NodeChatPills, bodyClass: '[--text-sm--line-height:22px]' },
    { id: 'browser', body: BrowserNodeBody }
];
