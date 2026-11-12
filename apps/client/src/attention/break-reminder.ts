import { formatDuration } from '@adecore/ui/format';
import i18next from 'i18next';
import { z } from 'zod';
import { mayNotify } from '@/attention/notifications';
import { playEventSound } from '@/attention/sounds';
import { desktop, type SystemIdleState } from '@/desktop/bridge';
import { clientQuietState } from '@/state/quiet-hours';
import { useSettings } from '@/state/settings';
import { storedJson } from '@/state/stored-json';
import { useToasts } from '@/state/toasts';

const POLL_MS = 30_000;
// Time without input that counts as a break: the system's idle state is asked for this many seconds.
const AWAY_SECONDS = 300;
const AWAY_MS = AWAY_SECONDS * 1000;
const LATER_MS = 15 * 60_000;
const TOAST_ID = 'break-reminder';
const NOTIFICATION_TAG = 'ruimte-break';

/*
 * The stretch of work in progress, shared by every window of this client. `seenAt` is the last tick that
 * found a person active, so a computer that slept through a break does not remind on waking.
 */
const StretchSchema = z.object({
    startedAt: z.number(),
    seenAt: z.number(),
    // What Later added.
    extraMs: z.number(),
    stage: z.enum(['waiting', 'notified', 'shown'])
});
type Stretch = z.infer<typeof StretchSchema>;

const stretches = storedJson<Stretch>('ruimte.break-reminder', StretchSchema);

interface BreakSources {
    /* Null outside the desktop app, where nothing says whether a person is at the computer. */
    idleState: ((seconds: number) => Promise<SystemIdleState>) | null;
    focused(): boolean;
    now(): number;
}

function browserSources(): BreakSources {
    const idleState = desktop()?.idleState;

    return {
        idleState: idleState ? (seconds) => idleState(seconds) : null,
        focused: () => typeof document !== 'undefined' && document.hasFocus(),
        now: () => Date.now()
    };
}

function dismiss(): void {
    useToasts.getState().dismiss(TOAST_ID);
}

function showToast(stretch: Stretch, now: number): void {
    const later = (): void => {
        stretches.write({ ...stretch, extraMs: stretch.extraMs + LATER_MS, stage: 'waiting' });
        dismiss();
    };
    const take = (): void => {
        stretches.remove();
        dismiss();
    };

    useToasts.getState().show({
        id: TOAST_ID,
        kind: 'success',
        persist: true,
        title: i18next.t('shell:breakReminder.title'),
        description: i18next.t('shell:breakReminder.description', { duration: formatDuration(now - stretch.startedAt) }),
        actions: [
            { label: i18next.t('shell:breakReminder.take'), run: take },
            { label: i18next.t('shell:breakReminder.later'), run: later }
        ]
    });
}

function notify(stretch: Stretch, now: number): void {
    const notification = new Notification(i18next.t('shell:breakReminder.title'), {
        body: i18next.t('shell:breakReminder.description', { duration: formatDuration(now - stretch.startedAt) }),
        tag: NOTIFICATION_TAG,
        silent: true
    });

    // No session's event and no project's: it sounds as an alert does in the settings' own pack.
    playEventSound('alert', null, NOTIFICATION_TAG);

    notification.onclick = () => {
        window.focus();
        notification.close();

        const current = stretches.read();

        if (current !== null) {
            stretches.write({ ...current, stage: 'shown' });
            showToast(current, Date.now());
        }
    };
}

/*
 * Suggests a break after a stretch of work. Every 30 seconds it asks the system whether a person is at the
 * computer: active starts a stretch, and five minutes away ends it, which is the break. It stays silent in
 * this client's quiet hours and tells no phone or machine.
 */
export function startBreakReminder(sources: BreakSources = browserSources()): () => void {
    const { idleState } = sources;

    if (idleState === null) {
        return () => undefined;
    }

    let busy = false;

    const tick = async (): Promise<void> => {
        const settings = useSettings.getState();

        if (!settings.breakReminderOn) {
            if (stretches.read() !== null) {
                stretches.remove();
                dismiss();
            }

            return;
        }

        const state = await idleState(AWAY_SECONDS).catch((): SystemIdleState => 'unknown');
        const now = sources.now();
        let stretch = stretches.read();

        if (state === 'idle' || state === 'locked') {
            if (stretch !== null) {
                stretches.remove();
                dismiss();
            }

            return;
        }

        if (stretch !== null && state === 'active' && now - stretch.seenAt > AWAY_MS) {
            stretch = null;
            dismiss();
        }

        if (stretch === null) {
            if (state === 'active') {
                stretches.write({ startedAt: now, seenAt: now, extraMs: 0, stage: 'waiting' });
            }

            return;
        }

        if (state === 'active') {
            stretch = { ...stretch, seenAt: now };
            stretches.write(stretch);
        }

        const due = stretch.startedAt + settings.breakReminderMinutes * 60_000 + stretch.extraMs;

        if (now < due || clientQuietState(settings, now).quiet) {
            return;
        }

        if (sources.focused()) {
            if (stretch.stage !== 'shown') {
                stretches.write({ ...stretch, stage: 'shown' });
                showToast(stretch, now);
            }
        } else if (stretch.stage === 'waiting' && mayNotify()) {
            stretches.write({ ...stretch, stage: 'notified' });
            notify(stretch, now);
        }
    };

    const run = (): void => {
        if (busy) {
            return;
        }

        busy = true;
        void tick().finally(() => {
            busy = false;
        });
    };
    const timer = setInterval(run, POLL_MS);

    run();

    return () => clearInterval(timer);
}
