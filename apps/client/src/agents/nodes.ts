import i18next from 'i18next';
import type { ProviderInfo } from '@ruimte/contracts';
import { readChatPreferences } from '@/chat/preferences';
import type { AddNodeOptions } from '@/state/canvas';
import { useDocument } from '@/state/document';

// The two kinds of node an agent CLI can live in; every menu offers a provider under one of them.
export type AgentTarget = 'chat' | 'terminal';

export const agentTargetLabel = (target: AgentTarget): string => i18next.t(`agents:target.${target}`);

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
export const agentNodeOptions = (target: AgentTarget, provider: ProviderInfo, session: AgentSession = {}): AddNodeOptions => ({
    title: provider.name,
    provider: provider.kind,
    ...(session.resume === undefined ? {} : { resume: session.resume }),
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    ...(session.account === undefined ? {} : { account: session.account }),
    // A resume goes on in the mode its session has: the daemon puts no mode on a line nobody chose one for.
    ...(target === 'terminal' ? (session.resume === undefined ? { runtimeMode: readChatPreferences().terminalRuntimeMode } : {}) : { providerFixed: true })
});

/* The same agent as a view of its own: no canvas under it, the same session rules on the daemon. */
export const addAgentView = (target: AgentTarget, provider: ProviderInfo, name = provider.name, session: AgentSession = {}): string | null => {
    const { title: _title, ...node } = agentNodeOptions(target, provider, session);
    return useDocument.getState().addStandaloneView({ kind: target, name, node });
};
