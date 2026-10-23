import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { AddressBookClient, type ModelBenchmarksResult } from '@ruimte/pulsar';
import { ErrorBoundary, Tooltip, UIProvider } from '@adecore/ui';
import { formatSource } from '@/format/source';
import { ModelsBenchmarks } from '@/shell/models/ModelsBenchmarks';
import { RuimteMark } from '@/ui/RuimteMark';

const HOME_URL = 'https://ruimte.app';

function fetchBenchmarks(): Promise<ModelBenchmarksResult> {
    return new AddressBookClient().modelBenchmarks();
}

function Page() {
    const { t } = useTranslation('models');

    return (
        <main className="flex h-dvh min-h-0 flex-col bg-surface">
            <ModelsBenchmarks
                fetchBenchmarks={fetchBenchmarks}
                brand={
                    <div className="flex items-center gap-3">
                        <Tooltip label={t('bench.home')}>
                            <a href={HOME_URL} aria-label={t('bench.home')} className="text-text hover:text-accent">
                                <RuimteMark size={20} />
                            </a>
                        </Tooltip>
                        <h1 className="text-sm font-semibold whitespace-nowrap text-text max-[760px]:sr-only">{t('dialog.title')}</h1>
                    </div>
                }
            />
        </main>
    );
}

/* The model comparison on a page of its own at `bench.ruimte.app`: no machine, no account, only the address book. */
export function BenchPage() {
    return (
        <UIProvider i18n={i18next} formatSource={formatSource}>
            <ErrorBoundary label={i18next.t('models:dialog.failed')} className="fixed inset-0 bg-bg" reload>
                <Page />
            </ErrorBoundary>
        </UIProvider>
    );
}
