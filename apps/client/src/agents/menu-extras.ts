import { separatesGroups } from '@ruimte/contracts';
import type { MenuNode } from '@ruimte/desktop-bridge';
import type { MenuAgent } from '@/agents/menu-facts';
import { only, separator, submenu, t } from '@/commands/menu-builders';
import type { MenuExtra } from '@/commands/menu-extras';

function agentRows(agents: MenuAgent[], rowsOf: (agent: MenuAgent) => MenuNode[]): MenuNode[] {
    return agents.flatMap((agent, i) => [...only(separatesGroups(agents[i - 1]?.kind, agent.kind), separator), ...rowsOf(agent)]);
}

export const AGENT_MENU_EXTRAS: readonly MenuExtra[] = [
    {
        menu: 'new-view',
        group: 'agents',
        order: 10,
        build: (context, command) =>
            agentRows(context.agents, (agent) => [
                ...only(agent.chat, command(`agent-view-chat-${agent.kind}`, t('agentChat', { name: agent.name }))),
                ...only(agent.terminal, command(`agent-view-terminal-${agent.kind}`, t('agentTerminal', { name: agent.name })))
            ])
    },
    {
        menu: 'kind',
        group: 'canvas-add',
        order: 80,
        build: (context, command) => {
            const agents = agentRows(context.agents, (agent) => [
                ...only(agent.chat, command(`agent-chat-${agent.kind}`, t('agentChat', { name: agent.name }))),
                ...only(agent.terminal, command(`agent-terminal-${agent.kind}`, t('agentTerminal', { name: agent.name })))
            ]);

            return only(agents.length > 0, submenu('new-agent', t('newAgent'), agents));
        }
    }
];
