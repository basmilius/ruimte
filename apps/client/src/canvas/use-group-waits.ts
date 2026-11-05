import { useChats, type ChatStatuses } from '@adecore/agents-react/state';
import { waitingOnMap } from '@/canvas/minimap-geometry';
import { groupAttention } from '@/state/attention';
import { useCanvas, type CanvasNode } from '@/state/canvas';
import { useEndpointId } from '@/state/current-endpoint';
import { useSessions, type SessionsByKey } from '@/state/sessions';
import { useSnoozes, type Snoozes } from '@/state/snooze';

// The snoozed nodes stay out of the dots the way they stay out of every count; nothing is unseen here.
const NO_UNSEEN: Readonly<Record<string, true>> = {};

/* The nodes that carry a dot for what waits on a person, a member of a collapsed group as the group it is shown as. */
export function waitingShown(
    nodes: Readonly<Record<string, CanvasNode>>,
    hidden: ReadonlySet<string>,
    sessions: SessionsByKey,
    chats: ChatStatuses,
    endpointId: string,
    snoozes: Snoozes
): CanvasNode[] {
    return waitingOnMap(nodes, hidden, groupAttention(Object.values(nodes), sessions, chats, endpointId, NO_UNSEEN, snoozes).needsYou);
}

/*
 * Whether a node this collapsed group hides waits on a person, the same dot the map puts on it. Null
 * reads nothing, so a group that is open, or any other node, is not redrawn by a status change.
 */
export function useHiddenNeedsYou(groupId: string | null): boolean {
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => (groupId === null ? null : s.byKey));
    const chats = useChats((s) => (groupId === null ? null : s.statusByKey));
    const snoozes = useSnoozes((s) => (groupId === null ? null : s.byKey));
    return useCanvas((s) => {
        if (groupId === null || sessions === null || chats === null || snoozes === null) {
            return false;
        }
        return waitingShown(s.nodes, s.hidden, sessions, chats, endpointId, snoozes).some((node) => node.id === groupId);
    });
}
