import i18next from 'i18next';
import type { EventMap } from '@ruimte/contracts';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { openSidebarTarget } from '@/shell/sidebar-navigation';
import { projectNodes } from '@/project/view-nodes';
import { revealNode } from '@/project/views';
import { useChats } from '@adecore/agents-react/state';
import { subscribeChatStatuses } from '@/state/chats';
import { seenNodeIds } from '@/state/in-sight';
import { currentEndpointId, endpointOfNode } from '@/state/keys';
import { nodeStatus, nodeWaitAsk, useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { snoozeOf, useSnoozes } from '@/state/snooze';
import { waitAskLine } from './wait-ask';

/* Whether this window may raise anything at all. What a person is looking at is asked per node. */
function mayNotify(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
}

/*
 * Nothing is announced about a node somebody is already looking at. The question is per node, not per
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

// Concurrent approvals must settle before same-tag replacement can withdraw the first banner.
const WAIT_SETTLE_MS = 1_000;

/*
 * Notify once while a hidden node needs input, then withdraw when it resumes. A snoozed wait reads as no
 * wait, so a snooze that runs out is a new one and announces itself; one that ended before its time was
 * a person's own doing (here or on another client), and stays quiet.
 */
export function startAgentNotifications(now: () => number = Date.now): () => void {
    const shown = new Map<string, Notification>();
    const lines = new Map<string, string>();
    const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; ready: boolean; silent: boolean }>();
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

    const cancelPending = (nodeId: string): void => {
        const waiting = pending.get(nodeId);

        if (waiting) {
            clearTimeout(waiting.timer);
            pending.delete(nodeId);
        }
    };

    const check = (): void => {
        const nodes = projectNodes();
        const seen = seenNodeIds();
        const endpointId = currentEndpointId();
        const sessions = useSessions.getState().byKey;
        const chats = useChats.getState().statusByKey;
        const { agentsTurnSound } = useSettings.getState();
        const snoozes = useSnoozes.getState().byKey;
        const current = new Map<string, string | undefined>();
        const sleeping = new Map<string, number>();
        for (const node of nodes) {
            const until = snoozeOf(snoozes, endpointOfNode(node, endpointId), node.id);
            if (until !== null) {
                sleeping.set(node.id, until);
            }
            const status = until === null ? nodeStatus(node, sessions, chats, endpointId) : undefined;
            const endedEarly = status === 'needs-you' && (asleep.get(node.id) ?? 0) - now() > CLOCK_SLACK_MS;
            current.set(node.id, status);
            if (status !== 'needs-you') {
                cancelPending(node.id);
                shown.get(node.id)?.close();
                shown.delete(node.id);
                lines.delete(node.id);
                continue;
            }

            const ask = nodeWaitAsk(node, sessions, chats, endpointId);
            const line = ask ? waitAskLine(ask) : i18next.t('shell:notifications.needsYou');
            // The request can land after the status, or a second one join it: the notification follows, without a second sound.
            if (shown.has(node.id)) {
                if (lines.get(node.id) !== line && canNotify(node.id, seen)) {
                    shown.set(node.id, notify(node.id, node.title, line, `ruimte-${node.id}`, true));
                    lines.set(node.id, line);
                }
                continue;
            }
            if (endedEarly || !canNotify(node.id, seen)) {
                cancelPending(node.id);
                continue;
            }

            const waiting = pending.get(node.id);

            if (waiting) {
                if (waiting.ready) {
                    pending.delete(node.id);
                    shown.set(node.id, notify(node.id, node.title, line, `ruimte-${node.id}`, waiting.silent));
                    lines.set(node.id, line);
                }

                continue;
            }

            if (previous.get(node.id) === 'needs-you') {
                continue;
            }

            const timer = setTimeout(() => {
                const scheduled = pending.get(node.id);

                if (scheduled?.timer === timer) {
                    scheduled.ready = true;
                    check();
                }
            }, WAIT_SETTLE_MS);

            pending.set(node.id, { timer, ready: false, silent: !agentsTurnSound });
        }

        for (const nodeId of pending.keys()) {
            if (!current.has(nodeId)) {
                cancelPending(nodeId);
            }
        }

        previous = current;
        asleep = sleeping;
    };

    const offSessions = useSessions.subscribe(check);
    const offChats = subscribeChatStatuses(check);
    const offSettings = useSettings.subscribe(check);
    const offSnoozes = useSnoozes.subscribe(check);
    return () => {
        window.removeEventListener('pointerdown', askOnce);
        offSessions();
        offChats();
        offSettings();
        offSnoozes();

        for (const nodeId of pending.keys()) {
            cancelPending(nodeId);
        }
    };
}
