import type { ActionHandlers } from '@ruimte/actions';
import { ToolRefusal } from '@adecore/agents/context';
import { hostService, requireChatCaller, type ServerActionContext } from './context.ts';
import { launchHostOf, launchLines, named } from './launch-actions.ts';

// The daemon hands every session these itself; a secret under one would take over its wiring.
const RESERVED_PREFIX = 'RUIMTE_';

export const secretActions: ActionHandlers<ServerActionContext> = {
    'secret.request': async ({ launch: wanted, variable, label, reason, placeholder, wait }, { actor, context }) => {
        const secrets = hostService(context, 'secrets', 'no-secrets', 'This machine keeps no secrets for launches');
        // The card shows in the thread of an AI chat; a terminal's agent asks in its own TUI or in words.
        await requireChatCaller(
            context,
            actor.id,
            (you) =>
                new ToolRefusal(
                    'secret-needs-chat',
                    `A secret is asked for in a card of an AI chat, and you are ${you}: ask the person to add it to the launch themselves`
                )
        );
        if (variable.toUpperCase().startsWith(RESERVED_PREFIX)) {
            throw new ToolRefusal('reserved-variable', `${variable} is one of the variables this machine sets itself; pick another name`);
        }
        const { projectId } = context.place;
        const launches = await launchHostOf(context).list(projectId);
        const launch = named(launches, wanted);
        if (launch.kind === 'group') {
            throw new ToolRefusal(
                'launch-group',
                `${launch.name} is a group and has no environment of its own; ask for the secret of one of the launches it starts`,
                launchLines(launches.filter((candidate) => launch.members.includes(candidate.launchId)))
            );
        }
        const { requestId, outcome } = await secrets.ask(
            {
                nodeId: actor.id,
                projectId,
                launchId: launch.launchId,
                launchName: launch.name,
                variable,
                label,
                reason,
                ...(placeholder ? { placeholder } : {})
            },
            wait ? wait * 1000 : undefined
        );
        return { output: { requestId, outcome, launchId: launch.launchId, name: launch.name, variable } };
    }
};
