import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { nodeStatus, useSessions } from '@/state/sessions';

/*
 * One OS notification when a node turns to needs-you while the window is not focused. Clicking
 * it brings the window up and goes to the node; nothing else on the canvas moves.
 */
export const startNeedsYouNotifications = (): (() => void) => {
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
        const { nodes } = useCanvas.getState();
        const sessions = useSessions.getState().byNodeId;
        const chats = useChats.getState().byNodeId;
        const current = new Map<string, string | undefined>();
        for (const node of Object.values(nodes)) {
            const status = nodeStatus(node, sessions, chats);
            current.set(node.id, status);
            if (status !== 'needs-you') {
                shown.get(node.id)?.close();
                shown.delete(node.id);
                continue;
            }
            if (previous.get(node.id) === 'needs-you' || document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') {
                continue;
            }
            const notification = new Notification(node.title, { body: 'Needs you', tag: `ruimte-${node.id}` });
            notification.onclick = () => {
                window.focus();
                useCanvas.getState().goToNode(node.id);
                notification.close();
            };
            shown.set(node.id, notification);
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
