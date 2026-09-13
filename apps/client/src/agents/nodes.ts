import type { ProviderInfo } from '@ruimte/contracts';
import type { Point } from '@/canvas/math';
import { readChatPreferences } from '@/chat/preferences';
import { focusedCanvas } from '@/state/canvas';
import { canAddView } from '@/project/views';
import { useDocument } from '@/state/document';

// The two kinds of node an agent CLI can live in; every menu offers a provider under one of them.
export type AgentTarget = 'chat' | 'terminal';

export const AGENT_TARGET_LABEL: Record<AgentTarget, string> = {
    chat: 'Agent (Chat)',
    terminal: 'Agent (Terminal)'
};

/*
 * One agent node at a point, titled with the catalog name. A terminal agent keeps the mode it
 * started in on the node, so a reload (which creates the session again) launches the same line.
 * A chat picked here is fixed to its CLI: the composer shows a badge instead of a model picker.
 */
export const addAgentNode = (target: AgentTarget, provider: ProviderInfo, at: Point): string | null => {
    const runtimeMode = readChatPreferences().terminalRuntimeMode;
    return focusedCanvas()
        .getState()
        .addNode(target, at, {
            title: provider.name,
            provider: provider.kind,
            ...(target === 'terminal' ? { runtimeMode } : { providerFixed: true })
        });
};

/* The same agent as a view of its own: no canvas under it, the same session rules on the daemon. */
export const addAgentView = (target: AgentTarget, provider: ProviderInfo): string | null => {
    const runtimeMode = readChatPreferences().terminalRuntimeMode;
    if (!canAddView()) {
        return null;
    }
    return useDocument.getState().addStandaloneView({
        kind: target,
        name: provider.name,
        node: { provider: provider.kind, ...(target === 'terminal' ? { runtimeMode } : { providerFixed: true }) }
    });
};
