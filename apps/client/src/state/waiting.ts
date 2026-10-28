import { create } from 'zustand';
import { useChats, type ChatStatuses } from '@adecore/agents-react/state';
import { projectNodes } from '@/project/view-nodes';
import { groupAttention, useAttention } from '@/state/attention';
import { currentEndpointId, endpointKey, endpointOfNode } from '@/state/keys';
import { sessionStatus, useSessions, type SessionsByKey, type StatusOf } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';

/*
 * When each waiting terminal was first seen waiting, by session key. Its agent moves `updatedAt`
 * forward on every later hook of the same prompt, so only the first sighting dates the wait.
 */
export function nextWaitingSince(sessions: SessionsByKey, before: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
    const next = new Map<string, number>();
    for (const [key, session] of Object.entries(sessions)) {
        if (sessionStatus(session) === 'needs-you') {
            next.set(key, before.get(key) ?? session.agent?.updatedAt ?? 0);
        }
    }
    const same = next.size === before.size && [...next].every(([key, at]) => before.get(key) === at);
    return same ? before : next;
}

interface WaitingSinceStore {
    byKey: ReadonlyMap<string, number>;
}

export const useWaitingSince = create<WaitingSinceStore>(() => ({ byKey: new Map() }));

/* Before any canvas mounts, so a stack that reads the dates on a session change reads them already moved. */
export function startWaitingSinceWatch(): () => void {
    const pass = (): void => {
        const before = useWaitingSince.getState().byKey;
        const next = nextWaitingSince(useSessions.getState().byKey, before);
        if (next !== before) {
            useWaitingSince.setState({ byKey: next });
        }
    };
    pass();
    return useSessions.subscribe(pass);
}

export interface Waiting {
    id: string;
    /* On the machine's clock; `Infinity` when nothing dates the wait. */
    since: number;
}

function earliest(times: readonly number[]): number {
    return times.length === 0 ? Infinity : Math.min(...times);
}

/* When a node started waiting on a person: its oldest open request, else when a terminal was first seen waiting. */
function waitedSince(node: StatusOf, sessions: SessionsByKey, chats: ChatStatuses, since: ReadonlyMap<string, number>, endpointId: string): number {
    const key = endpointKey(endpointOfNode(node, endpointId), node.id);
    if (node.kind === 'chat' || node.kind === 'design') {
        return earliest((chats[key]?.info.requests ?? []).map((request) => request.createdAt));
    }
    if (node.kind !== 'terminal') {
        return Infinity;
    }
    const agent = sessions[key]?.agent;
    const requests = agent?.requests ?? [];
    return requests.length > 0 ? earliest(requests.map((request) => request.createdAt)) : (since.get(key) ?? agent?.updatedAt ?? Infinity);
}

/* The nodes that wait on a person, the one that waited longest first; a wait nothing dates comes last, in project order. */
export function oldestWaitingFirst(
    waiting: readonly StatusOf[],
    sessions: SessionsByKey,
    chats: ChatStatuses,
    since: ReadonlyMap<string, number>,
    endpointId: string
): Waiting[] {
    // Not a subtraction: two waits nothing dates are both `Infinity`, and the sort keeps them in project order.
    return waiting
        .map((node) => ({ id: node.id, since: waitedSince(node, sessions, chats, since, endpointId) }))
        .sort((a, b) => (a.since === b.since ? 0 : a.since < b.since ? -1 : 1));
}

/* What waits on a person in the open project now, oldest first. A snoozed node waits too, but was put aside, so it is left out as every count leaves it out. */
export function projectWaiting(): Waiting[] {
    const nodes = projectNodes();
    const endpointId = currentEndpointId();
    const sessions = useSessions.getState().byKey;
    const chats = useChats.getState().statusByKey;
    const { needsYou } = groupAttention(nodes, sessions, chats, endpointId, useAttention.getState().unseen, useSnoozes.getState().byKey);
    const ids = new Set(needsYou);
    return oldestWaitingFirst(
        nodes.filter((node) => ids.has(node.id)),
        sessions,
        chats,
        useWaitingSince.getState().byKey,
        endpointId
    );
}

/*
 * The wait after the one visited last, so pressing again walks on. Once that one is answered and left the
 * list, the walk goes on from where it stood rather than back to the start.
 */
export function nextWaiting(order: readonly Waiting[], last: Waiting | null): Waiting | null {
    if (order.length === 0) {
        return null;
    }
    if (last === null) {
        return order[0]!;
    }
    const at = order.findIndex((entry) => entry.id === last.id);
    if (at !== -1) {
        return order[(at + 1) % order.length]!;
    }
    return order.find((entry) => entry.since >= last.since) ?? order[0]!;
}
