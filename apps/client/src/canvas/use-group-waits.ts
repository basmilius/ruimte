import { useChats } from '@adecore/agents-react/state';
import { waitingOnMap } from '@/canvas/minimap-geometry';
import { groupAttention } from '@/state/attention';
import { useCanvas } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';

const NO_UNSEEN: Readonly<Record<string, true>> = {};

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
        const waiting = groupAttention(Object.values(s.nodes), sessions, chats, endpointId, NO_UNSEEN, snoozes).needsYou;
        return waitingOnMap(s.nodes, s.hidden, waiting).some((node) => node.id === groupId);
    });
}
