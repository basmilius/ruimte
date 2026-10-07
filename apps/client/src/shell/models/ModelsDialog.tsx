import { useEffect, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { ChartSpline } from 'lucide-react';
import { AddressBookRequestError, type ModelBenchmarksResult } from '@ruimte/pulsar';
import { formatNumber } from '@adecore/ui/format';
import { Skeleton, Button, EmptyState, ErrorBoundary, CloseButton, Dialog } from '@adecore/ui';
import { publicAddressBook } from '@/pulsar/account';
import { ModelsComparison } from '@/shell/models/ModelsComparison';
import { useUi } from '@/state/ui';

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
 * Asked every time the dialog opens and kept nowhere else: the numbers are the address book's, and it
 * reads them again every few hours. An answer that says there is nothing yet is not a failure to reach it.
 */
function useBenchmarks(): [load: Load, retry: () => void] {
    const [load, setLoad] = useState<Load>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let current = true;
        publicAddressBook()
            .then((client) => client.modelBenchmarks())
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
    }, [attempt]);
    const retry = (): void => {
        setLoad({ status: 'loading' });
        setAttempt((count) => count + 1);
    };
    return [load, retry];
}

function Body() {
    const { t } = useTranslation('models');
    const [load, retry] = useBenchmarks();

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border py-3 pr-3 pl-6 max-[960px]:pl-4">
                <div className="flex min-w-0 items-baseline gap-3">
                    <Dialog.Title>{t('dialog.title')}</Dialog.Title>
                    <p className="text-xs text-text-muted max-[760px]:hidden">{t('dialog.subtitle')}</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <CloseButton label={t('dialog.close')} dialog />
                </div>
            </header>
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
                    <ModelsComparison result={load.result} />
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
        </div>
    );
}

/* Beside the usage dialog and outside any workspace: the numbers belong to no project and no machine. The body mounts only while open. */
export function ModelsDialog() {
    const open = useUi((s) => s.modelsOpen);
    return (
        <Dialog.Root open={open} onOpenChange={(next) => useUi.getState().setModelsOpen(next)}>
            <Dialog.Popup className="flex h-[calc(100dvh-120px)] w-[calc(100vw-120px)] flex-col">
                <ErrorBoundary label={i18next.t('models:dialog.failed')} className="grow">
                    <Body />
                </ErrorBoundary>
                <Dialog.Description className="sr-only">{i18next.t('models:dialog.description')}</Dialog.Description>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
