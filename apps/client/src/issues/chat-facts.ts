import { useChatRow } from '@adecore/agents-react/state';
import type { HostChange, HostLink } from '@ruimte/contracts';
import { useEffect } from 'react';
import { useChatChange, useChatLinks, useHostProviders } from '@/issues/state';
import { readChatChange } from '@/issues/watch';
import { chatWorking } from '@/state/agent-work';
import { useEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';
import { fireAndForget } from '@/transport-api/transport';

export interface ChatHostFacts {
    links: readonly HostLink[];
    change: HostChange | null;
}

/* For a toolbar that is only there when something is in it. */
export function hasHostFacts(facts: ChatHostFacts): boolean {
    return facts.links.length > 0 || facts.change !== null;
}

/* The issues a chat works on and the change of its branch. Empty on a machine that knows no hosts and in a project none of them answers for. */
export function useChatHostFacts(chatId: string): ChatHostFacts {
    const links = useChatLinks(chatId);
    const change = useChatChange(chatId);

    return { links, change: change ?? null };
}

/*
 * Asks the machine for the change of a chat's branch, from the one place per chat that is there whether or not
 * anything shows yet: its node's header, or the bar of its view.
 */
export function useChatChangeRead(chatId: string): void {
    const endpointId = useEndpointId();
    const projectId = useProject((state) => state.current?.projectId ?? null);
    const folder = useProject((state) => state.current?.folder ?? null);
    const readsChanges = useHostProviders().some((provider) => provider.changes && provider.state === 'ready');
    const linked = useChatLinks(chatId).length > 0;
    const cwd = useChatRow(chatId, (row) => row?.info.cwd);
    const working = useChatRow(chatId, (row) => chatWorking(row));
    // Chats in the project folder share its branch, so only one that is on an issue or in a folder of its own is asked about.
    const asks = readsChanges && (linked || (cwd !== undefined && cwd !== folder));

    // Asked again when a turn ends, which is when the agent may have pushed or opened the change.
    useEffect(() => {
        if (asks && !working && projectId !== null) {
            void fireAndForget('host.change', readChatChange(endpointId, projectId, chatId));
        }
    }, [asks, working, endpointId, projectId, chatId]);
}
