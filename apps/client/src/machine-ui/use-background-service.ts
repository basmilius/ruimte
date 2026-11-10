import { useEffect, useState } from 'react';
import { desktop, type BackgroundServiceState } from '@/desktop/bridge';

/* The background service as the shell last told it, null outside the desktop app and until the shell answered. */
export function useBackgroundServiceState(): BackgroundServiceState | null {
    const service = desktop()?.backgroundService ?? null;
    const [state, setState] = useState<BackgroundServiceState | null>(null);

    useEffect(() => {
        if (!service) {
            return;
        }

        let live = true;
        void service.state().then((next) => {
            if (live) {
                setState(next);
            }
        });
        const off = service.onState(setState);

        return () => {
            live = false;
            off();
        };
    }, [service]);

    return state;
}
