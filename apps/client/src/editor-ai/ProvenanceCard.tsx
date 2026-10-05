import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';
import { Button, Icon, useNow } from '@basmilius/desktop-ui';
import { formatNumber } from '@basmilius/desktop-ui/format';
import { ProviderLogo } from '@ruimte/agents-react/agents/ProviderLogo';
import { AnchoredPopup } from '@/language/AnchoredPopup';
import { focusChat } from '@/plan/plan-actions';
import { relativeTime } from '@/shell/panels/commit-log';
import type { AgentHover } from './agent-changes';
import { colorOfChat } from './agent-runs';
import { useChatIdentity, useProviderName } from './use-chat-identity';

const MINUTE_MS = 60_000;

/* The lines of a run as a person reads them, such as `33-38`. */
function linesText(start: number, end: number): string {
    return start === end ? formatNumber(start) : `${formatNumber(start)}-${formatNumber(end)}`;
}

/*
 * What stands behind a bar in the gutter: which chat and which turn wrote those lines, when, and the
 * prompt that turn started from. The pointer can cross into the card, to open the chat.
 */
export function ProvenanceCard({ hover, onHold }: { hover: AgentHover; onHold(inside: boolean): void }) {
    const { t } = useTranslation('panels');
    const now = Math.floor(useNow(MINUTE_MS) / 1000);
    const { run, startLine, endLine } = hover;
    const chat = useChatIdentity(run.chatId);
    const name = useProviderName(run.provider);
    const logo = run.provider === 'claude' || run.provider === 'codex' ? run.provider : null;
    const count = endLine - startLine + 1;
    const wrote = t(run.via === 'checkpoint' ? 'file.agent.wrotePossibly' : 'file.agent.wrote', { count, lines: linesText(startLine, endLine) });
    const where = run.turn === undefined ? wrote : `${t('file.agent.turn', { turn: formatNumber(run.turn) })} · ${wrote}`;

    return (
        <AnchoredPopup
            rect={hover.rect}
            className="flex w-72 flex-col gap-2 p-3 text-xs"
            onPointerEnter={() => onHold(true)}
            onPointerLeave={() => onHold(false)}
        >
            <div className="flex items-center gap-1.5">
                <span className="flex shrink-0 items-center" style={{ color: `var(${colorOfChat(run.chatId)})` }}>
                    {logo === null ? <span className="size-2 rounded-full bg-current" /> : <ProviderLogo provider={logo} size={14} />}
                </span>
                <span className="shrink-0 font-medium text-text">{name}</span>
                {chat.title !== null && <span className="min-w-0 truncate text-text-muted">{t('file.agent.inChat', { chat: chat.title })}</span>}
                <span className="ml-auto shrink-0 text-text-muted">{relativeTime(Math.floor(run.at / 1000), now)}</span>
            </div>
            <span className="text-text-muted">{where}</span>
            {run.promptExcerpt !== '' && <q className="line-clamp-4 text-text select-text">{run.promptExcerpt}</q>}
            {chat.exists && (
                <div className="flex justify-end">
                    <Button size="xs" variant="secondary" onClick={() => focusChat(run.chatId)}>
                        <Icon icon={MessageSquare} size={14} />
                        {t('file.agent.openChat')}
                    </Button>
                </div>
            )}
        </AnchoredPopup>
    );
}
