import { NodeChatPills } from '@/nodes/NodeChatPills';
import {
    BrowserNodeBody,
    BrowserViewBody,
    ChatViewBody,
    TerminalViewBody,
    ChatNodeBody,
    TerminalAfterTitle,
    TerminalContextPill,
    TerminalNodeBody
} from '@/nodes/NodeKindBodies';
import type { NodeKindDefinition } from '@/registry/node-kinds';
import { viewKind, viewOfKind, type ViewKindDefinition } from '@/registry/view-kinds';

export const NODE_BODY_KINDS: readonly NodeKindDefinition[] = [
    { id: 'terminal', body: TerminalNodeBody, afterTitle: TerminalAfterTitle, beforeStatus: TerminalContextPill },
    // A thread reads at the node's own 14px, over the 22px a chat gives its prose.
    { id: 'chat', body: ChatNodeBody, afterTitle: NodeChatPills, bodyClass: '[--text-sm--line-height:22px]' },
    { id: 'browser', body: BrowserNodeBody }
];

export const NODE_VIEW_KINDS: readonly ViewKindDefinition[] = [
    viewKind({ id: 'chat', owns: viewOfKind('chat'), body: ChatViewBody }),
    viewKind({ id: 'terminal', owns: viewOfKind('terminal'), body: TerminalViewBody }),
    viewKind({ id: 'browser', owns: viewOfKind('browser'), body: BrowserViewBody })
];
