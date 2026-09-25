import i18next from 'i18next';
import type { ChatTurnItem } from '@ruimte/contracts';
import { agentTurnLabel, turnLabel } from '@/chat/logic/timeline';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { projectNodes, revealNode } from '@/project/views';
import { useChats, type ChatsById } from '@/state/chats';
import { seenNodeIds } from '@/state/in-sight';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { nodeStatus, useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { snoozeOf, useSnoozes } from '@/state/snooze';

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

/* Notify once while a hidden node needs input, then withdraw when it resumes. */
export const startAgentNotifications = (): (() => void) => {
    const shown = new Map<string, Notification>();
    let previous = new Map<string, string | undefined>();

    const askOnce = (): void => {
        if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission();
        }
    };
    // Browsers only grant permission from a gesture; the first click anywhere is that gesture.
    window.addEventListener('pointerdown', askOnce, { once: true });

    const check = (): void => {
        const nodes = projectNodes();
        const seen = seenNodeIds();
        const endpointId = currentEndpointId();
        const sessions = useSessions.getState().byKey;
        const chats = useChats.getState().byKey;
        const { agentsTurnSound } = useSettings.getState();
        const snoozes = useSnoozes.getState().byKey;
        const snoozed = (nodeId: string): boolean => snoozeOf(snoozes, endpointId, nodeId) !== null;
        const current = new Map<string, string | undefined>();
        for (const node of nodes) {
            // A snoozed wait reads as no wait, so the end of the snooze is a new one and announces itself.
            const status = snoozed(node.id) ? undefined : nodeStatus(node, sessions, chats, endpointId);
            current.set(node.id, status);
            if (status !== 'needs-you') {
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
    };

    const offSessions = useSessions.subscribe(check);
    const offChats = useChats.subscribe(check);
    const offSettings = useSettings.subscribe(check);
    const offSnoozes = useSnoozes.subscribe(check);
    return () => {
        window.removeEventListener('pointerdown', askOnce);
        offSessions();
        offChats();
        offSettings();
        offSnoozes();
    };
};
