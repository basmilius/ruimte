import { useTranslation } from 'react-i18next';
import { Kbd, KEY_SHORTCUTS, Tooltip } from '@adecore/ui';
import { PaletteNote } from '@/shell/PaletteEntryList';
import { optionId, type PaletteContext, type PaletteModeView } from '@/shell/palette-entries';
import { externalMatching, openChatHit, resumeExternal, useChatSearch, useExternalSessions } from '@/shell/palette-chats';
import { PaletteChatResults } from '@/shell/PaletteChatResults';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';

/* Searching the chats of the project, and the sessions its CLIs left outside Ruimte to resume. */
export function usePaletteChats(context: PaletteContext, enabled: boolean): PaletteModeView {
    const { t } = useTranslation(['shell']);
    const { open, query, index, setIndex, close } = context;
    const currentProjectId = useProject((s) => s.current?.projectId ?? null);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const chatSearch = useChatSearch(enabled && open ? currentProjectId : null, enabled ? query : '');
    const externalAll = useExternalSessions(enabled && open ? currentProjectId : null);
    const external = enabled ? externalMatching(externalAll.sessions, query) : [];
    const count = chatSearch.hits.length + external.length;
    const activeHit = Math.min(index, count - 1);

    const runChatHit = (at: number): void => {
        const session = external[at - chatSearch.hits.length];
        if (session) {
            close();
            resumeExternal(session).catch((e: unknown) =>
                useToasts.getState().show({ kind: 'error', title: t('palette.resumeFailed'), description: e instanceof Error ? e.message : undefined })
            );
            return;
        }
        const hit = chatSearch.hits[at];
        if (!hit) {
            return;
        }
        close();
        if (currentEndpointId !== null) {
            openChatHit(currentEndpointId, hit);
        }
    };

    return {
        count,
        activeOptionId: activeHit >= 0 ? optionId(activeHit) : undefined,
        enter: () => runChatHit(activeHit),
        back: () => {
            useUi.getState().setPaletteMode('default');
            return true;
        },
        overlay: chatSearch.busy && <div className="progress-line absolute inset-x-0 bottom-0" role="progressbar" aria-label={t('palette.searching')} />,
        notes: (
            <>
                {query.trim() !== '' && !chatSearch.busy && chatSearch.failure === null && chatSearch.hits.length === 0 && external.length === 0 && (
                    <PaletteNote>{t('palette.noChatMatch')}</PaletteNote>
                )}
                {query.trim() === '' && <PaletteNote>{t('palette.typeToSearchChats')}</PaletteNote>}
            </>
        ),
        results: (
            <PaletteChatResults
                search={chatSearch}
                external={external}
                active={activeHit}
                optionId={optionId}
                onHover={(at) => setIndex(at)}
                onRun={(at) => runChatHit(at)}
            />
        ),
        footer: (
            <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-text-faint">
                {chatSearch.failure !== null ? (
                    <span className="text-status-error" role="alert">
                        {chatSearch.failure}
                    </span>
                ) : (
                    <span>
                        {chatSearch.hits.length === 0
                            ? external.length > 0
                                ? t('palette.externalCount', { count: external.length })
                                : t('palette.nothingYet')
                            : t('palette.chatHits', {
                                  count: chatSearch.chats.length,
                                  hits: `${chatSearch.hits.length}${chatSearch.truncated ? '+' : ''}`
                              })}
                        {chatSearch.cancelled && <span>{` · ${t('palette.chatSearchCancelled')}`}</span>}
                        {chatSearch.failed.length > 0 && (
                            <>
                                {' · '}
                                <Tooltip
                                    label={
                                        <span className="flex flex-col gap-0.5">
                                            {chatSearch.failed.map((failed) => (
                                                <span
                                                    key={failed.chatId}
                                                >{`${failed.title === '' ? t('palette.untitledChat') : failed.title}: ${failed.reason}`}</span>
                                            ))}
                                        </span>
                                    }
                                >
                                    <span className="text-status-error">{t('palette.chatSearchFailed', { count: chatSearch.failed.length })}</span>
                                </Tooltip>
                            </>
                        )}
                    </span>
                )}
                <span className="grow" />
                <span>
                    <Kbd shortcut={KEY_SHORTCUTS.enter} variant="inline" /> {t('palette.chatEnterHint')}{' '}
                    <Kbd shortcut={KEY_SHORTCUTS.backspace} variant="inline" /> {t('palette.grepBackHint')}
                </span>
            </div>
        )
    };
}
