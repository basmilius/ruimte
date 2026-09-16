import type { ChatTurnItem } from '@ruimte/contracts';
import { agentTurnLabel, turnLabel } from '@/chat/logic/timeline';
import { projectNodes, revealNode } from '@/project/views';
import { approvalNotices, nextExpiry, noticeChanges, type ApprovalNotice } from '@/shell/approval-notices';
import { useChats, type ChatsById } from '@/state/chats';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { nodeStatus, useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';

/* Nothing is announced to somebody who is already looking: the node itself says it there. */
const canNotify = (): boolean => !document.hasFocus() && 'Notification' in window && Notification.permission === 'granted';

/* Clicking any of these brings the window up and goes to the node, in whichever view it lives. */
const notify = (nodeId: string, title: string, body: string, tag: string, silent: boolean): Notification => {
    const notification = new Notification(title, { body, tag, silent });
    notification.onclick = () => {
        window.focus();
        revealNode(nodeId);
        notification.close();
    };
    return notification;
};

/* The newest turn of a chat, once it has settled; null while one is running and for a thread with none. */
const settledTurn = (chat: ChatsById[string] | undefined): ChatTurnItem | null => {
    if (chat === undefined) {
        return null;
    }
    for (let i = chat.order.length - 1; i >= 0; i--) {
        const item = chat.items[chat.order[i]!];
        if (item?.kind === 'turn') {
            return item.state === 'running' ? null : item;
        }
    }
    return null;
};

/* What a turn that ended did, as far as anything outside the thread can say. */
const turnBody = (nodeId: string): string => {
    const turn = settledTurn(useChats.getState().byKey[endpointKey(currentEndpointId(), nodeId)]);
    if (turn === null) {
        return 'Finished';
    }
    const chat = useChats.getState().byKey[endpointKey(currentEndpointId(), nodeId)];
    const items = chat ? chat.order.flatMap((id) => (chat.items[id]?.turnId === turn.id ? [chat.items[id]!] : [])) : [];
    return turn.origin === 'agent' ? agentTurnLabel(turn) : turnLabel(turn, items);
};

/*
 * A turn that ended while this window was not the one in front. `state/attention.ts` decides when a
 * turn ended and calls this, so what is announced, what is marked and what is counted are the same
 * event. Silent unless somebody asked for the sound: a notification arrives while a person is doing
 * something else, and that is the moment to be quiet about it.
 */
export const notifyTurnDone = (nodeId: string, title: string): void => {
    const { agentsTurnNotify, agentsTurnSound } = useSettings.getState();
    if (!agentsTurnNotify || !canNotify()) {
        return;
    }
    notify(nodeId, title, turnBody(nodeId), `ruimte-turn-${nodeId}`, !agentsTurnSound);
};

/* The name of the machine a notification is about, and nothing at all for the one it arrives on. */
const machineName = (endpointId: string): string | null => {
    if (endpointId === LOCAL_ENDPOINT_ID) {
        return null;
    }
    return useEndpoints.getState().endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? null;
};

/*
 * One OS notification per node that turns to needs-you while the window is not focused, taken back
 * the moment the node stops waiting. A question has no setting of its own: it is the agent standing
 * still until somebody answers, which is worth a notification whatever else is switched off.
 *
 * A permission a terminal agent asks for is the same watcher's work, because it is the same node
 * standing still: it rides `agentsApprovals` rather than the turn switch, since a person who put
 * the strip in the header asked to answer permissions away from the terminal, and this is the only
 * thing that reaches them before the hold runs out. It speaks for the node while it stands, so the
 * plain "Needs you" is not raised beside it and one that got there first is taken back.
 */
export const startAgentNotifications = (): (() => void) => {
    const shown = new Map<string, Notification>();
    const approvals = new Map<string, Notification>();
    let previous = new Map<string, string | undefined>();
    let expiry: ReturnType<typeof setTimeout> | null = null;

    const askOnce = (): void => {
        if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission();
        }
    };
    // Browsers only grant permission from a gesture; the first click anywhere is that gesture.
    window.addEventListener('pointerdown', askOnce, { once: true });

    /* Nothing moves in any store when a hold runs out, so the clock is what withdraws on time. */
    const scheduleExpiry = (at: number | null): void => {
        if (expiry !== null) {
            clearTimeout(expiry);
            expiry = null;
        }
        if (at !== null) {
            expiry = setTimeout(check, Math.max(at - Date.now(), 0) + 50);
        }
    };

    const applyApprovals = (notices: readonly ApprovalNotice[], silent: boolean): void => {
        const changes = noticeChanges(approvals.keys(), notices, canNotify());
        for (const key of changes.withdraw) {
            approvals.get(key)?.close();
            approvals.delete(key);
        }
        for (const notice of changes.raise) {
            // The tag of the node's own notification: a permission replaces "Needs you" rather than
            // stacking a second card that says less about the same wait.
            approvals.set(notice.key, notify(notice.nodeId, notice.title, notice.body, `ruimte-${notice.nodeId}`, silent));
        }
        scheduleExpiry(nextExpiry(notices));
    };

    const check = (): void => {
        const nodes = projectNodes();
        const endpointId = currentEndpointId();
        const sessions = useSessions.getState().byKey;
        const chats = useChats.getState().byKey;
        const { agentsApprovals, agentsTurnSound } = useSettings.getState();
        const notices = approvalNotices(nodes, sessions, endpointId, {
            machine: machineName(endpointId),
            offered: agentsApprovals,
            now: Date.now()
        });
        const asking = new Set(notices.map((notice) => notice.nodeId));
        const current = new Map<string, string | undefined>();
        for (const node of nodes) {
            const status = nodeStatus(node, sessions, chats, endpointId);
            current.set(node.id, status);
            // A node with a permission open is waiting too, but the card for that request says more.
            if (status !== 'needs-you' || asking.has(node.id)) {
                shown.get(node.id)?.close();
                shown.delete(node.id);
                continue;
            }
            if (previous.get(node.id) === 'needs-you' || !canNotify()) {
                continue;
            }
            shown.set(node.id, notify(node.id, node.title, 'Needs you', `ruimte-${node.id}`, !agentsTurnSound));
        }
        previous = current;
        // After the loop above, so the permission lands on a tag the plain wait has just let go of.
        applyApprovals(notices, !agentsTurnSound);
    };

    const offSessions = useSessions.subscribe(check);
    const offChats = useChats.subscribe(check);
    const offSettings = useSettings.subscribe(check);
    return () => {
        window.removeEventListener('pointerdown', askOnce);
        offSessions();
        offChats();
        offSettings();
        scheduleExpiry(null);
        for (const notification of approvals.values()) {
            notification.close();
        }
        approvals.clear();
    };
};
