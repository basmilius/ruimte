import type { ChatTurnItem } from '@ruimte/contracts';
import { agentTurnLabel } from '@/chat/logic/timeline';
import { projectNodes, revealNode } from '@/project/views';
import { useChats, type ChatsById } from '@/state/chats';
import { currentEndpointId } from '@/state/keys';
import { nodeStatus, useSessions } from '@/state/sessions';

/* The newest turn a chat's agent started on its own, once it has settled; null while none has. */
const settledAgentTurn = (chat: ChatsById[string]): ChatTurnItem | null => {
    for (let i = chat.order.length - 1; i >= 0; i--) {
        const item = chat.items[chat.order[i]!];
        if (item?.kind === 'turn' && item.origin === 'agent') {
            return item.state === 'running' ? null : item;
        }
    }
    return null;
};

/*
 * One OS notification when a node turns to needs-you while the window is not focused, and one when
 * an agent finished a turn it started itself (a background subagent that settled), since nobody was
 * waiting on that one either. Clicking brings the window up and goes to the node.
 */
export const startAgentNotifications = (): (() => void) => {
    const shown = new Map<string, Notification>();
    let previous = new Map<string, string | undefined>();
    // Chats already looked at, and the last turn announced per chat: what is on disk at startup is not news.
    const seenChats = new Set<string>();
    const announced = new Map<string, string>();

    const askOnce = (): void => {
        if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission();
        }
    };
    // Browsers only grant permission from a gesture; the first click anywhere is that gesture.
    window.addEventListener('pointerdown', askOnce, { once: true });

    const canNotify = (): boolean => !document.hasFocus() && 'Notification' in window && Notification.permission === 'granted';

    const notify = (nodeId: string, title: string, body: string, tag: string): Notification => {
        const notification = new Notification(title, { body, tag });
        notification.onclick = () => {
            window.focus();
            revealNode(nodeId);
            notification.close();
        };
        return notification;
    };

    const check = (): void => {
        const nodes = projectNodes();
        const endpointId = currentEndpointId();
        const sessions = useSessions.getState().byKey;
        const chats = useChats.getState().byKey;
        const current = new Map<string, string | undefined>();
        for (const node of nodes) {
            const chat = chats[node.id];
            if (chat) {
                const turn = settledAgentTurn(chat);
                const first = !seenChats.has(node.id);
                const last = announced.get(node.id);
                seenChats.add(node.id);
                if (turn) {
                    announced.set(node.id, turn.id);
                }
                if (turn && !first && turn.id !== last && canNotify()) {
                    notify(node.id, node.title, agentTurnLabel(turn), `ruimte-turn-${turn.id}`);
                }
            }
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
            shown.set(node.id, notify(node.id, node.title, 'Needs you', `ruimte-${node.id}`));
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
