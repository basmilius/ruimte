import { useEffect, useState } from 'react';
import type { UsageLimitsSnapshot } from '@ruimte/contracts';
import { useUsage } from '@/state/usage';
import { transport } from '@/transport';

const MINUTE = 60_000;

/* Asking the CLIs is expensive, so the sidebar and the page share one read and one subscription. */
let readers = 0;
let unsubscribe: (() => void) | null = null;

/* The snapshot, kept fresh for as long as anything shows it. */
export const useUsageLimits = (): UsageLimitsSnapshot | null => {
    const limits = useUsage((s) => s.limits);

    useEffect(() => {
        readers += 1;
        if (readers === 1) {
            transport
                .request('usage.limits', {})
                .then((snapshot) => useUsage.getState().setLimits(snapshot))
                .catch(() => undefined);
            // A running turn reports its own numbers, which is what keeps a bar moving between reads.
            unsubscribe = transport.on('usage.limitsChanged', (snapshot) => useUsage.getState().setLimits(snapshot));
        }
        return () => {
            readers -= 1;
            if (readers === 0) {
                unsubscribe?.();
                unsubscribe = null;
            }
        };
    }, []);

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
