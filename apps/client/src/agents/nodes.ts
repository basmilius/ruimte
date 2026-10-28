import i18next from 'i18next';
import type { DesignPlace, ProviderInfo } from '@ruimte/contracts';
import { readChatPreferences } from '@adecore/agents-react/chat';
import { canvasOfNode, nextId, type AddNodeOptions } from '@/state/canvas';
import { useDocument } from '@/state/document';

// The two kinds of node an agent CLI can live in; every menu offers a provider under one of them.
export type AgentTarget = 'chat' | 'terminal';

export function agentTargetLabel(target: AgentTarget): string {
    return i18next.t(`agents:target.${target}`);
}

/* Where an agent picks up: a CLI session handed on from another chat or terminal, the folder it works in and the account it ran under. */
export interface AgentSession {
    resume?: string;
    cwd?: string;
    account?: string;
}

/*
 * An agent node is titled with the catalog name. A terminal agent keeps the mode it
 * started in on the node, so a reload (which creates the session again) launches the same line.
 * A chat picked here is fixed to its CLI: the composer shows a badge instead of a model picker.
 */
export function agentNodeOptions(target: AgentTarget, provider: ProviderInfo, session: AgentSession = {}): AddNodeOptions {
    return {
        title: provider.name,
        provider: provider.kind,
        ...(session.resume === undefined ? {} : { resume: session.resume }),
        ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
        ...(session.account === undefined ? {} : { account: session.account }),
        // A resume goes on in the mode its session has: the daemon puts no mode on a line nobody chose one for.
        ...(target === 'terminal' ? (session.resume === undefined ? { runtimeMode: readChatPreferences().terminalRuntimeMode } : {}) : { providerFixed: true })
    };
}

/* The same agent as a view of its own: no canvas under it, the same session rules on the daemon. */
export function addAgentView(target: AgentTarget, provider: ProviderInfo, name = provider.name, session: AgentSession = {}): string | null {
    const { title: _title, ...node } = agentNodeOptions(target, provider, session);
    return useDocument.getState().addStandaloneView({ kind: target, name, node });
}

/* A further chat of a design, on the same folder, named after its CLI and its place among the design's chats. */
export function addDesignChat(design: DesignPlace, provider: ProviderInfo, chatCount: number, session: AgentSession = {}): string | null {
    const { title: _title, ...node } = agentNodeOptions('chat', provider, session);
    const id = nextId('chat');
    const chat = { id, name: `${provider.name} ${chatCount + 1}`, node };

    if (design.canvasId === null) {
        return useDocument.getState().addDesignChat(design.id, chat) ? id : null;
    }

    // On a canvas the node holds its chats, so its editor writes the new one, the way it writes any change of a node.
    // Not on the undo stack: an undo would take a running chat off its node.
    const canvas = canvasOfNode(design.id);
    const owner = canvas?.getState().nodes[design.id];
    if (canvas === null || owner === undefined) {
        return null;
    }
    canvas.getState().updateNode(design.id, { chats: [...(owner.chats ?? []), chat] }, false);
    return id;
}

/* A design: its chat is an agent chat like any other, working on the folder at `path`, relative to the project folder. */
export function addDesignView(provider: ProviderInfo, name: string, path: string, session: AgentSession = {}): string | null {
    const { title: _title, ...node } = agentNodeOptions('chat', provider, session);

    return useDocument.getState().addStandaloneView({ kind: 'design', name, node, path });
}
