import type { AgentInfo, AgentLaunch, ChatInfo } from '@ruimte/contracts';
import { chatSessionAccounts } from '@ruimte/agents/usage/accounts';

/* The account every CLI session a chat or a terminal here ran was under, by `<provider>\0<sessionId>`, for the transcripts accounts share. */
export const sessionAccountsOf = (
    chats: ReadonlyArray<Pick<ChatInfo, 'provider' | 'agentSessionId' | 'account'>>,
    terminals: ReadonlyArray<{ agent: AgentInfo | null; launch: AgentLaunch | null }>
): Map<string, string> => {
    const known = chatSessionAccounts(chats);
    for (const { agent, launch } of terminals) {
        if (agent !== null && launch !== null && launch.kind === agent.kind) {
            known.set(`${agent.kind}\0${agent.agentSessionId}`, launch.account ?? agent.kind);
        }
    }
    return known;
};
