import { useCallback, useEffect } from 'react';
import clsx from 'clsx';
import { ArrowLeft, ChartNoAxesColumn, RefreshCw } from 'lucide-react';
import { Segmented, Skeleton } from '@/shell/settings/controls';
import { useUi } from '@/state/ui';
import { askedKey, USAGE_PERIODS, useUsage, windowFor, type UsageMetric, type UsagePeriod } from '@/state/usage';
import { transport } from '@/transport';
import { EmptyState } from '@/ui/EmptyState';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { isInFloatingLayer } from '@/ui/floating';
import { formatClock, formatCount, formatDate, formatTokens, formatUsd } from '@/shell/usage/format';
import { deriveUsage, labelEveryFor } from '@/shell/usage/summary';
import { UsageChart } from '@/shell/usage/UsageChart';
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
 * Asks for the period that is up, keeps the answer under the key of the question it answers, and
 * tells the daemon to keep scanning while the page is here. A late answer to the period before this
 * one never lands, because the key it carries is no longer the one being shown.
 */
const useSummary = (period: UsagePeriod): (() => void) => {
    useEffect(() => {
        void transport.request('usage.subscribe', {}).catch(() => undefined);
        return () => {
            void transport.request('usage.unsubscribe', {}).catch(() => undefined);
        };
    }, []);

    const load = useCallback((): void => {
        const payload = windowFor(period);
        const asked = askedKey(payload);
        useUsage.getState().setLoading(true);
        transport
            .request('usage.summary', payload)
            .then((summary) => useUsage.getState().receive(asked, summary))
            .catch(() => useUsage.getState().fail());
    }, [period]);

    useEffect(() => {
        load();
        // A scan that found something is the sign to ask again; nothing else changes the numbers.
        return transport.on('usage.changed', load);
    }, [load]);

    return load;
};

function Provenance() {
    const summary = useUsage((s) => s.summary);
    const failed = useUsage((s) => s.failed);
    if (failed) {
        return <p className="text-xs text-status-error">The daemon could not read the transcripts. These are the numbers of the last scan that worked.</p>;
    }
    if (summary === null) {
        return null;
    }
    const prices =
        summary.pricing.fetchedAt === null
            ? `Prices from the bundled table, ${formatCount(summary.pricing.models)} models`
            : `Prices from LiteLLM, ${formatDate(summary.pricing.fetchedAt)}`;
    return (
        <p className="text-xs text-text-muted">
            Scanned {formatClock(summary.scan.at)}, {formatCount(summary.scan.files)} files · {prices}
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
 * What both CLIs cost and how much of the plan is left, over the whole machine. It is a page and not
 * a view: a view lives in the project file, and none of this belongs to a project.
 */
export function UsagePage() {
    const period = useUsage((s) => s.period);
    const metric = useUsage((s) => s.metric);
    const summary = useUsage((s) => s.summary);
    const asked = useUsage((s) => s.asked);
    const loading = useUsage((s) => s.loading);
    useCloseOnEscape();
    const reload = useSummary(period);

    const shown = summary !== null && asked === askedKey(windowFor(period)) ? summary : null;
    const derived = shown === null ? null : deriveUsage(shown, metric);
    const value = metric === 'cost' ? formatUsd : formatTokens;
    const noRoots = shown !== null && shown.roots.every((root) => root.status === 'missing');

    return (
        <div className="absolute inset-0 overflow-y-auto bg-surface">
            <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 pt-4 pb-10">
                <header className="flex h-12 shrink-0 items-center gap-3">
                    <Tooltip label="Back" kbd="Esc" name>
                        <button className="icon-btn" onClick={closePage}>
                            <Icon icon={ArrowLeft} size={16} />
                        </button>
                    </Tooltip>
                    <h1 className="text-base font-semibold">Usage</h1>
                    <div className="ml-auto flex items-center gap-2">
                        <Segmented value={period} options={PERIOD_OPTIONS} onChange={(id) => useUsage.getState().setPeriod(id)} label="Period" />
                        <Segmented value={metric} options={METRICS} onChange={(id) => useUsage.getState().setMetric(id)} label="Metric" />
                        <Tooltip label="Scan again" name>
                            <button className="icon-btn" onClick={reload} disabled={loading}>
                                <Icon icon={RefreshCw} size={16} className={clsx(loading && 'animate-spin')} />
                            </button>
                        </Tooltip>
                    </div>
                </header>
                <Provenance />
                {noRoots && (
                    <EmptyState icon={<Icon icon={ChartNoAxesColumn} size={24} />}>
                        No Claude or Codex transcripts found. The daemon reads ~/.claude/projects and ~/.codex/sessions.
                    </EmptyState>
                )}
                {shown === null && <LoadingBody />}
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
                    </>
                )}
            </div>
        </div>
    );
}
