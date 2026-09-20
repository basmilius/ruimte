import i18next from 'i18next';
import type { ChatTurnItem } from '@ruimte/contracts';
import { agentTurnLabel, turnLabel } from '@/chat/logic/timeline';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { projectNodes, revealNode } from '@/project/views';
import { approvalNotices, nextExpiry, noticeChanges, type ApprovalNotice } from '@/shell/approval-notices';
import { useChats, type ChatsById } from '@/state/chats';
import { seenNodeIds } from '@/state/in-sight';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { nodeStatus, useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';

/* Whether this window may raise anything at all. What a person is looking at is asked per node. */
const mayNotify = (): boolean => 'Notification' in window && Notification.permission === 'granted';

/*
 * Nothing is announced about a node somebody is already looking at: it says it there itself. A
 * window has held several views since the grid, so the question is about the node and not about the
 * window: a chat on a view behind the one you are reading is as unseen as one in a window behind it.
 */
const canNotify = (nodeId: string, seen: ReadonlySet<string>): boolean => mayNotify() && !seen.has(nodeId);

/* Clicking any of these brings the window up and goes to the node, in whichever view it lives. */
const notify = (nodeId: string, title: string, body: string, tag: string, silent: boolean): Notification => {
    const notification = new Notification(title, { body, tag, silent });
    notification.onclick = () => {
        window.focus();
        revealNode(nodeId);
        bringPromptToFront(nodeId);
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
        return i18next.t('shell:notifications.finished');
    }
    const chat = useChats.getState().byKey[endpointKey(currentEndpointId(), nodeId)];
    const items = chat ? chat.order.flatMap((id) => (chat.items[id]?.turnId === turn.id ? [chat.items[id]!] : [])) : [];
    return turn.origin === 'agent' ? agentTurnLabel(turn) : turnLabel(turn, items);
};

/*
 * A turn that ended while nobody was looking at the node it ended in. `state/attention.ts` decides
 * that and calls this, so what is announced, what is marked and what is counted are the same event.
 * Silent unless somebody asked for the sound: a notification arrives while a person is doing
 * something else, and that is the moment to be quiet about it.
 */
export const notifyTurnDone = (nodeId: string, title: string): void => {
    const { agentsTurnNotify, agentsTurnSound } = useSettings.getState();
    // The watcher only calls this for a turn nobody watched end, so the node is unseen by construction.
    if (!agentsTurnNotify || !mayNotify()) {
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
 * Notify once while a hidden node needs input, then withdraw when it resumes. A permission replaces
 * the generic notification because it carries the actionable question and expires.
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

    const applyApprovals = (notices: readonly ApprovalNotice[], silent: boolean, seen: ReadonlySet<string>): void => {
        const changes = noticeChanges(approvals.keys(), notices, (notice) => canNotify(notice.nodeId, seen));
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
        const seen = seenNodeIds();
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
            if (previous.get(node.id) === 'needs-you' || !canNotify(node.id, seen)) {
                continue;
            }
            shown.set(node.id, notify(node.id, node.title, i18next.t('shell:notifications.needsYou'), `ruimte-${node.id}`, !agentsTurnSound));
        }
        previous = current;
        // After the loop above, so the permission lands on a tag the plain wait has just let go of.
        applyApprovals(notices, !agentsTurnSound, seen);
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
