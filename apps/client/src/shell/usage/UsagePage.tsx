import { useCallback, useEffect } from 'react';
import clsx from 'clsx';
import { ArrowLeft, ChartNoAxesColumn, RefreshCw } from 'lucide-react';
import { Segmented, Skeleton } from '@/shell/settings/controls';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';
import { askedKey, UsageEndpointContext, USAGE_PERIODS, useUsage, useUsageStore, windowFor, type UsageMetric, type UsagePeriod } from '@/state/usage';
import { useEndpointConnection, useHeldTransport } from '@/transport/status';
import type { Transport } from '@/transport/transport';
import { usageEndpointFor } from '@/shell/usage/picker';
import { EmptyState } from '@/ui/EmptyState';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { isInFloatingLayer } from '@/ui/floating';
import { formatClock, formatCount, formatDate, formatTokens } from '@/shell/usage/format';
import { useMoney } from '@/shell/usage/money';
import { deriveUsage, labelEveryFor } from '@/shell/usage/summary';
import { UsageBreakdown } from '@/shell/usage/UsageBreakdown';
import { UsageChart } from '@/shell/usage/UsageChart';
import { UsageLimits } from '@/shell/usage/UsageLimits';
import { UsageSummary } from '@/shell/usage/UsageSummary';
import { UsageTiles } from '@/shell/usage/UsageTiles';

const METRICS: readonly { id: UsageMetric; label: string }[] = [
    { id: 'cost', label: 'Cost' },
    { id: 'tokens', label: 'Tokens' }
];

const PERIOD_OPTIONS = USAGE_PERIODS.map((period) => ({ id: period.id, label: period.label }));

const closePage = (): void => useUi.getState().setPage(null);

/* Escape leaves the page, unless a popup or a dialog is up and owns the key itself. */
const useCloseOnEscape = (): void => {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey || isInFloatingLayer(e.target)) {
                return;
            }
            e.preventDefault();
            closePage();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
};

/*
 * Asks the machine on screen for the period that is up, keeps the answer under the key of the
 * question it answers, and tells that daemon to keep scanning while the page is here. A late answer
 * to the period before this one never lands, because the key it carries is no longer the one being
 * shown.
 */
const useSummary = (endpointId: string, transport: Transport | null, period: UsagePeriod): (() => void) => {
    useEffect(() => {
        if (transport === null) {
            return;
        }
        const subscribe = (): void => void transport.request('usage.subscribe', {}).catch(() => undefined);
        if (transport.status === 'open') {
            subscribe();
        }
        // A daemon knows its followers per socket, so every connection has to be told again: a reconnect, and the move to another machine.
        const off = transport.subscribeStatus((status) => {
            if (status === 'open') {
                subscribe();
            }
        });
        return () => {
            off();
            void transport.request('usage.unsubscribe', {}).catch(() => undefined);
        };
    }, [transport]);

    const load = useCallback((): void => {
        if (transport === null) {
            return;
        }
        const payload = windowFor(period);
        const asked = askedKey(payload);
        useUsageStore.getState().setLoading(endpointId, true);
        transport
            .request('usage.summary', payload)
            .then((summary) => useUsageStore.getState().receive(endpointId, asked, summary))
            .catch(() => useUsageStore.getState().fail(endpointId));
    }, [transport, endpointId, period]);

    useEffect(() => {
        if (transport === null) {
            return;
        }
        if (transport.status === 'open') {
            load();
        }
        // A scan that found something is the sign to ask again; nothing else changes the numbers.
        const offChanged = transport.on('usage.changed', load);
        // Until the other machine answers there is nothing to ask, and what is on screen is the machine that left.
        const offStatus = transport.subscribeStatus((status) => {
            if (status === 'open') {
                load();
            }
        });
        return () => {
            offChanged();
            offStatus();
        };
    }, [transport, load]);

    return load;
};

function Provenance() {
    const summary = useUsage((s) => s.summary);
    const currency = useUsage((s) => s.currency);
    const failed = useUsage((s) => s.failed);
    if (failed) {
        return <p className="text-xs text-status-error">The machine could not read the transcripts. These are the numbers of the last scan that worked.</p>;
    }
    if (summary === null) {
        return null;
    }
    const prices =
        summary.pricing.fetchedAt === null
            ? `Prices from the bundled table, ${formatCount(summary.pricing.models)} models`
            : `Prices from LiteLLM, ${formatDate(summary.pricing.fetchedAt)}`;
    // The rate is named only when it is being used, so a page in dollars says nothing about euros.
    const rate = currency === 'USD' || summary.rate === null ? null : `${summary.rate.currency} at the ECB rate of ${summary.rate.date}`;
    return (
        <p className="text-xs text-text-muted">
            Scanned {formatClock(summary.scan.at)}, {formatCount(summary.scan.files)} files · {prices}
            {rate !== null && ` · ${rate}`}
        </p>
    );
}

function LoadingBody() {
    return (
        <div className="flex flex-col gap-6">
            <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
                <div className="flex flex-col gap-3">
                    <Skeleton className="h-10 w-40" />
                    <Skeleton className="w-56" />
                    <Skeleton className="w-48" />
                </div>
                <Skeleton className="h-56 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                {[0, 1, 2, 3, 4, 5].map((tile) => (
                    <Skeleton key={tile} className="h-16 w-full rounded-xl" />
                ))}
            </div>
        </div>
    );
}

