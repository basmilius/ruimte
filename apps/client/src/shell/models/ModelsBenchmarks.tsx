import { useEffect, useState, type ReactNode } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { ChartSpline } from 'lucide-react';
import { AddressBookRequestError, type ModelBenchmarksResult } from '@ruimte/pulsar';
import { formatNumber } from '@adecore/ui/format';
import { Skeleton, Button, EmptyState, Separator } from '@adecore/ui';
import { ModelsComparison } from '@/shell/models/ModelsComparison';

// Artificial Analysis requires visible attribution alongside its benchmark visualizations.
const SOURCE_URL = 'https://artificialanalysis.ai';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Load =
    | { status: 'loading' }
    | { status: 'ready'; result: ModelBenchmarksResult; receivedAt: number }
    | { status: 'failed'; reason: 'unavailable' | 'unreachable' };

/* How long ago the address book last read the numbers, in the words of the interface. */
function updatedLabel(fetchedAt: number, now: number): string {
    const past = Math.max(0, now - fetchedAt);
    const [unit, size] = past < HOUR ? (['minutes', MINUTE] as const) : past < DAY ? (['hours', HOUR] as const) : (['days', DAY] as const);
    const count = Math.floor(past / size);
    return count === 0 ? i18next.t('models:footer.justNow') : i18next.t(`models:footer.${unit}`, { count, value: formatNumber(count) });
}

/*
 * Asked every time the comparison mounts and kept nowhere else: the numbers are the address book's, and it
 * reads them again every few hours. An answer that says there is nothing yet is not a failure to reach it.
 */
function useBenchmarks(fetchBenchmarks: () => Promise<ModelBenchmarksResult>): [load: Load, retry: () => void] {
    const [load, setLoad] = useState<Load>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let current = true;
        fetchBenchmarks()
            .then((result) => {
                if (current) {
                    setLoad({ status: 'ready', result, receivedAt: Date.now() });
                }
            })
            .catch((e: unknown) => {
                if (current) {
                    const unavailable = e instanceof AddressBookRequestError && (e.code === 'not-configured' || e.code === 'no-benchmarks');
                    setLoad({ status: 'failed', reason: unavailable ? 'unavailable' : 'unreachable' });
                }
            });
        return () => {
            current = false;
        };
    }, [attempt, fetchBenchmarks]);
    const retry = (): void => {
        setLoad({ status: 'loading' });
        setAttempt((count) => count + 1);
    };
    return [load, retry];
}

/*
 * The comparison with its loading and failed states and the attribution, for the dialog and for bench alike.
 * A `brand` leads the row of tabs, or a bar of its own until there are tabs.
 */
export function ModelsBenchmarks({ fetchBenchmarks, brand }: { fetchBenchmarks: () => Promise<ModelBenchmarksResult>; brand?: ReactNode }) {
    const { t } = useTranslation('models');
    const [load, retry] = useBenchmarks(fetchBenchmarks);

    return (
        <>
            {brand !== undefined && load.status !== 'ready' && (
                <header className="flex h-11 shrink-0 items-center border-b border-border px-5 max-[760px]:px-2">{brand}</header>
            )}
            {load.status === 'loading' && (
                <div className="grid min-h-0 grow grid-cols-[minmax(0,1fr)_15rem] gap-6 px-6 pt-4 pb-4 max-[760px]:grid-cols-1">
                    <Skeleton className="h-full w-full rounded-lg" />
                    <div className="flex flex-col gap-2">
                        {[0, 1, 2, 3, 4, 5].map((row) => (
                            <Skeleton key={row} className="w-40" />
                        ))}
                    </div>
                </div>
            )}
            {load.status === 'failed' && (
                <EmptyState
                    className="grow"
                    icon={ChartSpline}
                    action={
                        <Button size="sm" variant="secondary" onClick={retry}>
                            {i18next.t('common:action.retry')}
                        </Button>
                    }
                >
                    {t(`empty.${load.reason}`)}
                </EmptyState>
            )}
            {load.status === 'ready' && (
                <>
                    <ModelsComparison
                        result={load.result}
                        start={
                            brand === undefined ? undefined : (
                                <div className="mr-1 flex items-center gap-5 max-[760px]:mr-0 max-[760px]:gap-2">
                                    {brand}
                                    <Separator />
                                </div>
                            )
                        }
                    />
                    <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 border-t border-border px-6 py-2 text-xs text-text-muted">
                        <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-2 hover:text-text">
                            {t('footer.source')}
                        </a>
                        <span aria-hidden>·</span>
                        <span>{updatedLabel(load.result.fetchedAt, load.receivedAt)}</span>
                        {load.result.intelligenceIndexVersion !== undefined && (
                            <>
                                <span aria-hidden>·</span>
                                <span>{t('footer.version', { version: load.result.intelligenceIndexVersion })}</span>
                            </>
                        )}
                    </footer>
                </>
            )}
        </>
    );
}
