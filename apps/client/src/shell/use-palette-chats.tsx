import { Icon, Kbd, KEY_SHORTCUTS, Tooltip } from '@adecore/ui';
import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { externalMatching, groupByChat, openChatHit, resumeExternal, useChatSearch, useExternalSessions } from '@/shell/palette-chats';
import type { PaletteContext, PaletteGroup, PaletteModeView } from '@/shell/palette-entries';
import { ChatGroupLabel, ChatItem, ExternalLabel, type ChatRow } from '@/shell/PaletteChatResults';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';

/* Searching the chats of the project, and the sessions its CLIs left outside Ruimte to resume. */
export function usePaletteChats(context: PaletteContext, enabled: boolean): PaletteModeView<ChatRow> {
    const { t } = useTranslation(['shell']);
    const { open, query, close } = context;
    const currentProjectId = useProject((s) => s.current?.projectId ?? null);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const chatSearch = useChatSearch(enabled && open ? currentProjectId : null, enabled ? query : '');
    const externalAll = useExternalSessions(enabled && open ? currentProjectId : null);
    const external = enabled ? externalMatching(externalAll.sessions, query) : [];

    const runChatRow = (row: ChatRow): void => {
        close();
        if (row.session !== undefined) {
            resumeExternal(row.session).catch((e: unknown) =>
                useToasts.getState().show({ kind: 'error', title: t('palette.resumeFailed'), description: e instanceof Error ? e.message : undefined })
            );
            return;
        }
        if (currentEndpointId !== null) {
            openChatHit(currentEndpointId, row.hit);
        }
    };

    const groups: PaletteGroup<ChatRow>[] = groupByChat(chatSearch.hits, chatSearch.chats).map((group) => ({
        value: `chat-${group.chatId}`,
        label: <ChatGroupLabel title={group.title} count={group.hits.length} />,
        items: group.hits.map((hit) => ({ id: `${hit.chatId}:${hit.itemId}`, hit }))
    }));
    if (external.length > 0) {
        groups.push({
            value: 'external',
            label: <ExternalLabel />,
            items: external.map((session) => ({ id: `${session.provider}:${session.sessionId}`, session }))
        });
    }

    return {
        groups,
        item: (row) => <ChatItem key={row.id} row={row} onRun={runChatRow} />,
        back: () => useUi.getState().setPaletteMode('default'),
        leading: <Icon icon={MessageSquare} size={14} className="shrink-0 text-accent" />,
        trailing: chatSearch.busy && <div className="progress-line absolute inset-x-0 bottom-0" role="progressbar" aria-label={t('palette.searching')} />,
        status:
            query.trim() === ''
                ? t('palette.typeToSearchChats')
                : !chatSearch.busy && chatSearch.failure === null && chatSearch.hits.length === 0 && external.length === 0
                  ? t('palette.noChatMatch')
                  : null,
        footer: (
            <>
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
            </>
        )
    };
}
