import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageLogLine, LanguageServerStatus } from '@ruimte/contracts';
import { Button, Dialog, Popover, Spinner, Tooltip } from '@basmilius/desktop-ui';
import { formatNumber } from '@basmilius/desktop-ui/format';
import { useToasts } from '@/state/toasts';
import type { EditorLanguage } from './editor-language';
import type { LanguageStatusTracker } from './status';
import { actionsOf, chipServer, kindOf, listedServers, nameOf, packageOf, toneOf, type ServerTone } from './status-view';
import { useServingKinds } from './use-serving-kinds';

const DOT_CLASSES: Record<ServerTone, string> = {
    ok: 'bg-status-idle',
    busy: 'bg-status-needs-you',
    error: 'bg-status-error',
    idle: 'bg-text-faint'
};

function Dot({ tone }: { tone: ServerTone }) {
    return <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT_CLASSES[tone]}`} />;
}

function useStatuses(tracker: LanguageStatusTracker): readonly LanguageServerStatus[] {
    const subscribe = useCallback((listener: () => void) => tracker.subscribe(listener), [tracker]);
    return useSyncExternalStore(subscribe, () => tracker.getSnapshot());
}

/* Says a failed request aloud, since the row it came from has nowhere to put a sentence. */
function report(error: unknown, t: (key: string, options: { message: string }) => string): void {
    useToasts.getState().show({
        id: 'language-request-failed',
        kind: 'error',
        title: t('language.failed', { message: error instanceof Error ? error.message : String(error) })
    });
}

/*
 * The language servers behind the open file, as the chip in its toolbar and the list under it. A server
 * is installed only by a person's click on Install here; nothing else on the page asks the machine to.
 */
export function LanguageStatusItem({ language }: { language: EditorLanguage }) {
    const { t } = useTranslation('panels');
    const tracker = language.project.status;
    const statuses = useStatuses(tracker);
    const serving = useServingKinds(language);
    const [logOf, setLogOf] = useState<string | null>(null);
    const chip = chipServer(statuses, serving);
    const listed = listedServers(statuses, serving);

    if (chip === null) {
        return null;
    }

    const runningCount = listed.filter((status) => actionsOf(status).restart).length;
    const restartAll = (): void => {
        for (const status of listed.filter((entry) => actionsOf(entry).restart)) {
            const kind = kindOf(status.server);
            if (kind !== null) {
                void tracker.restart(kind).catch((error: unknown) => report(error, t));
            }
        }
    };

    return (
        <>
            <Popover.Root>
                <Tooltip label={`${nameOf(chip.server)} · ${t(`language.state.${chip.state}`)}`}>
                    <Popover.Trigger
                        aria-label={t('language.chip')}
                        className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text aria-expanded:bg-surface-active aria-expanded:text-text"
                    >
                        {chip.state === 'installing' ? <Spinner size={12} /> : <Dot tone={toneOf(chip.state)} />}
                        {nameOf(chip.server)}
                    </Popover.Trigger>
                </Tooltip>
                <Popover.Popup align="end" sideOffset={6} className="flex w-80 flex-col gap-1 p-2">
                    <Popover.Title className="px-2 pt-1 pb-1 text-xs font-medium text-text">{t('language.title')}</Popover.Title>
                    {listed.map((status) => (
                        <ServerRow key={status.server} status={status} tracker={tracker} onLog={() => setLogOf(status.server)} />
                    ))}
                    {runningCount > 1 && (
                        <div className="flex justify-end border-t border-border pt-2">
                            <Button size="xs" onClick={restartAll}>
                                {t('language.restartAll')}
                            </Button>
                        </div>
                    )}
                </Popover.Popup>
            </Popover.Root>
            <LogDialog server={logOf} tracker={tracker} onClose={() => setLogOf(null)} />
        </>
    );
}

function ServerRow({ status, tracker, onLog }: { status: LanguageServerStatus; tracker: LanguageStatusTracker; onLog(): void }) {
    const { t } = useTranslation('panels');
    const kind = kindOf(status.server);
    const actions = actionsOf(status);
    const fail = (error: unknown): void => report(error, t);
    const detail =
        status.state === 'crashed' || (status.state === 'not-installed' && status.message !== undefined)
            ? (status.message ?? '')
            : status.state === 'not-installed'
              ? t('language.installDetail', { name: nameOf(status.server), version: status.version })
              : status.documents > 0
                ? t('language.documents', { count: status.documents, formatted: formatNumber(status.documents) })
                : '';

    return (
        <div className="flex flex-col gap-1 rounded-md px-2 py-1.5">
            <div className="flex items-center gap-2 text-xs">
                {status.state === 'installing' ? <Spinner size={12} /> : <Dot tone={toneOf(status.state)} />}
                <span className="font-medium text-text">{nameOf(status.server)}</span>
                <span className="font-mono text-text-faint">{status.version}</span>
                <span className="ml-auto text-text-muted">{t(`language.state.${status.state}`)}</span>
            </div>
            <div className="pl-4 text-xs text-text-faint">{packageOf(status.server)}</div>
            {detail !== '' && <div className="pl-4 text-xs break-words text-text-muted">{detail}</div>}
            {(actions.install || actions.restart || actions.log) && (
                <div className="flex gap-2 pl-4">
                    {kind !== null && actions.install && (
                        <Button size="xs" variant="secondary" onClick={() => void tracker.install(kind).catch(fail)}>
                            {t('language.install')}
                        </Button>
                    )}
                    {kind !== null && actions.restart && (
                        <Button size="xs" variant="secondary" onClick={() => void tracker.restart(kind).catch(fail)}>
                            {t('language.restart')}
                        </Button>
                    )}
                    {actions.log && (
                        <Button size="xs" onClick={onLog}>
                            {t('language.showLog')}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

function LogDialog({ server, tracker, onClose }: { server: string | null; tracker: LanguageStatusTracker; onClose(): void }) {
    const { t } = useTranslation('panels');
    const [lines, setLines] = useState<LanguageLogLine[] | null>(null);

    useEffect(() => {
        const kind = server === null ? null : kindOf(server);
        if (kind === null) {
            return;
        }
        let alive = true;
        void tracker
            .log(kind)
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
                <Dialog.Title>{t('language.logTitle', { name: server === null ? '' : nameOf(server) })}</Dialog.Title>
                <div className="min-h-0 grow overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-xs whitespace-pre-wrap text-text-muted select-text">
                    {lines !== null && (lines.length === 0 ? t('language.logEmpty') : lines.map((line) => line.text).join('\n'))}
                </div>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
