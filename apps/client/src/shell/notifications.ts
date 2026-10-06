import i18next from 'i18next';
import type { EventMap } from '@ruimte/contracts';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { openSidebarTarget } from '@/shell/sidebar-navigation';
import { projectNodes, revealNode } from '@/project/views';
import { useChats } from '@adecore/agents-react/state/chats';
import { seenNodeIds } from '@/state/in-sight';
import { currentEndpointId } from '@/state/keys';
import { nodeStatus, useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { snoozeOf, useSnoozes } from '@/state/snooze';

/* Whether this window may raise anything at all. What a person is looking at is asked per node. */
function mayNotify(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
}

/*
 * Nothing is announced about a node somebody is already looking at: it says it there itself. A
 * window has held several views since the grid, so the question is about the node and not about the
 * window: a chat on a view behind the one you are reading is as unseen as one in a window behind it.
 */
function canNotify(nodeId: string, seen: ReadonlySet<string>): boolean {
    return mayNotify() && !seen.has(nodeId);
}

/* Clicking any of these brings the window up and goes to the node, in whichever view it lives. */
function notify(nodeId: string, title: string, body: string, tag: string, silent: boolean, reveal?: () => void): Notification {
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
}

export function notifyRequested(endpointId: string, alert: EventMap['push.notification']): void {
    if (!mayNotify() || (endpointId === currentEndpointId() && seenNodeIds().has(alert.nodeId))) {
        return;
    }
    notify(alert.nodeId, alert.title, alert.body, `ruimte-requested-${endpointId}-${alert.nodeId}`, !useSettings.getState().agentsTurnSound, () => {
        void openSidebarTarget({ endpointId, projectId: alert.projectId, viewId: alert.viewId, nodeId: alert.nodeId });
    });
}

/* A machine that keeps the snoozes may end one by its own clock a little before this one gets there. */
const CLOCK_SLACK_MS = 5_000;

/*
 * Notify once while a hidden node needs input, then withdraw when it resumes. A snoozed wait reads as no
 * wait, so a snooze that runs out is a new one and announces itself; one that ended before its time was
 * a person's own doing (here or on another client), and stays quiet.
 */
export function startAgentNotifications(now: () => number = Date.now): () => void {
    const shown = new Map<string, Notification>();
    let previous = new Map<string, string | undefined>();
    /* When the snooze on each node that was snoozed at the last pass runs out. */
    let asleep = new Map<string, number>();

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
        const current = new Map<string, string | undefined>();
        const sleeping = new Map<string, number>();
        for (const node of nodes) {
            const until = snoozeOf(snoozes, endpointId, node.id);
            if (until !== null) {
                sleeping.set(node.id, until);
            }
            const status = until === null ? nodeStatus(node, sessions, chats, endpointId) : undefined;
            const endedEarly = status === 'needs-you' && (asleep.get(node.id) ?? 0) - now() > CLOCK_SLACK_MS;
            current.set(node.id, status);
            if (status !== 'needs-you') {
                shown.get(node.id)?.close();
                shown.delete(node.id);
                continue;
            }
            if (previous.get(node.id) === 'needs-you' || endedEarly || !canNotify(node.id, seen)) {
                continue;
            }
            shown.set(node.id, notify(node.id, node.title, i18next.t('shell:notifications.needsYou'), `ruimte-${node.id}`, !agentsTurnSound));
        }
        previous = current;
        asleep = sleeping;
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
}
