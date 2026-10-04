import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentIcon } from '../../agents/AgentIcon';
import { useChatRow } from '../../state/chats';
import { dayPartOf } from '../logic/welcome';

function localClock(): Date {
    return new Date();
}

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
