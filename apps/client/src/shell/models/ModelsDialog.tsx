import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ModelBenchmarksResult } from '@ruimte/pulsar';
import { ErrorBoundary, CloseButton, Dialog } from '@adecore/ui';
import { publicAddressBook } from '@/pulsar/account';
import { ModelsBenchmarks } from '@/shell/models/ModelsBenchmarks';
import { useUi } from '@/state/ui';

function fetchBenchmarks(): Promise<ModelBenchmarksResult> {
    return publicAddressBook().then((client) => client.modelBenchmarks());
}

function Body() {
    const { t } = useTranslation('models');

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
            <ModelsBenchmarks fetchBenchmarks={fetchBenchmarks} />
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
