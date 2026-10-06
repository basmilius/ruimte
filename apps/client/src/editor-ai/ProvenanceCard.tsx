import { useTranslation } from 'react-i18next';
import { Button, useNow } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { ProviderLogo } from '@adecore/agents-react/agents/ProviderLogo';
import { AnchoredPopup } from '@/language/AnchoredPopup';
import { relativeTime } from '@/shell/panels/commit-log';
import { useEndpointId } from '@/state/keys';
import type { AgentHover } from './agent-changes';
import { colorOfChat } from './agent-runs';
import { openChatAtTurn } from './chat-turn';
import { useChatIdentity, useProviderName } from './use-chat-identity';

const MINUTE_MS = 60_000;

/* The lines of a run as a person reads them, such as `33-38`. */
function linesText(start: number, end: number): string {
    return start === end ? formatNumber(start) : `${formatNumber(start)}-${formatNumber(end)}`;
}

/*
 * What stands behind a bar in the gutter: which chat and which turn wrote those lines, when, and the
 * prompt that turn started from. The pointer can cross into the card, to open the chat at that turn or
 * to see everything the turn changed.
 */
export function ProvenanceCard({ hover, onHold }: { hover: AgentHover; onHold(inside: boolean): void }) {
    const { t } = useTranslation('panels');
    const now = Math.floor(useNow(MINUTE_MS) / 1000);
    const endpointId = useEndpointId();
    const { run, startLine, endLine } = hover;
    const chat = useChatIdentity(run.chatId);
    const name = useProviderName(run.provider);
    const logo = run.provider === 'claude' || run.provider === 'codex' ? run.provider : null;
    const count = endLine - startLine + 1;
    const wrote = t(run.via === 'checkpoint' ? 'file.agent.wrotePossibly' : 'file.agent.wrote', { count, lines: linesText(startLine, endLine) });
    const where = run.turn === undefined ? wrote : `${t('file.agent.turn', { turn: formatNumber(run.turn) })} · ${wrote}`;

    return (
        <AnchoredPopup rect={hover.rect} className="flex w-105 flex-col text-xs" onPointerEnter={() => onHold(true)} onPointerLeave={() => onHold(false)}>
            <div className="flex flex-col gap-2 px-3 pt-3 pb-2.5">
                <div className="flex items-center gap-2">
                    <span className="flex shrink-0 items-center" style={{ color: `var(${colorOfChat(run.chatId)})` }}>
                        {logo === null ? <span className="size-2 rounded-full bg-current" /> : <ProviderLogo provider={logo} size={14} />}
                    </span>
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
