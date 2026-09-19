import { useCallback, useEffect, useMemo } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { ChartNoAxesColumn, LoaderCircle, RefreshCw, TriangleAlert, Unplug, X } from 'lucide-react';
import { Segmented, Skeleton } from '@/shell/settings/controls';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { useEndpoints } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useEndpointId } from '@/state/keys';
import { useProvidersStore } from '@/state/providers';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { askedKey, UsageEndpointContext, USAGE_PERIODS, useUsage, useUsageStore, windowFor, type UsageMetric, type UsagePeriod } from '@/state/usage';
import { machineTransport } from '@/transport';
import { useEndpointConnection, useMachineHold } from '@/transport/status';
import type { Transport } from '@/transport/transport';
import { usageEndpointFor } from '@/shell/usage/picker';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { formatClock, formatCount, formatDate, formatTokens } from '@/shell/usage/format';
import { useMoney } from '@/shell/usage/money';
import { deriveUsage, labelEveryFor } from '@/shell/usage/summary';
import { UsageBreakdown } from '@/shell/usage/UsageBreakdown';
import { UsageChart } from '@/shell/usage/UsageChart';
import { UsageLimits } from '@/shell/usage/UsageLimits';
import { UsageSummary } from '@/shell/usage/UsageSummary';
import { UsageTiles } from '@/shell/usage/UsageTiles';

const METRICS: readonly UsageMetric[] = ['cost', 'tokens'];

/* Over the whole popup rather than the body under the header, so an empty state stands in the middle of the dialog. */
const DIALOG_CENTER = 'pointer-events-none absolute inset-0';

/*
 * Which agent CLIs the machine has, under an empty usage page: no usage is what a machine without any
 * agent looks like too, and the way to fix that is the Agents settings.
 */
function MachineAgents({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('usage');
    const row = useProvidersStore((s) => s.byEndpoint[endpointId]);
    const installed = useMemo(() => (row?.providers ?? []).filter((provider) => provider.installed), [row]);
    if (!row?.loaded) {
        return null;
    }
    return (
        <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-text-muted">
                {installed.length === 0 ? t('agents.none') : t('agents.installed', { list: installed.map((provider) => provider.name).join(', ') })}
            </p>
            <Button size="sm" variant="secondary" onClick={() => useUi.getState().setSettings({ open: true, section: 'agents' })}>
                {t('agents.settings')}
            </Button>
        </div>
    );
}

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
    const { t } = useTranslation('usage');
    const summary = useUsage((s) => s.summary);
    const currency = useUsage((s) => s.currency);
    const failed = useUsage((s) => s.failed);
    if (failed) {
        return <p className="mt-auto text-center text-xs text-status-error">{t('provenance.failed')}</p>;
    }
    if (summary === null) {
        return null;
    }
    const prices =
        summary.pricing.fetchedAt === null ? t('provenance.bundledPrices') : t('provenance.fetchedPrices', { date: formatDate(summary.pricing.fetchedAt) });
    // The rate is named only when it is being used, so a page in dollars says nothing about euros.
    const rate = currency === 'USD' || summary.rate === null ? null : t('provenance.rate', { currency: summary.rate.currency, date: summary.rate.date });
    return (
        <p className="mt-auto text-center text-xs text-text-muted">
            {t('provenance.scanned', { count: summary.scan.files, time: formatClock(summary.scan.at), files: formatCount(summary.scan.files) })} · {prices}
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
    const { t } = useTranslation('usage');
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label) ?? t('machineNote.unnamed');
    const { status, noLink } = useEndpointConnection(endpointId);
    if (status === 'open') {
        return null;
    }
    const connecting = noLink !== true && status === 'connecting';
    const line =
        noLink === true
            ? t('machineNote.disconnected', { machine })
            : connecting
              ? t('machineNote.connecting', { machine })
              : t('machineNote.silent', { machine });
    const icon = noLink === true ? Unplug : connecting ? LoaderCircle : TriangleAlert;
    return (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text">
            <Icon
                icon={icon}
                size={14}
                className={clsx(
                    'shrink-0',
                    connecting && 'animate-spin text-text-muted',
                    !connecting && noLink !== true && 'text-status-error',
                    noLink === true && 'text-text-muted'
                )}
            />
            <span className="grow">{stale ? `${line} ${t('machineNote.stale')}` : line}</span>
        </div>
    );
}

