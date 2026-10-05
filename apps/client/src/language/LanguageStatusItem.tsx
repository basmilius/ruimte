import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { Button, Popover, Spinner, Tooltip } from '@basmilius/desktop-ui';
import type { EditorLanguage } from './editor-language';
import { Dot, LogDialog } from './ServerParts';
import { report, serverDetail, sidecarDetails, useStatuses } from './server-status';
import type { LanguageStatusTracker } from './status';
import { actionsOf, alternativeTo, chipServer, kindOf, listedServers, nameOf, packageOf, toneOf } from './status-view';
import { useServingKinds } from './use-serving-kinds';

/*
 * The language servers behind the open file, as the item at the end of the status bar and the list
 * it opens. A server is installed only by a person's click on Install here; nothing else on the page
 * asks the machine to.
 */
export function LanguageStatusItem({ language, name }: { language: EditorLanguage; name: string }) {
    const { t } = useTranslation('panels');
    const tracker = language.project.status;
    const statuses = useStatuses(tracker);
    const serving = useServingKinds(language);
    const [logOf, setLogOf] = useState<string | null>(null);
    const chip = chipServer(statuses, serving);
    const listed = listedServers(statuses, serving);
    // Work a person waits for is spelled out next to the name; a server that is simply up is the dot.
    const busy = listed.find((status) => toneOf(status.state) === 'busy');
    const shown = busy ?? chip;

    const running = listed.filter((status) => actionsOf(status).restart);
    const restartAll = (): void => {
        for (const status of running) {
            void tracker.restart(status.server).catch((error: unknown) => report(error, t));
        }
    };

    return (
        <>
            <Popover.Root>
                <Tooltip label={t('language.chip')}>
                    <Popover.Trigger
                        aria-label={t('language.chip')}
                        className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-surface-hover hover:text-text aria-expanded:bg-surface-active aria-expanded:text-text"
                    >
                        {shown === null ? null : shown.state === 'installing' ? <Spinner size={12} /> : <Dot tone={toneOf(shown.state)} />}
                        {name}
                        {busy !== undefined && (
                            <>
                                <Spinner size={12} />
                                <span className="text-text-faint">
                                    {nameOf(busy.server, statuses)} {t(`language.state.${busy.state}`).toLowerCase()}
                                </span>
                            </>
                        )}
                    </Popover.Trigger>
                </Tooltip>
                <Popover.Popup side="top" align="end" sideOffset={6} className="flex w-80 flex-col gap-1 p-2">
                    <Popover.Title className="px-2 pt-1 pb-1 text-xs font-medium text-text">{t('language.title')}</Popover.Title>
                    {listed.length === 0 && <div className="px-2 py-1.5 text-xs text-text-muted">{t('language.none')}</div>}
                    {listed.map((status) => (
                        <ServerRow key={status.server} status={status} statuses={statuses} tracker={tracker} onLog={() => setLogOf(status.server)} />
                    ))}
                    {listed.length > 0 && (
                        <div className="flex items-center gap-2 border-t border-border pt-2">
                            <Button size="xs" disabled={running.length === 0} onClick={restartAll}>
                                {t('language.restartAll')}
                            </Button>
                            <Button size="xs" onClick={() => setLogOf(listed[0]!.server)}>
                                {t('language.logs')}
                            </Button>
                        </div>
                    )}
                </Popover.Popup>
            </Popover.Root>
            <LogDialog server={logOf} tracker={tracker} onClose={() => setLogOf(null)} />
        </>
    );
}

function ServerRow({
    status,
    statuses,
    tracker,
    onLog
}: {
    status: LanguageServerStatus;
    statuses: readonly LanguageServerStatus[];
    tracker: LanguageStatusTracker;
    onLog(): void;
}) {
    const { t } = useTranslation('panels');
    const kind = kindOf(status.server);
    const actions = actionsOf(status);
    const fail = (error: unknown): void => report(error, t);
    const detail = serverDetail(status, t);
    const alternative = alternativeTo(status, statuses);
    const alternativeKind = alternative === null ? null : kindOf(alternative.server);

    return (
        <div className="flex flex-col gap-1 rounded-md px-2 py-1.5">
            <div className="flex items-center gap-2 text-xs">
                {status.state === 'installing' ? <Spinner size={12} /> : <Dot tone={toneOf(status.state)} />}
                <span className="font-medium text-text">{nameOf(status.server, statuses)}</span>
                <span className="font-mono text-text-faint">{status.version}</span>
                <span className="ml-auto text-text-muted">{t(`language.state.${status.state}`)}</span>
            </div>
            <div className="pl-4 text-xs break-words text-text-faint">{packageOf(status.server, statuses)}</div>
            {detail !== '' && <div className="pl-4 text-xs break-words text-text-muted">{detail}</div>}
            {sidecarDetails(status, t).map((line) => (
                <div key={line} className="pl-4 text-xs break-words text-text-faint">
                    {line}
                </div>
            ))}
            {(actions.install || actions.restart || actions.log || alternativeKind !== null) && (
                <div className="flex flex-wrap gap-2 pl-4">
                    {kind !== null && actions.install && (
                        <Button size="xs" variant="secondary" onClick={() => void tracker.install(kind).catch(fail)}>
                            {t('language.install')}
                        </Button>
                    )}
                    {actions.restart && (
                        <Button size="xs" variant="secondary" onClick={() => void tracker.restart(status.server).catch(fail)}>
                            {t('language.restart')}
                        </Button>
                    )}
                    {actions.log && (
                        <Button size="xs" onClick={onLog}>
                            {t('language.showLog')}
                        </Button>
                    )}
                    {alternative !== null && alternativeKind !== null && (
                        <Button size="xs" onClick={() => void tracker.prefer(alternativeKind).catch(fail)}>
                            {t('language.useInstead', { name: nameOf(alternative.server, statuses) })}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
