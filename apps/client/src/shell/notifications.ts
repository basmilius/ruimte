import i18next from 'i18next';
import type { EventMap } from '@ruimte/contracts';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { openSidebarTarget } from '@/shell/sidebar-navigation';
import { projectNodes, revealNode } from '@/project/views';
import { useChats } from '@ruimte/agents-react/state/chats';
import { seenNodeIds } from '@/state/in-sight';
import { currentEndpointId } from '@/state/keys';
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
const notify = (nodeId: string, title: string, body: string, tag: string, silent: boolean, reveal?: () => void): Notification => {
    const notification = new Notification(title, { body, tag, silent });
    notification.onclick = () => {
        window.focus();
        if (reveal) {
            reveal();
        } else {
            revealNode(nodeId);
            bringPromptToFront(nodeId);
        }
        notification.close();
    };
    return notification;
};

export const notifyRequested = (endpointId: string, alert: EventMap['push.notification']): void => {
    if (!mayNotify() || (endpointId === currentEndpointId() && seenNodeIds().has(alert.nodeId))) {
        return;
    }
    notify(alert.nodeId, alert.title, alert.body, `ruimte-requested-${endpointId}-${alert.nodeId}`, !useSettings.getState().agentsTurnSound, () => {
        void openSidebarTarget({ endpointId, projectId: alert.projectId, viewId: alert.viewId, nodeId: alert.nodeId });
    });
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
