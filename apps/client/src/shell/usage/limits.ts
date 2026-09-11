import { useEffect, useState } from 'react';
import type { UsageLimitsSnapshot } from '@ruimte/contracts';
import { useEndpoints } from '@/state/endpoints';
import { useUsage } from '@/state/usage';
import { transport } from '@/transport';

const MINUTE = 60_000;

/* Asking the CLIs is expensive, so the sidebar and the page share one read and one subscription. */
let readers = 0;
let held: { endpointId: string; release: () => void } | null = null;

const hold = (endpointId: string): { endpointId: string; release: () => void } => {
    const ask = (): void => {
        transport
            .request('usage.limits', {})
            .then((snapshot) => useUsage.getState().setLimits(snapshot))
            .catch(() => undefined);
    };
    if (transport.status === 'open') {
        ask();
    }
    // A running turn reports its own numbers, which is what keeps a bar moving between reads.
    const offChanged = transport.on('usage.limitsChanged', (snapshot) => useUsage.getState().setLimits(snapshot));
    // The move to another machine closes the socket first, so the new machine is asked when it answers.
    const offStatus = transport.subscribeStatus((status) => {
        if (status === 'open') {
            ask();
        }
    });
    return {
        endpointId,
        release: () => {
            offChanged();
            offStatus();
        }
    };
};

/* The snapshot, kept fresh for as long as anything shows it. */
export const useUsageLimits = (): UsageLimitsSnapshot | null => {
    const limits = useUsage((s) => s.limits);
    const endpointId = useEndpoints((s) => s.activeId);

    useEffect(() => {
        readers += 1;
        if (held?.endpointId !== endpointId) {
            held?.release();
            held = hold(endpointId);
        }
        return () => {
            readers -= 1;
            if (readers === 0) {
                held?.release();
                held = null;
            }
        };
    }, [endpointId]);

    return limits;
};

/* A countdown that stands still lies within the minute; this is the cheapest way to keep it honest. */
export const useMinute = (): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), MINUTE);
        return () => clearInterval(timer);
    }, []);
    return now;
};
