import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { ChartSpline } from 'lucide-react';
import { AddressBookRequestError, type ModelBenchmarksResult } from '@ruimte/pulsar';
import { formatNumber } from '@/format/number';
import { publicAddressBook } from '@/pulsar/account';
import { chartModels, modelMarks, type CostScale } from '@/shell/models/chart';
import { ModelsChart } from '@/shell/models/ModelsChart';
import { ModelsLegend } from '@/shell/models/ModelsLegend';
import { Segmented, Skeleton } from '@/shell/settings/controls';
import { useUi } from '@/state/ui';
import { Button } from '@ruimte/ui/Button';
import { EmptyState } from '@ruimte/ui/EmptyState';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { CloseButton } from '@ruimte/ui/CloseButton';
import { useDialogLayer } from '@ruimte/ui/dialog-layer';

const SCALES: readonly CostScale[] = ['log', 'linear'];

// The attribution the terms of Artificial Analysis ask for, with a link to them; a page opens it in the system browser.
// Those terms allow a chart and not the data itself, so the overlay never gets a table, an export or a way to copy the numbers.
const SOURCE_URL = 'https://artificialanalysis.ai';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Load =
    | { status: 'loading' }
    | { status: 'ready'; result: ModelBenchmarksResult; receivedAt: number }
    | { status: 'failed'; reason: 'unavailable' | 'unreachable' };

/* How long ago the address book last read the numbers, in the words of the interface. */
const updatedLabel = (fetchedAt: number, now: number): string => {
    const past = Math.max(0, now - fetchedAt);
    const [unit, size] = past < HOUR ? (['minutes', MINUTE] as const) : past < DAY ? (['hours', HOUR] as const) : (['days', DAY] as const);
    const count = Math.floor(past / size);
    return count === 0 ? i18next.t('models:footer.justNow') : i18next.t(`models:footer.${unit}`, { count, value: formatNumber(count) });
};

/*
 * Asked every time the dialog opens and kept nowhere else: the numbers are the address book's, and it
 * reads them again every few hours. An answer that says there is nothing yet is not a failure to reach it.
 */
const useBenchmarks = (): [load: Load, retry: () => void] => {
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
};

function Comparison({ result, receivedAt, scale }: { result: ModelBenchmarksResult; receivedAt: number; scale: CostScale }) {
    const { t } = useTranslation('models');
    const models = useMemo(() => chartModels(result.models), [result]);
    const marks = useMemo(() => modelMarks(models), [models]);
    const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
    const [showLegacy, setShowLegacy] = useState(false);
    const [highlighted, setHighlighted] = useState<string | null>(null);

    const listed = useMemo(() => models.filter((model) => showLegacy || !model.legacy), [models, showLegacy]);
    const drawn = useMemo(() => listed.filter((model) => model.points.length > 0 && !hidden.has(model.id)), [listed, hidden]);

    const toggle = (id: string): void => {
        const next = new Set(hidden);
        if (!next.delete(id)) {
            next.add(id);
        }
        setHidden(next);
    };

    return (
        <>
            <div className="grid min-h-0 grow grid-cols-[1fr_16rem] gap-6 overflow-y-auto px-6 pt-4 pb-4 max-[960px]:px-4">
                <ModelsChart models={drawn} marks={marks} scale={scale} highlighted={drawn.some((model) => model.id === highlighted) ? highlighted : null} />
                <ModelsLegend
                    models={listed}
                    marks={marks}
                    hidden={hidden}
                    showLegacy={showLegacy}
                    onToggle={toggle}
                    onHighlight={setHighlighted}
                    onShowLegacy={setShowLegacy}
                />
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 border-t border-border px-6 py-2 text-xs text-text-muted">
                <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-2 hover:text-text">
                    {t('footer.source')}
                </a>
                <span aria-hidden>·</span>
                <span>{updatedLabel(result.fetchedAt, receivedAt)}</span>
            </footer>
        </>
    );
}

function Body() {
    const { t } = useTranslation('models');
    const [scale, setScale] = useState<CostScale>('log');
    const [load, retry] = useBenchmarks();

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border py-3 pr-3 pl-6 max-[960px]:pl-4">
                <div className="flex min-w-0 flex-col">
                    <Dialog.Title className="text-base font-semibold text-text">{t('dialog.title')}</Dialog.Title>
                    <p className="text-xs text-text-muted">{t('dialog.subtitle')}</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Segmented<CostScale>
                        value={scale}
                        options={SCALES.map((id) => ({ id, label: t(`dialog.scales.${id}`) }))}
                        onChange={setScale}
                        label={t('dialog.scale')}
                        disabled={load.status !== 'ready'}
                    />
                    <CloseButton label={t('dialog.close')} dialog />
                </div>
            </header>
            {load.status === 'loading' && (
                <div className="grid grow grid-cols-[1fr_16rem] gap-6 px-6 pt-4 pb-4">
                    <Skeleton className="h-[400px] w-full rounded-lg" />
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
            {load.status === 'ready' && <Comparison result={load.result} receivedAt={load.receivedAt} scale={scale} />}
        </div>
    );
}

/* Beside the usage dialog and outside any workspace: the numbers belong to no project and no machine. The body mounts only while open. */
export function ModelsDialog() {
    const open = useUi((s) => s.modelsOpen);
    const stacked = useDialogLayer(open);
    return (
        <Dialog.Root open={open} onOpenChange={(next) => useUi.getState().setModelsOpen(next)}>
            <Dialog.Portal>
                <Dialog.Backdrop className={clsx('dialog-backdrop', stacked && 'dialog-backdrop-nested')} forceRender={stacked} />
                <Dialog.Popup className={clsx('dialog-popup flex h-[600px] w-[1080px] flex-col', stacked && 'dialog-popup-nested')}>
                    <ErrorBoundary label={i18next.t('models:dialog.failed')} className="grow">
                        <Body />
                    </ErrorBoundary>
                    <Dialog.Description className="sr-only">{i18next.t('models:dialog.description')}</Dialog.Description>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
