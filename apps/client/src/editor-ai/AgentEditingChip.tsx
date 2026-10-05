import { useTranslation } from 'react-i18next';
import { Tooltip } from '@adecore/ui';
import { ProviderLogo } from '@ruimte/agents-react/agents/ProviderLogo';
import type { AgentKind } from '@ruimte/contracts';
import { chooserChats } from '@/chat/chat-chooser';
import { focusChat } from '@/plan/plan-actions';
import { useSidebarSource } from '@/shell/sidebar-source';
import { useProviderName } from './use-chat-identity';
import { colorOfChat } from './agent-runs';
import type { LiveWriter } from './agent-changes';

/* Only the two CLIs that have a mark; any other agent shows its name alone. */
function logoOf(kind: AgentKind | null): 'claude' | 'codex' | null {
    return kind === 'claude' || kind === 'codex' ? kind : null;
}

/* The toolbar's word that an agent is writing in this file: its mark in its color, who, and the chat it is, a press away. */
export function AgentEditingChip({ writer }: { writer: LiveWriter }) {
    const { t } = useTranslation('panels');
    const source = useSidebarSource();
    const chat = chooserChats(source).find((candidate) => candidate.id === writer.chatId);
    const provider = chat?.provider ?? null;
    const logo = logoOf(provider);
    const name = useProviderName(provider ?? undefined);

    return (
        <Tooltip label={t('file.agent.focusChat')}>
            <button
                type="button"
                className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-text hover:bg-surface-hover"
                onClick={() => focusChat(writer.chatId)}
            >
                <span className="flex shrink-0 items-center" style={{ color: `var(${colorOfChat(writer.chatId)})` }}>
                    {logo === null ? <span className="size-2 rounded-full bg-current" /> : <ProviderLogo provider={logo} size={12} />}
                </span>
                <span className="truncate">{t('file.agent.editing', { name })}</span>
                {chat !== undefined && <span className="truncate text-text-muted">{chat.title}</span>}
            </button>
        </Tooltip>
    );
}
