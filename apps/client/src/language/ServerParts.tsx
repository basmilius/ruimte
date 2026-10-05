import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageLogLine } from '@ruimte/contracts';
import { Dialog } from '@adecore/ui';
import type { LanguageStatusTracker } from './status';
import { nameOf, type ServerTone } from './status-view';

const DOT_CLASSES: Record<ServerTone, string> = {
    ok: 'bg-status-idle',
    busy: 'bg-status-needs-you',
    error: 'bg-status-error',
    idle: 'bg-text-faint'
};

export function Dot({ tone }: { tone: ServerTone }) {
    return <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT_CLASSES[tone]}`} />;
}

export function LogDialog({ server, tracker, onClose }: { server: string | null; tracker: LanguageStatusTracker; onClose(): void }) {
    const { t } = useTranslation('panels');
    const [lines, setLines] = useState<LanguageLogLine[] | null>(null);

    useEffect(() => {
        if (server === null) {
            return;
        }
        let alive = true;
        void tracker
            .log(server)
            .catch(() => [])
            .then((answer) => alive && setLines(answer));
        return () => {
            alive = false;
            setLines(null);
        };
    }, [server, tracker]);

    return (
        <Dialog.Root open={server !== null} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Popup className="flex h-[480px] w-[720px] flex-col gap-3 p-4">
                <Dialog.Title>{t('language.logTitle', { name: server === null ? '' : nameOf(server, tracker.getSnapshot()) })}</Dialog.Title>
                <div className="min-h-0 grow overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-xs whitespace-pre-wrap text-text-muted select-text">
                    {lines !== null && (lines.length === 0 ? t('language.logEmpty') : lines.map((line) => line.text).join('\n'))}
                </div>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
