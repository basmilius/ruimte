import { useChats } from '@adecore/agents-react/state';
import type { EventMap } from '@ruimte/contracts';
import i18next from 'i18next';
import { openSidebarTarget } from '@/project/sidebar-navigation';
import { revealNode } from '@/project/views';
import { subscribeChatStatuses } from '@/state/chats';
import { currentEndpointId } from '@/state/current-endpoint';
import { seenNodeIds } from '@/state/in-sight';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { useProject } from '@/state/project';
import { clientQuietState } from '@/state/quiet-hours';
import { nodeStatus, nodeWaitAsk, useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { snoozeOf, useSnoozes } from '@/state/snooze';
import { projectSoundKey, soundFor, type SoundChoice, type SoundEvent } from '@/state/sounds';
import { projectNodes } from '@/state/view-nodes';
import { bringPromptToFront } from '@/surface/canvas/prompt-stack';
import { watchEveryMachine } from '@/workspace/connections';
import { playEventSound, playSound } from './sounds';
import { waitAskLine } from './wait-ask';

/* Whether this window may raise anything at all. What a person is looking at is asked per node. */
export function mayNotify(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
}

/*
 * Nothing is announced about a node somebody is already looking at. The question is per node, not per
 * window: a chat on a view behind the one you are reading is as unseen as one in a window behind it.
 */
function canNotify(nodeId: string, seen: ReadonlySet<string>): boolean {
    return mayNotify() && !seen.has(nodeId);
}

/*
 * Clicking any of these brings the window up and goes to the node, in whichever view it lives. Every one is
 * silent to the system: the sound is the client's own, so it is the same on every computer.
 */
function notify(nodeId: string, title: string, body: string, tag: string, reveal?: () => void): Notification {
    const notification = new Notification(title, { body, tag, silent: true });
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
    const tag = `ruimte-requested-${endpointId}-${alert.nodeId}`;

    notify(alert.nodeId, alert.title, alert.body, tag, () => {
        void openSidebarTarget({ endpointId, projectId: alert.projectId, viewId: alert.viewId, nodeId: alert.nodeId });
    });
    // Every window hears this alert, so the tag decides which one plays it.
    playEventSound('alert', { endpointId, projectId: alert.projectId }, tag);
}

/* The sound an event makes in the project this window shows, or null for none. */
function soundHere(event: SoundEvent): SoundChoice | null {
    const { current, currentEndpointId: endpointId } = useProject.getState();

    return soundFor(useSettings.getState(), event, current === null || endpointId === null ? null : projectSoundKey(endpointId, current.projectId));
}

/* What a turn that stopped is announced as. The daemon tells a phone the same three apart (`push/service.ts`). */
function stopEvent(status: string | undefined, usageLimited: boolean): SoundEvent | null {
    if (status !== 'idle' && status !== 'error') {
        return null;
    }

    if (usageLimited) {
        return 'limit';
    }

    return status === 'error' ? 'error' : 'finished';
}

/* A machine that keeps the snoozes may end one by its own clock a little before this one gets there. */
const CLOCK_SLACK_MS = 5_000;

// Concurrent approvals must settle before same-tag replacement can withdraw the first banner.
const WAIT_SETTLE_MS = 1_000;

// A timer holds at most this long; a longer wait comes back to the clock and arms again.
const MAX_TIMER_MS = 2_000_000_000;

/*
 * Notify once while a hidden node needs input, then withdraw when it resumes. A snoozed wait reads as no
 * wait, so a snooze that runs out is a new one and announces itself; one that ended before its time was
 * a person's own doing (here or on another client), and stays quiet. Quiet hours read the same way, and
 * one timer on their end announces what still waits. Counts, the queue and the marks stay as they are.
 *
 * A turn that stops (finished, on an error, on a usage limit) is announced only while its event has a
 * sound, so a client nobody gave sounds raises what it always did.
 */
export function startAgentNotifications(now: () => number = Date.now): () => void {
    const shown = new Map<string, Notification>();
    const lines = new Map<string, string>();
    const stopped = new Map<string, Notification>();
    const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; ready: boolean; sound: SoundChoice | null }>();
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

    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let quietTimerAt: number | null = null;

    const armQuietTimer = (changesAt: number | null): void => {
        if (changesAt === quietTimerAt) {
            return;
        }

        if (quietTimer !== null) {
            clearTimeout(quietTimer);
            quietTimer = null;
        }

        quietTimerAt = changesAt;

        if (changesAt !== null) {
            quietTimer = setTimeout(
                () => {
                    quietTimer = null;
                    quietTimerAt = null;
                    check();
                },
                Math.min(Math.max(0, changesAt - now()), MAX_TIMER_MS)
            );
        }
    };

    const check = (): void => {
        const nodes = projectNodes();
        const seen = seenNodeIds();
        const endpointId = currentEndpointId();
        const sessions = useSessions.getState().byKey;
        const chats = useChats.getState().statusByKey;
        const settings = useSettings.getState();
        const snoozes = useSnoozes.getState().byKey;
        const quiet = clientQuietState(settings, now());
        const current = new Map<string, string | undefined>();
        const sleeping = new Map<string, number>();

        armQuietTimer(quiet.changesAt);

        for (const node of nodes) {
            const until = snoozeOf(snoozes, endpointOfNode(node, endpointId), node.id);
            if (until !== null) {
                sleeping.set(node.id, until);
            }
            const status = until === null && !quiet.quiet ? nodeStatus(node, sessions, chats, endpointId) : undefined;
            const endedEarly = status === 'needs-you' && (asleep.get(node.id) ?? 0) - now() > CLOCK_SLACK_MS;
            current.set(node.id, status);

            if (status === 'running') {
                stopped.get(node.id)?.close();
                stopped.delete(node.id);
            }

            const limit = chats[endpointKey(endpointOfNode(node, endpointId), node.id)]?.info.limit;
            const event = previous.get(node.id) === 'running' ? stopEvent(status, limit?.kind === 'usage') : null;
            const sound = event === null ? null : soundHere(event);

            if (event !== null && sound !== null && canNotify(node.id, seen)) {
                stopped.set(node.id, notify(node.id, node.title, i18next.t(`shell:notifications.${event}`), `ruimte-stopped-${node.id}`));
                playSound(sound);
            }

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
                    shown.set(node.id, notify(node.id, node.title, line, `ruimte-${node.id}`));
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
                    shown.set(node.id, notify(node.id, node.title, line, `ruimte-${node.id}`));
                    lines.set(node.id, line);

                    if (waiting.sound !== null) {
                        playSound(waiting.sound);
                    }
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

            pending.set(node.id, { timer, ready: false, sound: soundHere('question') });
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
    const offPush = watchEveryMachine((endpointId, transport) => transport.on('push.notification', (alert) => notifyRequested(endpointId, alert)));
    return () => {
        window.removeEventListener('pointerdown', askOnce);
        offPush();
        offSessions();
        offChats();
        offSettings();
        offSnoozes();
        armQuietTimer(null);

        for (const nodeId of pending.keys()) {
            cancelPending(nodeId);
        }
    };
}
