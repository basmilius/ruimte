import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { ChartNoAxesColumn, RefreshCw } from 'lucide-react';
import { USAGE_PROVIDERS, type UsageAccount } from '@ruimte/agent-contracts';
import { Button } from '@ruimte/ui/Button';
import { FORM_ERROR } from '@ruimte/ui/classes';
import { CloseButton } from '@ruimte/ui/CloseButton';
import { Segmented, Skeleton } from '@ruimte/ui/controls';
import { EmptyState } from '@ruimte/ui/EmptyState';
import { Icon } from '@ruimte/ui/Icon';
import { Select } from '@ruimte/ui/Select';
import { Tooltip } from '@ruimte/ui/Tooltip';
import { AccountDot } from '../agents/AccountDot';
import { chatHost } from '../host';
import { useChatScope } from '../scope';
import { useProvidersStore } from '../state/providers';
import { askedKey, summaryPayload, USAGE_PERIODS, useUsage, useUsageStore, type UsageMetric, type UsagePeriod } from '../state/usage';
import type { ChatTransport } from '../transport';
import { formatClock, formatCount, formatDate, formatTokens, PROVIDER_LABELS } from './format';
import { useMoney } from './money';
import { deriveUsage, labelEveryFor } from './summary';
import { UsageBreakdown } from './UsageBreakdown';
import { UsageChart } from './UsageChart';
import { UsageLimits } from './UsageLimits';
import { UsageSummary } from './UsageSummary';
import { UsageTiles } from './UsageTiles';

const METRICS: readonly UsageMetric[] = ['cost', 'tokens'];

/* The picker's value for every account, which no account id can be: an id starts with a letter. */
const ALL_ACCOUNTS = '*';

/* Over the whole popup rather than the body under the header, so an empty state stands in the middle of the dialog. */
const DIALOG_CENTER = 'pointer-events-none absolute inset-0';

/* Whether the scope's host answers right now, redrawn as its link comes and goes. */
const useAnswering = (transport: ChatTransport): boolean =>
    useSyncExternalStore(
        useCallback((onChange: () => void) => transport.subscribeStatus(onChange), [transport]),
        () => transport.status === 'open'
    );

/*
 * Which agent CLIs the host has, under an empty usage page: no usage is what a host without any
 * agent looks like too, and the way to fix that is the agent settings.
 */
function HostAgents() {
    const { t } = useTranslation('agent-usage');
    const { id } = useChatScope();
    const row = useProvidersStore((s) => s.byScope[id]);
    const installed = useMemo(() => (row?.providers ?? []).filter((provider) => provider.installed), [row]);
    if (!row?.loaded) {
        return null;
    }
    return (
        <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-text-muted">
                {installed.length === 0 ? t('agents.none') : t('agents.installed', { list: installed.map((provider) => provider.name).join(', ') })}
            </p>
            <Button size="sm" variant="secondary" onClick={() => chatHost().openSettings('agents')}>
                {t('agents.settings')}
            </Button>
        </div>
    );
}

/*
 * Asks the host on screen for the period that is up, keeps the answer under the key of the question
 * it answers, and tells the host to keep scanning while the page is here. A late answer to the period
 * before this one never lands, because the key it carries is no longer the one being shown.
 */
