import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Lightbulb, SquareTerminal, type LucideIcon } from 'lucide-react';
import { Button, Icon } from '@basmilius/desktop-ui';
import { AgentIcon } from '../../agents/AgentIcon';
import { useChatRow } from '../../state/chats';
import { offerDraft } from '../drafts';
import { dayPartOf } from '../logic/welcome';

const STARTERS: ReadonlyArray<{ id: 'explain' | 'script' | 'think'; icon: LucideIcon }> = [
    { id: 'explain', icon: Bug },
    { id: 'script', icon: SquareTerminal },
    { id: 'think', icon: Lightbulb }
];

const localClock = (): Date => new Date();

/* What stands over the composer of a chat nobody wrote in yet. The part of the day is read once, when the chat opens. */
export function WelcomeGreeting({ chatId, now = localClock }: { chatId: string; now?: () => Date }) {
    const { t } = useTranslation('agent-chat');
    const provider = useChatRow(chatId, (row) => row?.info.provider ?? null);
    const [part] = useState(() => dayPartOf(now()));
    return (
        <div className="flex items-center justify-center gap-3 px-3 pb-2 text-text">
            {provider && <AgentIcon kind={provider} size={32} className="shrink-0" />}
            <h2 className="text-4xl font-semibold tracking-tight text-balance">{t(`timeline.welcome.${part}`)}</h2>
        </div>
    );
}

/* Ways into a first message, under the composer. One puts its words in the prompt and never sends them. */
export function WelcomeStarters({ chatId }: { chatId: string }) {
    const { t } = useTranslation('agent-chat');
    return (
        <ul aria-label={t('timeline.welcome.starters.label')} className="flex flex-col items-center gap-1 px-3 pb-3">
            {STARTERS.map(({ id, icon }) => {
                const words = t(`timeline.welcome.starters.${id}`);
                return (
                    <li key={id}>
                        <Button onClick={() => offerDraft(chatId, words)}>
                            <Icon icon={icon} size={14} className="text-text-faint" />
                            {words}
                        </Button>
                    </li>
                );
            })}
        </ul>
    );
}