/* One entry per machine this client knows, in the order of the list; with one machine there is nothing to pick. */
function MachinePicker({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('usage');
    const stored = useEndpoints((s) => s.endpoints);
    const servers = useServers((s) => s.byEndpoint);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    if (endpoints.length < 2) {
        return null;
    }
    return (
        <Select
            value={endpointId}
            items={endpoints.map((endpoint) => ({
                value: endpoint.id,
                label: endpoint.label,
                icon: <MachineGlyph icon={servers[endpoint.id]?.icon ?? null} size={14} />
            }))}
            onValueChange={(id) => useUsageStore.getState().choose(id)}
            label={t('dialog.machine')}
            align="end"
        />
    );
}

/*
 * What both CLIs cost and how much of the plan is left, over one whole machine. It is a dialog and not
 * a view: a view lives in the project file, and none of this belongs to a project.
 */
function Page({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('usage');
    const period = useUsage((s) => s.period);
    const metric = useUsage((s) => s.metric);
    const summary = useUsage((s) => s.summary);
    const asked = useUsage((s) => s.asked);
    const loading = useUsage((s) => s.loading);
    const endpoint = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId) ?? null);
    // Held while the dialog shows this machine, like its dialog in the Machines pane: asking for its numbers is an explicit action.
    useMachineHold(endpoint);
    const transport = useMemo(() => machineTransport(endpointId), [endpointId]);
    const reload = useSummary(endpointId, transport, period);
    const money = useMoney();
    const answering = useEndpointConnection(endpointId).status === 'open';

    const shown = summary !== null && asked === askedKey(windowFor(period)) ? summary : null;
    const derived = shown === null ? null : deriveUsage(shown, metric);
    const value = metric === 'cost' ? money : formatTokens;
    const noRoots = shown !== null && shown.roots.every((root) => root.status === 'missing');

    return (
        <div className="flex min-h-0 grow flex-col">
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border py-3 pr-3 pl-6 max-[960px]:pl-4">
                <Dialog.Title className="text-base font-semibold text-text">{t('dialog.title')}</Dialog.Title>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <MachinePicker endpointId={endpointId} />
                    <Segmented
                        value={period}
                        options={USAGE_PERIODS.map((entry) => ({ id: entry.id, label: t(`dialog.periods.${entry.id}`) }))}
                        onChange={(id) => useUsageStore.getState().setPeriod(id)}
                        label={t('dialog.period')}
                    />
                    <Segmented
                        value={metric}
                        options={METRICS.map((id) => ({ id, label: t(`dialog.metrics.${id}`) }))}
                        onChange={(id) => useUsageStore.getState().setMetric(id)}
                        label={t('dialog.metric')}
                    />
                    <Tooltip label={t('dialog.rescan')} name>
                        <button className="icon-btn" onClick={reload} disabled={loading || !answering}>
                            <Icon icon={RefreshCw} size={16} className={clsx(loading && 'animate-spin')} />
                        </button>
                    </Tooltip>
                    <Dialog.Close className="icon-btn shrink-0" aria-label={t('dialog.close')}>
                        <Icon icon={X} size={16} />
                    </Dialog.Close>
                </div>
            </header>
            <div className="flex min-h-0 grow flex-col gap-6 overflow-y-auto px-6 pt-4 pb-6 max-[960px]:px-4">
                <MachineNote endpointId={endpointId} stale={shown !== null} />
                {noRoots && (
                    <EmptyState className={DIALOG_CENTER} icon={<Icon icon={ChartNoAxesColumn} size={24} />} action={<MachineAgents endpointId={endpointId} />}>
                        {t('empty.noTranscripts')}
                    </EmptyState>
                )}
                {/* The skeleton is the wait for an answer; without a socket there is no answer on the way. */}
                {shown === null && answering && <LoadingBody />}
                {shown === null && !answering && (
                    <EmptyState className={DIALOG_CENTER} icon={<Icon icon={ChartNoAxesColumn} size={24} />} action={<MachineAgents endpointId={endpointId} />}>
                        {t('empty.noUsage')}
                    </EmptyState>
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
                {/* Last in a column that fills the dialog, so it sits at the bottom even under a short page. */}
                <Provenance />
            </div>
        </div>
    );
}

/*
 * One dialog with a machine picker rather than one per machine: the numbers are a person's spend and
 * a person works on several machines. Everything under it reads the picked machine through the
 * context, which is what keeps the limit bars in the sidebar on the machine the work is on.
 */
function Body() {
    const workspaceId = useEndpointId();
    const chosen = useUsageStore((s) => s.chosen);
    const known = useEndpoints((s) => s.endpoints);
    const endpointId = usageEndpointFor(
        chosen,
        listedEndpoints(known).map((endpoint) => endpoint.id),
        workspaceId
    );

    return (
        <UsageEndpointContext.Provider value={endpointId}>
            {/* Remounts on a switch, so no effect of the machine that left outlives it. */}
            <Page key={endpointId} endpointId={endpointId} />
        </UsageEndpointContext.Provider>
    );
}

/* Larger than the settings: the chart and the breakdown need the width. The body mounts only while open, so nothing is scanned behind a closed dialog. */
export function UsageDialog() {
    const open = useUi((s) => s.usageOpen);
    return (
        <Dialog.Root open={open} onOpenChange={(next) => useUi.getState().setUsageOpen(next)}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup flex h-[min(820px,calc(100dvh-32px))] w-[1080px] flex-col">
                    <ErrorBoundary label={i18next.t('usage:dialog.failed')} className="grow">
                        <Body />
                    </ErrorBoundary>
                    <Dialog.Description className="sr-only">{i18next.t('usage:dialog.description')}</Dialog.Description>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
