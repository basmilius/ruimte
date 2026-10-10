import { useTranslation } from 'react-i18next';
import { Button, useNow } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { AnchoredPopup } from '@adecore/editor-react';
import { relativeTime } from '@/shell/panels/commit-log';
import { useEndpointId } from '@/state/keys';
import type { AgentHover } from './agent-changes';
import { colorOfChat } from './agent-runs';
import { ChatMark } from './ChatMark';
import { openChatAtTurn } from './chat-turn';
import { useChatIdentity, useProviderName } from './use-chat-identity';

const MINUTE_MS = 60_000;

/* The lines of a run as a person reads them, such as `33-38`. */
function linesText(start: number, end: number): string {
    return start === end ? formatNumber(start) : `${formatNumber(start)}-${formatNumber(end)}`;
}

/* Which chat and turn wrote the lines behind a bar in the gutter, when, and the prompt that turn started from. */
export function ProvenanceCard({ hover, onHold }: { hover: AgentHover; onHold(inside: boolean): void }) {
    const { t } = useTranslation('panels');
    const now = Math.floor(useNow(MINUTE_MS) / 1000);
    const endpointId = useEndpointId();
    const { run, startLine, endLine } = hover;
    const chat = useChatIdentity(run.chatId);
    const name = useProviderName(run.provider);
    const count = endLine - startLine + 1;
    const wrote = t(run.via === 'checkpoint' ? 'file.agent.wrotePossibly' : 'file.agent.wrote', { count, lines: linesText(startLine, endLine) });
    const where = run.turn === undefined ? wrote : `${t('file.agent.turn', { turn: formatNumber(run.turn) })} · ${wrote}`;

    return (
        <AnchoredPopup rect={hover.rect} className="flex w-105 flex-col text-xs" onPointerEnter={() => onHold(true)} onPointerLeave={() => onHold(false)}>
            <div className="flex flex-col gap-2 px-3 pt-3 pb-2.5">
                <div className="flex items-center gap-2">
                    <ChatMark provider={run.provider} color={colorOfChat(run.chatId)} size={14} />
                    <span className="shrink-0 text-sm font-semibold text-text">{name}</span>
                    {chat.title !== null && <span className="min-w-0 truncate text-sm text-text-muted">{t('file.agent.inChat', { chat: chat.title })}</span>}
                    <span className="ml-auto shrink-0 text-text-faint">{relativeTime(Math.floor(run.at / 1000), now)}</span>
                </div>
                <span className="text-text-muted">{where}</span>
                {run.promptExcerpt !== '' && (
                    <q className="line-clamp-4 rounded-md bg-surface-hover px-2.5 py-2 text-sm leading-4.5 text-text select-text">{run.promptExcerpt}</q>
                )}
            </div>
            {chat.exists && (
                <div className="flex gap-1 border-t border-border px-1.5 py-1.25">
                    <Button className="bg-surface-hover text-text!" size="xs" onClick={() => openChatAtTurn(endpointId, run.chatId, run.turnId, 'prompt')}>
                        {run.turn === undefined ? t('file.agent.openChat') : t('file.agent.openChatAtTurn', { turn: formatNumber(run.turn) })}
                    </Button>
                    <Button size="xs" onClick={() => openChatAtTurn(endpointId, run.chatId, run.turnId, 'changes')}>
                        {t('file.agent.showTurnChanges')}
                    </Button>
                </div>
            )}
        </AnchoredPopup>
    );
}