/*
 * A machine that is not answering says so, rather than leaving the page on a skeleton that never
 * fills: the numbers come from one daemon and a socket that is down is the whole story.
 */
function MachineNote({ endpointId, stale }: { endpointId: string; stale: boolean }) {
    const label = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label ?? 'This machine');
    const { status } = useEndpointConnection(endpointId);
    if (status === 'open') {
        return null;
    }
    const line = status === 'connecting' ? `Connecting to ${label}...` : `${label} is not answering.`;
    return <p className="text-xs text-text-muted">{stale ? `${line} These are the numbers of the last scan that reached it.` : line}</p>;
}

/* One tab per machine this client knows, in the order of the list; with one machine there is nothing to pick. */
function MachinePicker({ endpointId }: { endpointId: string }) {
    const endpoints = useEndpoints((s) => s.endpoints);
    if (endpoints.length < 2) {
        return null;
    }
    return (
        <Segmented
            value={endpointId}
            options={endpoints.map((endpoint) => ({ id: endpoint.id, label: endpoint.label }))}
            onChange={(id) => useUsageStore.getState().choose(id)}
            label="Machine"
        />
    );
}

/*
 * What both CLIs cost and how much of the plan is left, over one whole machine. It is a page and not
 * a view: a view lives in the project file, and none of this belongs to a project.
 */
function Page({ endpointId }: { endpointId: string }) {
    const period = useUsage((s) => s.period);
    const metric = useUsage((s) => s.metric);
    const summary = useUsage((s) => s.summary);
    const asked = useUsage((s) => s.asked);
    const loading = useUsage((s) => s.loading);
    const transport = useHeldTransport(endpointId);
    const reload = useSummary(endpointId, transport, period);
    const money = useMoney();
    const answering = transport?.status === 'open';

    const shown = summary !== null && asked === askedKey(windowFor(period)) ? summary : null;
    const derived = shown === null ? null : deriveUsage(shown, metric);
    const value = metric === 'cost' ? money : formatTokens;
    const noRoots = shown !== null && shown.roots.every((root) => root.status === 'missing');

    return (
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 pt-4 pb-10">
            <header className="flex h-12 shrink-0 items-center gap-3">
                <Tooltip label="Back" kbd="Esc" name>
                    <button className="icon-btn" onClick={closePage}>
                        <Icon icon={ArrowLeft} size={16} />
                    </button>
                </Tooltip>
                <h1 className="text-base font-semibold">Usage</h1>
                <div className="ml-auto flex items-center gap-2">
                    <MachinePicker endpointId={endpointId} />
                    <Segmented value={period} options={PERIOD_OPTIONS} onChange={(id) => useUsageStore.getState().setPeriod(id)} label="Period" />
                    <Segmented value={metric} options={METRICS} onChange={(id) => useUsageStore.getState().setMetric(id)} label="Metric" />
                    <Tooltip label="Scan again" name>
                        <button className="icon-btn" onClick={reload} disabled={loading || !answering}>
                            <Icon icon={RefreshCw} size={16} className={clsx(loading && 'animate-spin')} />
                        </button>
                    </Tooltip>
                </div>
            </header>
            <MachineNote endpointId={endpointId} stale={shown !== null} />
            <Provenance />
            {noRoots && (
                <EmptyState icon={<Icon icon={ChartNoAxesColumn} size={24} />}>
                    No Claude or Codex transcripts found. The daemon reads ~/.claude/projects and ~/.codex/sessions.
                </EmptyState>
            )}
            {/* The skeleton is the wait for an answer; without a socket there is no answer on the way. */}
            {shown === null && answering && <LoadingBody />}
            {shown === null && !answering && (
                <EmptyState icon={<Icon icon={ChartNoAxesColumn} size={24} />}>Nothing has been read from this machine yet.</EmptyState>
            )}
            {shown !== null && derived !== null && !noRoots && (
                <>
                    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
                        <UsageSummary
                            metric={metric}
                            costUsd={derived.costUsd}
                            totals={derived.totals}
                            sessions={shown.sessions}
                            providers={derived.providers}
                        />
                        <UsageChart slots={derived.slots} providers={derived.active} format={value} labelEvery={labelEveryFor(derived.slots.length)} />
                    </div>
                    <UsageTiles totals={derived.totals} cacheSavingsUsd={derived.cacheSavingsUsd} />
                    <UsageBreakdown summary={shown} metric={metric} providers={derived.active} />
                    <UsageLimits />
                </>
            )}
        </div>
    );
}

/*
 * One page with a machine picker rather than a page per machine: the numbers are a person's spend and
 * a person works on several machines. Everything under it reads the picked machine through the
 * context, which is what keeps the limit bars in the sidebar on the machine the work is on.
 */
export function UsagePage() {
    const workspaceId = useEndpointId();
    const chosen = useUsageStore((s) => s.chosen);
    const known = useEndpoints((s) => s.endpoints);
    useCloseOnEscape();
    const endpointId = usageEndpointFor(
        chosen,
        known.map((endpoint) => endpoint.id),
        workspaceId
    );

    return (
        <div className="absolute inset-0 overflow-y-auto bg-surface">
            <UsageEndpointContext.Provider value={endpointId}>
                {/* Remounts on a switch, so no effect of the machine that left outlives it. */}
                <Page key={endpointId} endpointId={endpointId} />
            </UsageEndpointContext.Provider>
        </div>
    );
}
