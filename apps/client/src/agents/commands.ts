import { providersOf } from '@adecore/agents-react/state';
import type { ProviderInfo } from '@ruimte/contracts';
import i18next from 'i18next';
import { createNodeAction, createViewAction } from '@/action-port/person-actions';
import type { Command } from '@/commands/behavior';
import type { GeneratedCommands } from '@/commands/generated';
import type { CommandMoment } from '@/commands/moment';
import { availableAgents, type AgentTarget } from '@/state/agent-availability';

/*
 * One command per agent CLI per kind of node, from the daemon's catalog. A CLI that is not installed is
 * left out: the Agents settings pane is where that gets fixed, not the palette.
 */
function agentCommands(target: AgentTarget, providers: ProviderInfo[], onCanvas: boolean): Command[] {
    return availableAgents(providers, target).flatMap((provider) => [
        ...(onCanvas
            ? [
                  {
                      id: `agent-${target}-${provider.kind}`,
                      label: i18next.t(`shell:palette.newAgent.${target}`, { name: provider.name }),
                      agent: provider.kind,
                      run: () => void createNodeAction(target, { provider: provider.kind })
                  }
              ]
            : []),
        {
            id: `agent-view-${target}-${provider.kind}`,
            label: i18next.t(`shell:palette.newAgentView.${target}`, { name: provider.name }),
            hint: i18next.t('shell:palette.hints.withoutCanvas'),
            agent: provider.kind,
            run: () => void createViewAction(target, { provider: provider.kind })
        }
    ]);
}

export function agentPaletteRows(moment: CommandMoment): Command[] {
    if (!moment.inWorkspace) {
        return [];
    }
    const { providers } = providersOf(moment.endpointId);

    return [...agentCommands('chat', providers, moment.onCanvas), ...agentCommands('terminal', providers, moment.onCanvas)];
}

export const AGENT_GENERATED: readonly GeneratedCommands[] = [
    { prefix: 'agent-view-chat-', usage: 'agentViewChat', palette: true },
    { prefix: 'agent-view-terminal-', usage: 'agentViewTerminal', palette: true },
    { prefix: 'agent-chat-', usage: 'agentChat', palette: true },
    { prefix: 'agent-terminal-', usage: 'agentTerminal', palette: true }
];
