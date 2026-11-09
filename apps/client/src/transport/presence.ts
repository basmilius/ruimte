import { desktop, type SystemIdleState } from '@/desktop/bridge';
import { fireAndForget } from '@/transport-api/transport';
import type { Transport } from '../transport-api/transport';

// Well within the machine's lease of a minute, so one lost report never reads as leaving.
const REPORT_MS = 20_000;
const IDLE_SECONDS = 120;

interface PresenceSources {
    /* Null outside the desktop app, where only the page's own focus says anything. */
    idleState: (() => Promise<SystemIdleState>) | null;
    focused: () => boolean;
}

/* A person at the computer counts in any app, since the desktop still shows what the machine tells it. */
export async function personPresent(sources: PresenceSources): Promise<boolean> {
    const state = sources.idleState ? await sources.idleState().catch((): SystemIdleState => 'unknown') : 'unknown';
    if (state === 'active') {
        return true;
    }
    if (state === 'idle' || state === 'locked') {
        return false;
    }
    return sources.focused();
}

function browserSources(): PresenceSources {
    const idleState = desktop()?.idleState;
    return {
        idleState: idleState ? () => idleState(IDLE_SECONDS) : null,
        focused: () => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()
    };
}

/* Tells the machine whether a person is here, so it holds the pushes to their phone while they are. */
export function reportPresence(
    transport: Pick<Transport, 'request' | 'status' | 'subscribeStatus'>,
    answers: () => boolean,
    sources: PresenceSources = browserSources()
): () => void {
    let reported: boolean | null = null;
    let stopped = false;
    const report = async (): Promise<void> => {
        if (transport.status !== 'open' || !answers()) {
            return;
        }
        const present = await personPresent(sources);
        // A presence lapses on the machine unless renewed; an absence needs saying once.
        if (stopped || (!present && reported === false)) {
            return;
        }
        reported = present;
        await fireAndForget('presence.report', transport.request('presence.report', { present }));
    };
    const onChange = (): void => {
        void report();
    };
    const timer = setInterval(onChange, REPORT_MS);
    const offStatus = transport.subscribeStatus((status) => {
        reported = null;
        if (status === 'open') {
            onChange();
        }
    });
    const inPage = typeof window !== 'undefined';
    if (inPage) {
        window.addEventListener('focus', onChange);
        window.addEventListener('blur', onChange);
        document.addEventListener('visibilitychange', onChange);
    }
    onChange();
    return () => {
        stopped = true;
        clearInterval(timer);
        offStatus();
        if (inPage) {
            window.removeEventListener('focus', onChange);
            window.removeEventListener('blur', onChange);
            document.removeEventListener('visibilitychange', onChange);
        }
    };
}
