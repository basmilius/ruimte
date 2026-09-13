import type { ChatTurnItem } from '@ruimte/contracts';
import { agentTurnLabel, turnLabel } from '@/chat/logic/timeline';
import { projectNodes, revealNode } from '@/project/views';
import { useChats, type ChatsById } from '@/state/chats';
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
    return turn.origin === 'agent' ? agentTurnLabel(turn) : turnLabel(turn);
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

/*
 * One OS notification per node that turns to needs-you while the window is not focused, taken back
 * the moment the node stops waiting. A question has no setting of its own: it is the agent standing
 * still until somebody answers, which is worth a notification whatever else is switched off.
 */
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
        const endpointId = currentEndpointId();
        const sessions = useSessions.getState().byKey;
        const chats = useChats.getState().byKey;
        const current = new Map<string, string | undefined>();
        for (const node of nodes) {
            const status = nodeStatus(node, sessions, chats, endpointId);
            current.set(node.id, status);
            if (status !== 'needs-you') {
                shown.get(node.id)?.close();
                shown.delete(node.id);
                continue;
            }
            if (previous.get(node.id) === 'needs-you' || !canNotify()) {
                continue;
            }
            shown.set(node.id, notify(node.id, node.title, 'Needs you', `ruimte-${node.id}`, !useSettings.getState().agentsTurnSound));
        }
        previous = current;
    };

    const offSessions = useSessions.subscribe(check);
    const offChats = useChats.subscribe(check);
    return () => {
        window.removeEventListener('pointerdown', askOnce);
        offSessions();
        offChats();
    };
};