const useSummary = (scopeId: string, transport: ChatTransport, period: UsagePeriod, account: string | null): (() => void) => {
    useEffect(() => {
        const subscribe = (): void => void transport.request('usage.subscribe', {}).catch(() => undefined);
        if (transport.status === 'open') {
            subscribe();
        }
        // A host knows its followers per link, so every connection has to be told again, on a reconnect and on a move to another host.
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
        const payload = summaryPayload(period, account);
        const asked = askedKey(payload);
        useUsageStore.getState().setLoading(scopeId, true);
        transport
            .request('usage.summary', payload)
            .then((summary) => useUsageStore.getState().receive(scopeId, asked, summary))
            .catch(() => useUsageStore.getState().fail(scopeId));
    }, [transport, scopeId, period, account]);

    useEffect(() => {
        if (transport.status === 'open') {
            load();
        }
        // A scan that found something is the sign to ask again; nothing else changes the numbers.
        const offChanged = transport.on('usage.changed', load);
        // Until the other host answers there is nothing to ask, and what is on screen is the host that left.
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
    const { t } = useTranslation('agent-usage');
    const summary = useUsage((s) => s.summary);
    const currency = useUsage((s) => s.currency);
    const failed = useUsage((s) => s.failed);
    if (failed) {
        return (
            <p className={`${FORM_ERROR} mt-auto text-center`} role="alert">
                {t('provenance.failed')}
            </p>
        );
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
 * Every account of the host, once a CLI has more than one: picking one narrows the page to what that
 * account spent. The chart keeps its split per CLI, since an account's color is a dot and not a series.
 */
function AccountPicker({ accounts, value, onChange }: { accounts: readonly UsageAccount[]; value: string | null; onChange(account: string | null): void }) {
    const { t } = useTranslation('agent-usage');
    if (!USAGE_PROVIDERS.some((kind) => accounts.filter((account) => account.kind === kind).length > 1)) {
        return null;
    }
    return (
        <Select
            value={value ?? ALL_ACCOUNTS}
            items={[
                { value: ALL_ACCOUNTS, label: t('dialog.accounts.all') },
                ...accounts.map((account) => ({
                    value: account.id,
                    label: account.label,
                    icon: <AccountDot color={account.color} />,
                    description: account.label === PROVIDER_LABELS[account.kind] ? undefined : PROVIDER_LABELS[account.kind]
                }))
            ]}
            onValueChange={(id) => onChange(id === ALL_ACCOUNTS ? null : id)}
            label={t('dialog.accounts.label')}
            align="end"
        />
    );
}

interface UsagePageProps {
    /* Drawn first among the controls of the header, such as a picker of the host these numbers are of. */
    pickers?: ReactNode;
    /* A line over the numbers about the host itself, such as that it does not answer; `stale` is true while older numbers stand under it. */
    notice?(stale: boolean): ReactNode;
}

/*
 * What the CLIs of one host cost and how much of their plans is left: the host of the scope this is
 * rendered in. It is the body of a dialog (`UsageDialog`); the page remounts per host, so nothing of
 * one outlives a switch to another.
 */
export function UsagePage({ pickers, notice }: UsagePageProps) {
    const { t } = useTranslation('agent-usage');
    const scope = useChatScope();
    const period = useUsage((s) => s.period);
    const metric = useUsage((s) => s.metric);
    const summary = useUsage((s) => s.summary);
    const asked = useUsage((s) => s.asked);
    const loading = useUsage((s) => s.loading);
    // Per host, since account ids are a host's own.
    const [account, setAccount] = useState<string | null>(null);
    const reload = useSummary(scope.id, scope.transport, period, account);
    const money = useMoney();
    const answering = useAnswering(scope.transport);

    const shown = summary !== null && asked === askedKey(summaryPayload(period, account)) ? summary : null;
    const derived = shown === null ? null : deriveUsage(shown, metric);
    const value = metric === 'cost' ? money : formatTokens;
    const noRoots = shown !== null && shown.roots.every((root) => root.status === 'missing');

    return (
        <div className="flex min-h-0 grow flex-col">
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border py-3 pr-3 pl-6 max-[960px]:pl-4">
                <Dialog.Title className="text-base font-semibold text-text">{t('dialog.title')}</Dialog.Title>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {pickers}
                    <AccountPicker accounts={summary?.accounts ?? []} value={account} onChange={setAccount} />
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
                    <CloseButton label={t('dialog.close')} dialog />
                </div>
            </header>
            <div className="flex min-h-0 grow flex-col gap-6 overflow-y-auto px-6 pt-4 pb-6 max-[960px]:px-4">
                {notice?.(shown !== null)}
                {noRoots && (
                    <EmptyState className={DIALOG_CENTER} icon={ChartNoAxesColumn} action={<HostAgents />}>
                        {t('empty.noTranscripts')}
                    </EmptyState>
                )}
                {/* The skeleton is the wait for an answer; without a link there is no answer on the way. */}
                {shown === null && answering && <LoadingBody />}
                {shown === null && !answering && (
                    <EmptyState className={DIALOG_CENTER} icon={ChartNoAxesColumn} action={<HostAgents />}>
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
