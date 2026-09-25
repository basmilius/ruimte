import { useEffect, useMemo, useState } from 'react';
import type { UsageLimitsSnapshot } from '@ruimte/contracts';
import { limitGroups, type LimitGroup } from '@/shell/usage/limit-groups';
import { useProviderAccountsStore } from '@/state/provider-accounts';
import { useUsage, useUsageEndpointId, useUsageStore } from '@/state/usage';
import { machineTransport } from '@/transport';

const MINUTE = 60_000;

interface Hold {
    /* How many things on screen show this machine's plan windows; at zero it lets go. */
    readers: number;
    release(): void;
}

/* Asking the CLIs is expensive, so the sidebar and the page share one read per machine. */
const holds = new Map<string, Hold>();

/* On the machine's transport rather than its link, so the bars fill the moment that machine connects for any reason, and never make it connect. */
const hold = (endpointId: string): Hold => {
    const link = machineTransport(endpointId);
    const ask = (): void => {
        link.request('usage.limits', {})
            .then((snapshot) => useUsageStore.getState().setLimits(endpointId, snapshot))
            .catch(() => undefined);
    };
    if (link.status === 'open') {
        ask();
    }
    // A running turn reports its own numbers, which is what keeps a bar moving between reads.
    const offChanged = link.on('usage.limitsChanged', (snapshot) => useUsageStore.getState().setLimits(endpointId, snapshot));
    const offStatus = link.subscribeStatus((status) => {
        if (status === 'open') {
            ask();
        }
    });
    return {
        readers: 0,
        release: () => {
            offChanged();
            offStatus();
        }
    };
};

/* The snapshot of the machine in scope, kept fresh for as long as anything shows it. */
export const useUsageLimits = (): UsageLimitsSnapshot | null => {
    const limits = useUsage((s) => s.limits);
    const endpointId = useUsageEndpointId();

    useEffect(() => {
        const held = holds.get(endpointId) ?? hold(endpointId);
        held.readers += 1;
        holds.set(endpointId, held);
        return () => {
            held.readers -= 1;
            if (held.readers === 0) {
                held.release();
                holds.delete(endpointId);
            }
        };
    }, [endpointId]);

    return limits;
};

/* The snapshot per CLI and account, with the accounts of the same machine it is read from. */
export const useLimitGroups = (limits: UsageLimitsSnapshot | null): LimitGroup[] => {
    const endpointId = useUsageEndpointId();
    const accounts = useProviderAccountsStore((s) => s.byEndpoint[endpointId]?.accounts ?? null);
    return useMemo(() => (limits === null ? [] : limitGroups(limits, accounts)), [limits, accounts]);
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
